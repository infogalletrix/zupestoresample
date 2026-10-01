import { DatabaseSync } from 'node:sqlite';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  renameSync,
  chmodSync,
} from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import archiver from 'archiver';
import { now, setting, setSetting, audit } from './db.mjs';

export function createBackupService(db, dataDir) {
  const directory = resolve(dataDir, 'backups');
  let active = false;
  function status() {
    return { ...setting(db, 'backup:status', {}), intervalHours: 24, retentionDays: 14 };
  }
  async function create(actor = 'scheduled-backup') {
    if (active) throw new Error('A backup is already running.');
    active = true;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stem = `zupestore-${Date.now()}-${randomBytes(4).toString('hex')}`;
    const sqlite = join(directory, `${stem}.sqlite`),
      partial = join(directory, `${stem}.partial`),
      file = join(directory, `${stem}.zip`);
    try {
      const key =
        process.env.ENCRYPTION_KEY || readFileSync(join(dataDir, '.encryption-key'), 'utf8').trim();
      if (!/^[a-f0-9]{64}$/i.test(key))
        throw new Error('Backup encryption key is missing or invalid.');
      db.exec(`VACUUM INTO '${sqlite.replaceAll("'", "''")}'`);
      chmodSync(sqlite, 0o600);
      const check = new DatabaseSync(sqlite);
      try {
        if (
          check.prepare('PRAGMA quick_check').get().quick_check !== 'ok' ||
          check.prepare('PRAGMA foreign_key_check').all().length
        )
          throw new Error('Backup database integrity check failed.');
        // Restores must require fresh sign-in, never revive saved browser sessions.
        check.exec('DELETE FROM sessions');
      } finally {
        check.close();
      }
      const digest = createHash('sha256').update(readFileSync(sqlite)).digest('hex');
      await new Promise((resolveArchive, reject) => {
        const output = createWriteStream(partial, { mode: 0o600 });
        const archive = archiver('zip', { zlib: { level: 6 } });
        output.on('close', resolveArchive);
        output.on('error', reject);
        archive.on('error', reject);
        archive.on('warning', reject);
        archive.pipe(output);
        archive.file(sqlite, { name: 'commerce.sqlite', mode: 0o600 });
        archive.append(key + '\n', { name: '.encryption-key', mode: 0o600 });
        archive.append(
          JSON.stringify(
            {
              application: 'Zupestore',
              format: 1,
              created_at: now(),
              sha256: digest,
              sessions: 'cleared',
            },
            null,
            2,
          ),
          { name: 'manifest.json' },
        );
        archive.append(
          'Zupestore recovery\n\nKeep this archive private: it contains the database and its connection encryption key.\nStop the application. Preserve the current data directory. Extract commerce.sqlite and .encryption-key into a NEW empty data directory, using the key in this archive (or the identical ENCRYPTION_KEY). Point DATA_DIR at that directory and restart. Do not mix an old WAL/SHM file into restored data.\nVerify the database SHA-256 against manifest.json and run PRAGMA quick_check and PRAGMA foreign_key_check. Log in again; backup sessions are cleared.\nThe archive is not encrypted. Keep a copy in private off-server storage.\n',
          { name: 'RESTORE.txt' },
        );
        archive.finalize().catch(reject);
      });
      renameSync(partial, file);
      const result = {
        status: 'Success',
        lastSuccess: now(),
        filename: basename(file),
        bytes: statSync(file).size,
      };
      setSetting(db, 'backup:status', result);
      audit(db, actor, 'Verified full backup created', 'backup', { filename: result.filename });
      // Delete only the backup files this service owns, within its resolved directory.
      for (const name of readdirSync(directory)) {
        if (!/^zupestore-\d+-[a-f0-9]{8}\.zip$/.test(name)) continue;
        const target = resolve(directory, name);
        if (dirname(target) !== directory) throw new Error('Invalid backup retention path.');
        if (statSync(target).mtimeMs < Date.now() - 14 * 86400000) unlinkSync(target);
      }
      return { ...result, file };
    } catch (e) {
      setSetting(db, 'backup:status', {
        ...status(),
        status: 'Failed',
        message: e.message,
        lastAttempt: now(),
      });
      throw e;
    } finally {
      for (const file of [sqlite, partial]) if (existsSync(file)) unlinkSync(file);
      active = false;
    }
  }
  async function scheduled() {
    if (active) return;
    const last = status().lastSuccess;
    if (!last || Date.now() - Date.parse(last) >= 24 * 3600000) await create();
  }
  return { create, scheduled, status };
}
