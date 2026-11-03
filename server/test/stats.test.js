import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { loadUser } from '../src/auth.js';
import { attendanceStats } from '../src/stats.js';

const db = openDb(':memory:');
seed(db);

test('attendance only counts classes for the member age group', () => {
  const kid = loadUser(db, 'key', 'parent-aiko');
  const adult = loadUser(db, 'key', 'student-alex');
  const kidStats = attendanceStats(db, kid);
  const adultStats = attendanceStats(db, adult);
  assert.ok(kidStats.eligible > 0 && adultStats.eligible > 0);
  // Every counted class must be kids/all for the kid, adults/all for the adult.
  const wrong = db.prepare(`SELECT COUNT(*) n FROM attendance a JOIN sessions s ON s.id = a.session_id WHERE a.user_id = ? AND s.audience = 'adults'`).get(kid.id).n;
  assert.equal(wrong, 0);
  assert.ok(kidStats.attended <= kidStats.eligible);
  assert.equal(kidStats.pct, Math.round((kidStats.attended / kidStats.eligible) * 100));
});

test('a member who joined today has no attendance yet', () => {
  const alex = loadUser(db, 'key', 'student-alex');
  const fresh = { ...alex, createdAt: '2999-01-01T00:00' };
  assert.deepEqual(attendanceStats(db, fresh), { eligible: 0, attended: 0, pct: null });
});
