// LaunchDarkly server-side SDK setup.
//
// The server uses LaunchDarkly for three things:
//   1. Enforcing flags on the API (a flag that is OFF hides the feature in the UI
//      *and* blocks its endpoints, so a rolled-back feature can't be reached directly).
//   2. AI Configs for the Sensei Assistant chatbot (see ai.js).
//   3. Logging flag changes as they stream in (a server-side "listener").

import { init } from '@launchdarkly/node-server-sdk';
import { initAi } from '@launchdarkly/server-sdk-ai';
import { config } from './config.js';

// ---------------------------------------------------------------------------
// Flag keys. >>> RECREATE THESE in your LaunchDarkly project (see docs/launchdarkly-setup.md).
// The same keys are used by the web app in web/src/lib/flags.js.
// ---------------------------------------------------------------------------
export const FLAGS = {
  // Part 1 - Release & Remediate. Boolean. Wall comments + emoji reactions.
  WALL_REACTIONS: 'wall-reactions-comments',
  // Part 2 - Targeting (+ Experiment). Boolean. false = list view, true = yearly calendar.
  SCHEDULE_CALENDAR_V2: 'schedule-calendar-v2',
  // Bonus - progressive delivery. Boolean. Recurring-session builder for coaches.
  SCHEDULE_BUILDER: 'schedule-builder',
};

// AI Config key. >>> RECREATE in LaunchDarkly > AI Configs.
export const AI_CONFIG_KEY = 'sensei-assistant';

// Metric (event) keys. >>> RECREATE in LaunchDarkly > Metrics.
export const METRICS = {
  RSVP: 'session-rsvp',
};

let ldClient;
let aiClient;

/**
 * @param {object} [testOptions] extra SDK options; tests pass a TestData
 *   `updateProcessor` so flags can be driven without a LaunchDarkly account.
 */
export async function initLaunchDarkly(testOptions) {
  if (testOptions) {
    ldClient = init('test-sdk-key', { sendEvents: false, ...testOptions });
  } else {
    if (!config.ldSdkKey) {
      // No key -> offline mode: every evaluation returns the code default.
      console.warn('[launchdarkly] LD_SDK_KEY is not set - running in OFFLINE mode (flags use code defaults).');
    }
    ldClient = init(config.ldSdkKey || 'offline', { offline: !config.ldSdkKey });
  }

  try {
    await ldClient.waitForInitialization({ timeout: 10 });
    if (config.ldSdkKey || testOptions) console.log('[launchdarkly] server SDK initialized');
  } catch (err) {
    console.error('[launchdarkly] SDK failed to initialize, serving defaults:', err.message);
  }

  // Server-side listener: the SDK keeps a streaming connection open, so flag
  // changes made in the dashboard (or by a trigger) arrive within milliseconds.
  for (const key of Object.values(FLAGS)) {
    ldClient.on(`update:${key}`, () => console.log(`[launchdarkly] flag "${key}" changed - new rules are live`));
  }

  aiClient = initAi(ldClient);
  return ldClient;
}

export function getLdClient() {
  return ldClient;
}

export function getAiClient() {
  return aiClient;
}

/**
 * Build the LaunchDarkly *multi-context* for a signed-in member.
 *
 *   user context  - who the person is (role, belt, age group, beta tester ...)
 *   dojo context  - which club they belong to (lets you target whole dojos later)
 *
 * The browser builds the identical context from /api/auth/me so client-side and
 * server-side evaluations always agree. Keep the two in sync if you add attributes.
 */
export function buildContext(user) {
  return {
    kind: 'multi',
    user: {
      key: user.key,
      name: user.name,
      email: user.email,
      role: user.role,
      belt: user.belt,
      ageGroup: user.ageGroup,
      betaTester: Boolean(user.betaTester),
      // Email is used for targeting (e.g. "endsWith @tatami.dojo") but is
      // never sent back to LaunchDarkly in analytics events.
      _meta: { privateAttributes: ['email'] },
    },
    dojo: {
      key: user.dojo.key,
      name: user.dojo.name,
      city: user.dojo.city,
      plan: user.dojo.plan,
    },
  };
}

/** Evaluate a boolean flag for a member. `fallback` is used if LaunchDarkly is unreachable. */
export async function isEnabled(flagKey, user, fallback = false) {
  return ldClient.variation(flagKey, buildContext(user), fallback);
}

export async function closeLaunchDarkly() {
  if (!ldClient) return;
  await ldClient.flush().catch(() => {});
  ldClient.close();
}
