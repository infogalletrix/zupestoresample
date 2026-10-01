import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createApp } from '../server/app.mjs';

process.env.NODE_ENV = 'production';
process.env.APP_ORIGIN = 'http://127.0.0.1:3006';
process.env.COOKIE_SECURE = 'false';
process.env.SETUP_TOKEN = 'local-browser-test-only';
const dataDir = mkdtempSync(join(tmpdir(), 'zupestore-browser-'));
const { app, db, demoDb } = createApp({ dataDir });
const server = app.listen(3006, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    server.close(() => {
      db.close();
      demoDb.close();
      if (resolve(dataDir).startsWith(resolve(tmpdir()) + sep + 'zupestore-browser-'))
        rmSync(dataDir, { recursive: true, force: true });
      process.exit(0);
    });
  });
