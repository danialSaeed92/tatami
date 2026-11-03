// Seeds one dojo, a set of demo personas and a full season (Sep -> Aug) of
// classes, gradings, tournaments and closures, plus past attendance and a
// few wall posts. The season is computed from today's date so the demo always
// has past sessions (with attendance) and upcoming sessions (to RSVP to).
//
//   npm run seed          # wipe and re-seed (from the repo root)
//
// The server also seeds automatically on first start if the database is empty.

import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { openDb, tx, localStamp, nowIso } from './db.js';

export const DEMO_PASSWORD = 'judo123';

// Deterministic PRNG so every seed produces the same demo data.
function mulberry32(seed) {
  return function rand() {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Demo personas. `key` is the LaunchDarkly context key - the individual
// targeting demo targets `sensei-kenji` by this key.
const PEOPLE = [
  { key: 'sensei-kenji', name: 'Kenji Watanabe', email: 'kenji@tatami.dojo', role: 'coach', belt: 'black', age: 'adults', demo: 1, blurb: 'Head coach' },
  { key: 'coach-maria', name: 'Maria Silva', email: 'maria@tatami.dojo', role: 'coach', belt: 'black', age: 'adults', demo: 1, blurb: 'Assistant coach' },
  { key: 'student-alex', name: 'Alex Chen', email: 'alex.chen@example.com', role: 'student', belt: 'brown', age: 'adults', demo: 1, blurb: 'Brown belt adult', rate: 0.85 },
  { key: 'student-priya', name: 'Priya Patel', email: 'priya.p@example.com', role: 'student', belt: 'green', age: 'teens', beta: 1, demo: 1, blurb: 'Teen, beta tester', rate: 0.7 },
  { key: 'parent-aiko', name: 'Aiko Tanaka', email: 'aiko.tanaka@example.com', role: 'parent', belt: 'yellow', age: 'kids', child: 'Yuki Tanaka', demo: 1, blurb: 'Parent of a kids-class judoka', rate: 0.8 },
  { key: 'student-sam', name: 'Sam Okafor', email: 'sam.okafor@example.com', role: 'student', belt: 'white', age: 'adults', demo: 1, blurb: 'New white belt', rate: 0.55 },
  // Roster filler (no persona button, but they can still log in with the demo password).
  { key: 'student-lucas', name: 'Lucas Moreau', email: 'lucas.m@example.com', role: 'student', belt: 'orange', age: 'adults', rate: 0.6 },
  { key: 'student-emma', name: 'Emma Johansson', email: 'emma.j@example.com', role: 'student', belt: 'blue', age: 'adults', rate: 0.75 },
  { key: 'student-diego', name: 'Diego Ramirez', email: 'diego.r@example.com', role: 'student', belt: 'black', age: 'adults', rate: 0.9 },
  { key: 'student-hana', name: 'Hana Kim', email: 'hana.kim@example.com', role: 'student', belt: 'yellow', age: 'teens', rate: 0.65 },
  { key: 'parent-omar', name: 'Omar Haddad', email: 'omar.h@example.com', role: 'parent', belt: 'white', age: 'kids', child: 'Layla Haddad', rate: 0.7 },
  { key: 'parent-grace', name: 'Grace Liu', email: 'grace.liu@example.com', role: 'parent', belt: 'orange', age: 'kids', child: 'Ethan Liu', rate: 0.9 },
  { key: 'parent-ben', name: 'Ben Carter', email: 'ben.carter@example.com', role: 'parent', belt: 'yellow', age: 'kids', child: 'Mila Carter', rate: 0.5 },
];

// ---------------------------------------------------------------------------
// Date helpers (all dojo-local wall-clock time)
// ---------------------------------------------------------------------------
const d = (y, m, day) => new Date(y, m, day);
const ymd = (date) => localStamp(date).slice(0, 10);
const at = (date, hhmm) => `${ymd(date)}T${hhmm}`;
function nthWeekday(year, month, weekday, n) {
  const first = d(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return d(year, month, 1 + offset + 7 * (n - 1));
}
function lastWeekday(year, month, weekday) {
  const last = d(year, month + 1, 0);
  return d(year, month, last.getDate() - ((last.getDay() - weekday + 7) % 7));
}

export function seasonBounds(today = new Date()) {
  // Season runs 1 Sep -> 31 Aug.
  const startYear = today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1;
  return { startYear, start: d(startYear, 8, 1), end: d(startYear + 1, 7, 31) };
}

function buildSeason(startYear) {
  const y1 = startYear;
  const y2 = startYear + 1;
  const sessions = [];

  // Closures (no regular classes on these dates)
  const closures = [
    { title: 'Dojo closed - Thanksgiving', from: nthWeekday(y1, 10, 4, 4), to: nthWeekday(y1, 10, 4, 4) },
    { title: 'Dojo closed - Winter break', from: d(y1, 11, 21), to: d(y2, 0, 3) },
    { title: 'Dojo closed - Spring break', from: nthWeekday(y2, 3, 1, 1), to: d(y2, 3, nthWeekday(y2, 3, 1, 1).getDate() + 6) },
  ];
  const closedDays = new Set();
  for (const c of closures) {
    for (let x = new Date(c.from); x <= c.to; x.setDate(x.getDate() + 1)) closedDays.add(ymd(x));
    const days = Math.round((c.to - c.from) / 86_400_000) + 1;
    sessions.push({ title: c.title, type: 'closure', audience: 'all', starts_at: at(c.from, '00:00'), duration_min: days * 24 * 60, description: 'No classes. Enjoy the time off and stay safe!' });
  }

  // Weekly timetable. Summer (Jul/Aug) only keeps Saturday open mat.
  const timetable = [
    { dow: 1, time: '17:00', title: 'Kids Judo (6-12)', audience: 'kids', dur: 60, desc: 'Ukemi, games and fundamentals. Parents welcome to watch.', series: 'kids-mon' },
    { dow: 3, time: '17:00', title: 'Kids Judo (6-12)', audience: 'kids', dur: 60, desc: 'Ukemi, games and fundamentals. Parents welcome to watch.', series: 'kids-wed' },
    { dow: 2, time: '19:00', title: 'Teens & Adults Fundamentals', audience: 'adults', dur: 90, desc: 'Tachi-waza technique, drilling and light randori.', series: 'adults-tue' },
    { dow: 4, time: '19:00', title: 'Teens & Adults Fundamentals', audience: 'adults', dur: 90, desc: 'Ne-waza focus, drilling and randori.', series: 'adults-thu' },
    { dow: 6, time: '10:00', title: 'Open Mat & Randori', audience: 'all', dur: 90, desc: 'Free practice for all grades. Coaches on the mat.', series: 'open-sat', summer: true },
  ];
  const { start, end } = seasonBounds(d(y1, 9, 1));
  for (let x = new Date(start); x <= end; x.setDate(x.getDate() + 1)) {
    if (closedDays.has(ymd(x))) continue;
    const summer = x.getMonth() === 6 || x.getMonth() === 7;
    for (const t of timetable) {
      if (t.dow !== x.getDay() || (summer && !t.summer)) continue;
      sessions.push({ title: t.title, type: 'class', audience: t.audience, starts_at: at(x, t.time), duration_min: t.dur, description: t.desc, series_id: `seed-${t.series}` });
    }
  }

  // Key events of the season
  const gradingDesc = 'Kyu grading. Bring your judogi, belt and grading booklet. Minimum 75% attendance since your last grading is required.';
  sessions.push(
    { title: 'Winter Kyu Grading', type: 'grading', audience: 'all', starts_at: at(nthWeekday(y1, 11, 6, 2), '10:00'), duration_min: 180, description: gradingDesc },
    { title: 'Spring Kyu Grading', type: 'grading', audience: 'all', starts_at: at(nthWeekday(y2, 2, 6, 2), '10:00'), duration_min: 180, description: gradingDesc },
    { title: 'Summer Kyu Grading', type: 'grading', audience: 'all', starts_at: at(nthWeekday(y2, 5, 6, 2), '10:00'), duration_min: 180, description: gradingDesc },
    { title: 'Bay Area Judo Open', type: 'tournament', audience: 'all', starts_at: at(nthWeekday(y2, 1, 6, 3), '08:30'), duration_min: 480, location: 'City Sports Center', description: 'Regional shiai for all ages. Register with Sensei Kenji by the end of January.' },
    { title: 'Club Kids Shiai', type: 'tournament', audience: 'kids', starts_at: at(nthWeekday(y1, 9, 6, 4), '09:00'), duration_min: 240, description: 'Friendly in-house competition for the kids class.' },
    { title: 'Guest Newaza Seminar', type: 'seminar', audience: 'adults', starts_at: at(lastWeekday(y2, 3, 6), '13:00'), duration_min: 180, description: 'Three hours of groundwork with a visiting coach. Open to orange belt and above.' },
    { title: 'End-of-season Sayonara Party', type: 'event', audience: 'all', starts_at: at(lastWeekday(y2, 5, 5), '18:00'), duration_min: 180, location: 'Dojo lobby', description: 'Potluck, awards and belt certificates. Families welcome!' },
    { title: 'Summer Camp (Mon-Fri)', type: 'event', audience: 'kids', starts_at: at(nthWeekday(y2, 6, 1, 2), '09:00'), duration_min: 5 * 24 * 60, description: 'Five mornings of judo, games and fun for the kids class.' },
  );

  return sessions.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

function audienceMatches(sessionAudience, ageGroup) {
  if (sessionAudience === 'all') return true;
  return sessionAudience === 'kids' ? ageGroup === 'kids' : ageGroup !== 'kids';
}

export function seed(db) {
  const rand = mulberry32(1882); // 1882: the year judo was founded
  const { startYear, start } = seasonBounds();
  const now = localStamp();
  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  tx(db, () => {
    const dojo = db.prepare("INSERT INTO dojos (key, name, city, plan) VALUES ('dojo-tatami-sf', 'Tatami Judo Club', 'San Francisco', 'club')").run();
    const dojoId = Number(dojo.lastInsertRowid);
    const joined = localStamp(start);

    const insertUser = db.prepare(`INSERT INTO users (key, dojo_id, name, email, password_hash, role, belt, age_group, child_name, beta_tester, is_demo, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const users = PEOPLE.map((p) => {
      const r = insertUser.run(p.key, dojoId, p.name, p.email, passwordHash, p.role, p.belt, p.age, p.child ?? null, p.beta ?? 0, p.demo ?? 0, joined);
      return { ...p, id: Number(r.lastInsertRowid) };
    });
    const kenji = users[0];

    const insertSession = db.prepare(`INSERT INTO sessions (dojo_id, title, type, audience, starts_at, duration_min, location, description, series_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertAttendance = db.prepare('INSERT INTO attendance (session_id, user_id, present, marked_by, marked_at) VALUES (?, ?, ?, ?, ?)');
    const insertRsvp = db.prepare('INSERT INTO rsvps (session_id, user_id, status, updated_at) VALUES (?, ?, ?, ?)');

    const twoWeeksOut = localStamp(new Date(Date.now() + 14 * 86_400_000));
    for (const s of buildSeason(startYear)) {
      const r = insertSession.run(dojoId, s.title, s.type, s.audience, s.starts_at, s.duration_min, s.location ?? 'Main mat', s.description, s.series_id ?? null, kenji.id);
      const sessionId = Number(r.lastInsertRowid);
      if (s.type !== 'class') continue;
      const members = users.filter((u) => u.role !== 'coach' && audienceMatches(s.audience, u.age));
      if (s.starts_at < now) {
        // Past class: coach has taken attendance.
        for (const u of members) insertAttendance.run(sessionId, u.id, rand() < u.rate ? 1 : 0, kenji.id, s.starts_at);
      } else if (s.starts_at < twoWeeksOut) {
        // Upcoming class: some members have already RSVP'd (demo personas left blank so you can click).
        for (const u of members.filter((m) => !m.demo)) {
          const roll = rand();
          if (roll < 0.6) insertRsvp.run(sessionId, u.id, 'going', nowIso());
          else if (roll < 0.75) insertRsvp.run(sessionId, u.id, 'not_going', nowIso());
          else if (roll < 0.85) insertRsvp.run(sessionId, u.id, 'maybe', nowIso());
        }
      }
    }

    // Wall
    const ago = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
    const insertPost = db.prepare('INSERT INTO posts (dojo_id, author_id, body, pinned, created_at) VALUES (?, ?, ?, ?, ?)');
    const insertComment = db.prepare('INSERT INTO comments (post_id, author_id, body, created_at) VALUES (?, ?, ?, ?)');
    const insertReaction = db.prepare('INSERT INTO reactions (post_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)');
    const byKey = Object.fromEntries(users.map((u) => [u.key, u]));

    const wall = [
      { by: 'sensei-kenji', pinned: 1, h: 200, body: `Welcome to the ${startYear}-${String(startYear + 1).slice(2)} season at Tatami Judo Club! 🥋\n\nPlease RSVP to each class on the Schedule tab so we can plan partners and mat space. Gradings, tournaments and closures are all on the yearly calendar.`, comments: [['parent-aiko', 'Thank you Sensei! Yuki is so excited for this year.', 190]], reactions: { '🥋': ['student-alex', 'student-priya', 'parent-aiko', 'student-diego'], '❤️': ['parent-grace', 'parent-omar'] } },
      { by: 'coach-maria', h: 30, body: 'Winter Kyu Grading is coming up. Kids: practice your breakfalls at home (on a soft surface!). Adults: we will run grading prep on Thursday nights.', comments: [['student-sam', 'Is the grading open to white belts who joined this season?', 28], ['coach-maria', 'Yes Sam, if you hit the attendance requirement. Check your profile on the Members page.', 27]], reactions: { '👏': ['student-sam', 'student-emma'], '🔥': ['student-alex'] } },
      { by: 'student-alex', h: 5, body: 'Great randori session on Saturday. Thanks to everyone who stayed for the extra ne-waza rounds!', comments: [['student-diego', 'Your sankaku is getting dangerous 😅', 4]], reactions: { '🔥': ['student-diego', 'coach-maria'], '👏': ['sensei-kenji'] } },
    ];
    for (const p of wall) {
      const r = insertPost.run(dojoId, byKey[p.by].id, p.body, p.pinned ?? 0, ago(p.h));
      const postId = Number(r.lastInsertRowid);
      for (const [who, body, h] of p.comments) insertComment.run(postId, byKey[who].id, body, ago(h));
      for (const [emoji, who] of Object.entries(p.reactions)) for (const k of who) insertReaction.run(postId, byKey[k].id, emoji, ago(p.h - 1));
    }

    // A ready-to-use invite link for the signup demo: /join/WELCOME-DOJO
    db.prepare('INSERT INTO invites (code, dojo_id, role, created_by, created_at, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('WELCOME-DOJO', dojoId, 'student', kenji.id, nowIso(), new Date(Date.now() + 365 * 86_400_000).toISOString(), 1000);
  });
}

export function isEmpty(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM dojos').get().n === 0;
}

// `node src/seed.js --reset` wipes the database file and re-seeds.
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--reset')) {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(config.dbFile + suffix, { force: true });
  }
  const db = openDb(config.dbFile);
  if (isEmpty(db)) {
    seed(db);
    console.log(`Seeded ${config.dbFile}. Demo password for every persona: ${DEMO_PASSWORD}`);
  } else {
    console.log('Database already has data. Use --reset to wipe it.');
  }
}
