// Builds the Express app. Kept separate from index.js so tests can create an
// app against an in-memory database and a TestData LaunchDarkly client.

import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { authenticate } from './auth.js';
import { ErrorRateMonitor, fireTrigger } from './remediation.js';
import { authRoutes } from './routes/auth.js';
import { wallRoutes } from './routes/wall.js';
import { scheduleRoutes } from './routes/schedule.js';
import { memberRoutes } from './routes/members.js';
import { chatRoutes } from './routes/chat.js';
import { demoRoutes } from './routes/demo.js';

export function createApp(db, { onTrip } = {}) {
  // Shared demo state + the auto-remediation monitor for the reactions API.
  const demo = { bugEnabled: false };
  const monitor = new ErrorRateMonitor({
    windowMs: config.remediationWindowMs,
    threshold: config.remediationErrorThreshold,
    minRequests: config.remediationMinRequests,
    onTrip: onTrip ?? (async (stats) => {
      const reason = `reactions API error rate ${(stats.errorRate * 100).toFixed(0)}% (${stats.errors}/${stats.total}) over ${config.remediationWindowMs / 1000}s`;
      console.warn(`[remediation] threshold crossed: ${reason}`);
      if (config.autoRemediate) await fireTrigger(config.ldTriggerUrl, reason);
    }),
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(authenticate(db));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', authRoutes(db));
  app.use('/api', wallRoutes(db, { demo, monitor }));
  app.use('/api', scheduleRoutes(db));
  app.use('/api', memberRoutes(db));
  app.use('/api', chatRoutes(db));
  if (config.demoMode) app.use('/api', demoRoutes({ demo, monitor }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the production web build if it exists.
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    console.error('[api] unhandled error:', err);
    res.status(500).json({ error: 'Unexpected server error' });
  });

  return { app, demo, monitor };
}
