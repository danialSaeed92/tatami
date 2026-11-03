// SQLite persistence using Node's built-in `node:sqlite` module (Node >= 22.13),
// so there are no native dependencies to compile.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS dojos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  city        TEXT NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'club'
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT NOT NULL UNIQUE,          -- stable LaunchDarkly context key
  dojo_id       INTEGER NOT NULL REFERENCES dojos(id),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('coach','student','parent')),
  belt          TEXT NOT NULL DEFAULT 'white',
  age_group     TEXT NOT NULL DEFAULT 'adults' CHECK (age_group IN ('kids','teens','adults')),
  child_name    TEXT,                          -- parents register on behalf of a kids-class judoka
  beta_tester   INTEGER NOT NULL DEFAULT 0,
  is_demo       INTEGER NOT NULL DEFAULT 0,    -- shown in the persona switcher
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  code        TEXT PRIMARY KEY,
  dojo_id     INTEGER NOT NULL REFERENCES dojos(id),
  role        TEXT NOT NULL CHECK (role IN ('coach','student','parent')),
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  max_uses    INTEGER NOT NULL DEFAULT 25,
  uses        INTEGER NOT NULL DEFAULT 0,
  revoked     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  dojo_id      INTEGER NOT NULL REFERENCES dojos(id),
  title        TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('class','grading','tournament','seminar','event','closure')),
  audience     TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('kids','adults','all')),
  starts_at    TEXT NOT NULL,                  -- dojo-local time, 'YYYY-MM-DDTHH:MM'
  duration_min INTEGER NOT NULL DEFAULT 60,
  location     TEXT NOT NULL DEFAULT 'Main mat',
  description  TEXT NOT NULL DEFAULT '',
  series_id    TEXT,                           -- groups sessions created by the recurring builder
  created_by   INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_start ON sessions(dojo_id, starts_at);

CREATE TABLE IF NOT EXISTS rsvps (
  session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  status      TEXT NOT NULL CHECK (status IN ('going','not_going','maybe')),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS attendance (
  session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  present     INTEGER NOT NULL,
  marked_by   INTEGER REFERENCES users(id),
  marked_at   TEXT NOT NULL,
  PRIMARY KEY (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  dojo_id     INTEGER NOT NULL REFERENCES dojos(id),
  author_id   INTEGER NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  pinned      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id   INTEGER NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reactions (
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  emoji       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id, emoji)
);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

/** Run `fn` inside a transaction. */
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Dojo-local timestamp in the 'YYYY-MM-DDTHH:MM' format used by the schema. */
export function localStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

export function nowIso() {
  return new Date().toISOString();
}
