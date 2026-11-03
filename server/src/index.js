// Tatami API server.
//   dev:  npm run dev     (from the repo root - starts this + the Vite web app)
//   prod: npm run build && npm start   (serves the built web app from web/dist)

import { config } from './config.js';
import { openDb } from './db.js';
import { seed, isEmpty, DEMO_PASSWORD } from './seed.js';
import { initLaunchDarkly, closeLaunchDarkly } from './launchdarkly.js';
import { createApp } from './app.js';

const db = openDb(config.dbFile);
if (isEmpty(db)) {
  seed(db);
  console.log(`[db] seeded demo data - every demo persona's password is "${DEMO_PASSWORD}"`);
}

await initLaunchDarkly();
const { app } = createApp(db);

const server = app.listen(config.port, () => {
  console.log(`[api] Tatami API listening on http://localhost:${config.port}`);
});

async function shutdown() {
  server.close();
  await closeLaunchDarkly(); // flush analytics/experiment events before exit
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
