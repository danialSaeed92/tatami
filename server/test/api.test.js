// API integration tests driven by LaunchDarkly's TestData source, so they run
// without a LaunchDarkly account or network access.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { integrations } from '@launchdarkly/node-server-sdk';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { initLaunchDarkly, closeLaunchDarkly, FLAGS } from '../src/launchdarkly.js';
import { createApp } from '../src/app.js';

const td = new integrations.TestData();
let server;
let base;
let ctx;
const trips = [];

before(async () => {
  const db = openDb(':memory:');
  seed(db);
  await initLaunchDarkly({ updateProcessor: td.getFactory() });
  ctx = createApp(db, { onTrip: (stats) => trips.push(stats) });
  server = ctx.app.listen(0);
  base = `http://localhost:${server.address().port}/api`;
});

after(async () => {
  server?.close();
  await closeLaunchDarkly();
});

async function login(key) {
  const res = await fetch(`${base}/auth/persona`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return (path, opts = {}) => fetch(`${base}${path}`, {
    ...opts,
    headers: { cookie, 'content-type': 'application/json', ...(opts.headers ?? {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

test('wall-reactions-comments OFF hides engagement and blocks the API', async () => {
  td.update(td.flag(FLAGS.WALL_REACTIONS).booleanFlag().variationForAll(false));
  const api = await login('student-alex');
  const posts = await (await api('/posts')).json();
  assert.equal(posts.engagementEnabled, false);
  assert.equal(posts.posts[0].comments, undefined);
  const r = await api(`/posts/${posts.posts[0].id}/reactions`, { method: 'POST', body: { emoji: '🔥' } });
  assert.equal(r.status, 404);
});

test('wall-reactions-comments ON enables comments and reactions', async () => {
  td.update(td.flag(FLAGS.WALL_REACTIONS).booleanFlag().variationForAll(true));
  const api = await login('student-alex');
  const posts = await (await api('/posts')).json();
  assert.equal(posts.engagementEnabled, true);
  const id = posts.posts[0].id;
  assert.equal((await api(`/posts/${id}/reactions`, { method: 'POST', body: { emoji: '🔥' } })).status, 200);
  assert.equal((await api(`/posts/${id}/comments`, { method: 'POST', body: { body: 'Osu!' } })).status, 201);
});

test('simulated bug trips the auto-remediation monitor', async () => {
  td.update(td.flag(FLAGS.WALL_REACTIONS).booleanFlag().variationForAll(true));
  const api = await login('student-sam');
  const { posts } = await (await api('/posts')).json();
  ctx.demo.bugEnabled = true;
  for (let i = 0; i < 20 && trips.length === 0; i++) {
    await api(`/posts/${posts[0].id}/reactions`, { method: 'POST', body: { emoji: '👏' } });
  }
  ctx.demo.bugEnabled = false;
  assert.equal(trips.length, 1);
  assert.ok(trips[0].errorRate >= 0.5);
});

test('schedule-builder gates recurring session creation', async () => {
  const api = await login('sensei-kenji');
  const body = { title: 'Comp team', type: 'class', audience: 'adults', date: '2030-01-07', time: '18:00', repeat: { weekdays: [1], until: '2030-02-04' } };
  td.update(td.flag(FLAGS.SCHEDULE_BUILDER).booleanFlag().variationForAll(false));
  assert.equal((await api('/sessions', { method: 'POST', body })).status, 403);
  // Individual targeting: only sensei-kenji gets the builder.
  td.update(td.flag(FLAGS.SCHEDULE_BUILDER).booleanFlag().variationForAll(false).variationForUser('sensei-kenji', true));
  const r = await api('/sessions', { method: 'POST', body });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).created, 5); // Mondays Jan 7 -> Feb 4, 2030
  const maria = await login('coach-maria');
  assert.equal((await maria('/sessions', { method: 'POST', body })).status, 403);
});

test('only coaches can take attendance; members can RSVP', async () => {
  const student = await login('student-alex');
  const { sessions, now } = await (await student('/sessions?mine=1')).json();
  const upcoming = sessions.find((s) => s.type === 'class' && s.startsAt > now);
  assert.equal((await student(`/sessions/${upcoming.id}/rsvp`, { method: 'PUT', body: { status: 'going' } })).status, 200);
  assert.equal((await student(`/sessions/${upcoming.id}/attendance`, { method: 'PUT', body: { records: [] } })).status, 403);
  const coach = await login('sensei-kenji');
  const detail = await (await coach(`/sessions/${upcoming.id}`)).json();
  assert.ok(detail.roster.some((m) => m.name === 'Alex Chen' && m.rsvp === 'going'));
});

test('invite-only signup', async () => {
  const bad = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'NOPE', name: 'X', email: 'x@example.com', password: 'secret1' }) });
  assert.equal(bad.status, 400);
  const ok = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'WELCOME-DOJO', name: 'New Judoka', email: 'new@example.com', password: 'secret1', belt: 'white', ageGroup: 'adults' }) });
  assert.equal(ok.status, 201);
  const { user } = await ok.json();
  assert.match(user.key, /^member-new-judoka-/);
});
