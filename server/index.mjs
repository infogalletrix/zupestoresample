import 'dotenv/config';
import { createApp } from './app.mjs';
const { app, db, demoDb, integrations } = createApp();
const port = Number(process.env.PORT || 3001),
  host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () =>
  console.log(`Zupestore API ready at http://${host}:${port}`),
);
let pollRunning = false;
async function poll() {
  if (pollRunning) return;
  pollRunning = true;
  try {
    for (const c of integrations.publicConfig()) {
      if (c.provider === 'settlements' || !c.configured || !c.enabled) continue;
      try {
        await integrations.sync(c.provider);
      } catch (e) {
        console.error(`${c.provider} sync: ${e.message}`);
      }
    }
  } finally {
    pollRunning = false;
  }
}
const minutes = Math.max(5, Number(process.env.SYNC_INTERVAL_MINUTES) || 15);
const syncTimer = setInterval(poll, minutes * 60000);
const workerTimer = setInterval(
  () => integrations.processWebhooks().catch((e) => console.error(e.message)),
  30000,
);
const startupTimer = setTimeout(poll, 5000);
function shutdown() {
  clearInterval(syncTimer);
  clearInterval(workerTimer);
  clearTimeout(startupTimer);
  server.close(() => {
    db.close();
    demoDb.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
