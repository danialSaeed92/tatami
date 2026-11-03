// Central place for every environment variable the server reads.
// Copy `.env.example` (repo root) to `.env` and fill in the values.
// The server and the web app both read that single root `.env` file.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',

  // SQLite database file. Created and seeded automatically on first start.
  dbFile: process.env.DB_FILE || path.resolve(here, '../data/tatami.db'),

  // Secret used to sign the session cookie (JWT). Change it for any shared deployment.
  jwtSecret: process.env.JWT_SECRET || 'tatami-dev-secret-change-me',

  // ---------------------------------------------------------------------------
  // LaunchDarkly
  // ---------------------------------------------------------------------------
  // >>> REPLACE ME: your *server-side* SDK key (starts with "sdk-").
  //     LaunchDarkly > Project settings > Environments > <your env> > SDK key
  //     Never expose this key to the browser.
  ldSdkKey: process.env.LD_SDK_KEY || '',

  // >>> REPLACE ME (optional): the URL of the flag trigger you create on the
  //     `wall-reactions-comments` flag (Flag > Settings > Triggers > Generic trigger).
  //     Used by the auto-remediation monitor and `npm run trigger`.
  ldTriggerUrl: process.env.LD_TRIGGER_URL || '',

  // When "true", the server fires the trigger automatically once the error rate
  // on the reactions API crosses the threshold below.
  autoRemediate: (process.env.AUTO_REMEDIATE || 'true') === 'true',
  remediationErrorThreshold: Number(process.env.REMEDIATION_ERROR_THRESHOLD || 0.5),
  remediationMinRequests: Number(process.env.REMEDIATION_MIN_REQUESTS || 5),
  remediationWindowMs: Number(process.env.REMEDIATION_WINDOW_MS || 60_000),

  // ---------------------------------------------------------------------------
  // LLM providers for the Sensei Assistant chatbot (AI Config "sensei-assistant").
  // The AI Config variation chooses the provider + model; the server only needs
  // the matching API key. With no key, the bot answers with a clearly labelled
  // offline "mock" reply so the demo still works end to end.
  // ---------------------------------------------------------------------------
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',

  // Shows the demo control panel endpoints (simulate bug, etc.). Turn off in prod.
  demoMode: (process.env.DEMO_MODE || 'true') === 'true',
};
