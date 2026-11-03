#!/usr/bin/env node
// EXTRA CREDIT - EXPERIMENTATION: traffic simulator
//
// Generates synthetic members, evaluates `schedule-calendar-v2` for each of them
// with the LaunchDarkly server SDK, and sends the `session-rsvp` conversion event
// with a different probability per variation. This lets you show a populated
// experiment results page in minutes instead of waiting for real traffic.
//
// !! The data this produces is SIMULATED. Say so when you present the results. !!
//
// Usage (from the repo root, after the experiment is started in LaunchDarkly):
//   npm run simulate                                # 2000 members, 30% vs 42% RSVP rate
//   npm run simulate -- --users 5000 --control 0.3 --treatment 0.38
//
// Simulated members are white-blue belt students/parents with betaTester=false,
// so they fall through the targeting rules into the percentage rollout that the
// experiment controls.

import { init } from '@launchdarkly/node-server-sdk';
import fs from 'node:fs';

// Load the root .env if present (so LD_SDK_KEY is picked up).
if (fs.existsSync(new URL('../.env', import.meta.url))) process.loadEnvFile(new URL('../.env', import.meta.url));

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((s) => s.trim().split(/\s+/)));
const USERS = Number(args.users ?? 2000);
const P_CONTROL = Number(args.control ?? 0.30);   // RSVP probability with the classic list
const P_TREATMENT = Number(args.treatment ?? 0.42); // RSVP probability with the new calendar
const FLAG = 'schedule-calendar-v2';
const METRIC = 'session-rsvp';

// >>> REPLACE ME: set LD_SDK_KEY in .env (server-side SDK key of the environment running the experiment).
const sdkKey = process.env.LD_SDK_KEY;
if (!sdkKey) {
  console.error('LD_SDK_KEY is not set. Add it to .env (see README).');
  process.exit(1);
}

const BELTS = ['white', 'white', 'yellow', 'yellow', 'orange', 'green', 'blue'];
const CITIES = ['San Francisco', 'Oakland', 'San Jose'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const runId = Date.now().toString(36);

function makeContext(i) {
  const role = Math.random() < 0.3 ? 'parent' : 'student';
  const ageGroup = role === 'parent' ? 'kids' : (Math.random() < 0.25 ? 'teens' : 'adults');
  const city = pick(CITIES);
  return {
    kind: 'multi',
    user: {
      key: `sim-${runId}-${i}`,
      name: `Simulated member ${i}`,
      email: `sim-${runId}-${i}@example.com`,
      role,
      belt: pick(BELTS),
      ageGroup,
      betaTester: false,
      _meta: { privateAttributes: ['email'] },
    },
    dojo: { key: `dojo-${city.toLowerCase().replace(/\s+/g, '-')}`, name: `Tatami Judo ${city}`, city, plan: 'club' },
  };
}

const client = init(sdkKey);
await client.waitForInitialization({ timeout: 15 });
console.log(`Simulating ${USERS} members (run ${runId}); RSVP rate control=${P_CONTROL} treatment=${P_TREATMENT}`);

const tally = { true: { n: 0, rsvp: 0 }, false: { n: 0, rsvp: 0 } };
for (let i = 0; i < USERS; i++) {
  const ctx = makeContext(i);
  // Evaluating the flag records the exposure for the experiment.
  const calendar = await client.variation(FLAG, ctx, false);
  const t = tally[String(Boolean(calendar))];
  t.n++;
  if (Math.random() < (calendar ? P_TREATMENT : P_CONTROL)) {
    client.track(METRIC, ctx, { source: 'simulator' });
    t.rsvp++;
  }
  if (i % 250 === 249) {
    await client.flush();
    process.stdout.write(`  ${i + 1}/${USERS}\r`);
  }
}

await client.flush();
client.close();
const pct = (x) => (x.n ? ((x.rsvp / x.n) * 100).toFixed(1) : '0.0');
console.log(`\nDone.\n  classic list (false): ${tally.false.n} members, ${tally.false.rsvp} RSVPs (${pct(tally.false)}%)`);
console.log(`  yearly calendar (true): ${tally.true.n} members, ${tally.true.rsvp} RSVPs (${pct(tally.true)}%)`);
if (!tally.true.n || !tally.false.n) {
  console.log('\n! Only one variation was served. Check that the experiment is running and the fallthrough rule is the experiment rollout.');
}
console.log('Results can take a few minutes to appear on the experiment page.');
