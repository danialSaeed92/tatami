// Demo control panel endpoints (only mounted when DEMO_MODE=true).
// These exist purely to make the LaunchDarkly story easy to present.

import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { FLAGS, buildContext, getLdClient } from '../launchdarkly.js';
import { fireTrigger } from '../remediation.js';

export function demoRoutes({ demo, monitor }) {
  const r = Router();
  r.use(requireAuth);

  r.get('/demo/status', async (req, res) => {
    const ld = getLdClient();
    const ctx = buildContext(req.user);
    // allFlagsState shows what the *server* SDK evaluates for this member, so you
    // can show client and server agree.
    const state = await ld.allFlagsState(ctx);
    const serverFlags = Object.fromEntries(Object.values(FLAGS).map((k) => [k, state.getFlagValue(k) ?? null]));
    res.json({
      bugEnabled: demo.bugEnabled,
      monitor: { ...monitor.stats(), threshold: monitor.threshold, minRequests: monitor.minRequests, windowMs: monitor.windowMs, trips: monitor.trips.slice(-5) },
      autoRemediate: config.autoRemediate,
      triggerConfigured: Boolean(config.ldTriggerUrl),
      ldConnected: Boolean(config.ldSdkKey) && ld.initialized(),
      serverFlags,
    });
  });

  // Simulate a bad release of the reactions feature.
  r.post('/demo/bug', (req, res) => {
    demo.bugEnabled = Boolean(req.body?.enabled);
    console.warn(`[demo] simulated reactions bug ${demo.bugEnabled ? 'ENABLED' : 'disabled'}`);
    res.json({ bugEnabled: demo.bugEnabled });
  });

  // Browser alternative to `curl -X POST $LD_TRIGGER_URL`.
  r.post('/demo/trigger', async (req, res) => {
    try {
      res.json(await fireTrigger(config.ldTriggerUrl, `manual kill switch from demo panel by ${req.user.name}`));
    } catch (err) {
      res.status(502).json({ fired: false, reason: err.message });
    }
  });

  return r;
}
