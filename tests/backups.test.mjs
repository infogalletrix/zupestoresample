import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import unzipper from 'unzipper';
import { openDb, setSetting, setting, insert, now } from '../server/db.mjs';
import { encryption } from '../server/security.mjs';
import { createBackupService } from '../server/backups.mjs';
test('full backup restores records and encrypted connections, clears sessions and verifies integrity', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zupestore-backup-test-'));
  const db = openDb(join(dir, 'commerce.sqlite'));
  try {
    const crypto = encryption(dir);
    insert(db, 'suppliers', { id: 'supplier', name: 'Supplier A', created_at: now() });
    insert(db, 'sessions', {
      token: 'test-session',
      user_id: 'test-user',
      mode: 'demo',
      expires_at: Date.now() + 60000,
    });
    setSetting(db, 'integration:test', crypto.encrypt({ token: 'example-token' }));
    const backups = createBackupService(db, dir),
      result = await backups.create();
    assert.equal(result.status, 'Success');
    const archive = await unzipper.Open.file(result.file);
    assert.deepEqual(
      archive.files.map((f) => f.path).sort(),
      ['.encryption-key', 'RESTORE.txt', 'commerce.sqlite', 'manifest.json'].sort(),
    );
    const restored = join(dir, 'restored');
    mkdirSync(restored);
    for (const file of archive.files) writeFileSync(join(restored, file.path), await file.buffer());
    const manifest = JSON.parse(readFileSync(join(restored, 'manifest.json')));
    assert.equal(
      createHash('sha256')
        .update(readFileSync(join(restored, 'commerce.sqlite')))
        .digest('hex'),
      manifest.sha256,
    );
    const copy = openDb(join(restored, 'commerce.sqlite'));
    try {
      assert.equal(copy.prepare('PRAGMA quick_check').get().quick_check, 'ok');
      assert.equal(copy.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
      assert.equal(copy.prepare('SELECT name FROM suppliers').get().name, 'Supplier A');
      assert.equal(
        encryption(restored).decrypt(setting(copy, 'integration:test')).token,
        'example-token',
      );
    } finally {
      copy.close();
    }
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 1);
    await backups.scheduled();
    assert.equal(readdirSync(join(dir, 'backups')).filter((f) => f.endsWith('.zip')).length, 1);
  } finally {
    db.close();
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep + 'zupestore-backup-test-')) throw new Error('Unexpected cleanup directory');
    rmSync(dir, { recursive: true, force: true });
  }
});
