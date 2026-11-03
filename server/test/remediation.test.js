import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorRateMonitor } from '../src/remediation.js';

function monitor(overrides = {}) {
  let t = 0;
  const trips = [];
  const m = new ErrorRateMonitor({ windowMs: 60_000, threshold: 0.5, minRequests: 5, cooldownMs: 30_000, onTrip: (s) => trips.push(s), now: () => t, ...overrides });
  return { m, trips, advance: (ms) => { t += ms; } };
}

test('does not trip below the minimum sample size', () => {
  const { m, trips } = monitor();
  for (let i = 0; i < 4; i++) m.record(false);
  assert.equal(trips.length, 0);
});

test('trips once the error rate crosses the threshold', () => {
  const { m, trips } = monitor();
  m.record(true); m.record(true); m.record(false); m.record(false);
  assert.equal(m.record(false), true);
  assert.equal(trips.length, 1);
  assert.equal(trips[0].errors, 3);
});

test('healthy traffic never trips', () => {
  const { m, trips } = monitor();
  for (let i = 0; i < 50; i++) m.record(i % 5 !== 0); // 20% errors
  assert.equal(trips.length, 0);
});

test('old events fall out of the sliding window', () => {
  const { m, trips, advance } = monitor();
  for (let i = 0; i < 4; i++) m.record(false);
  advance(61_000);
  m.record(false);
  assert.equal(trips.length, 0);
  assert.equal(m.stats().total, 1);
});

test('respects the cooldown between trips', () => {
  const { m, trips, advance } = monitor();
  for (let i = 0; i < 5; i++) m.record(false);
  for (let i = 0; i < 5; i++) m.record(false);
  assert.equal(trips.length, 1);
  advance(31_000);
  for (let i = 0; i < 5; i++) m.record(false);
  assert.equal(trips.length, 2);
});
