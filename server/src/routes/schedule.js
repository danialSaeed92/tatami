// Yearly schedule, session creation, RSVPs and attendance.

import { Router } from 'express';
import crypto from 'node:crypto';
import { requireAuth, requireCoach, loadUser } from '../auth.js';
import { FLAGS, isEnabled } from '../launchdarkly.js';
import { localStamp, nowIso, tx } from '../db.js';
import { seasonBounds } from '../seed.js';
import { audienceSql } from '../stats.js';

const TYPES = ['class', 'grading', 'tournament', 'seminar', 'event', 'closure'];
const AUDIENCES = ['kids', 'adults', 'all'];
const RSVP = ['going', 'not_going', 'maybe'];
const MAX_OCCURRENCES = 400;

function shapeSession(s) {
  return {
    id: s.id,
    title: s.title,
    type: s.type,
    audience: s.audience,
    startsAt: s.starts_at,
    durationMin: s.duration_min,
    location: s.location,
    description: s.description,
    seriesId: s.series_id,
    rsvp: s.type === 'closure' ? null : { going: s.going ?? 0, maybe: s.maybe ?? 0, notGoing: s.not_going ?? 0, mine: s.my_rsvp ?? null },
    attended: s.my_present === undefined || s.my_present === null ? null : Boolean(s.my_present),
  };
}

export function scheduleRoutes(db) {
  const r = Router();
  r.use(requireAuth);

  // GET /api/sessions?from=YYYY-MM-DD&to=YYYY-MM-DD&mine=1  (defaults to the current season)
  r.get('/sessions', (req, res) => {
    const season = seasonBounds();
    const from = (req.query.from || localStamp(season.start).slice(0, 10)) + 'T00:00';
    const to = (req.query.to || localStamp(season.end).slice(0, 10)) + 'T23:59';
    const mine = req.query.mine === '1';
    const rows = db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM rsvps r WHERE r.session_id = s.id AND r.status = 'going') AS going,
        (SELECT COUNT(*) FROM rsvps r WHERE r.session_id = s.id AND r.status = 'maybe') AS maybe,
        (SELECT COUNT(*) FROM rsvps r WHERE r.session_id = s.id AND r.status = 'not_going') AS not_going,
        (SELECT status FROM rsvps r WHERE r.session_id = s.id AND r.user_id = :uid) AS my_rsvp,
        (SELECT present FROM attendance a WHERE a.session_id = s.id AND a.user_id = :uid) AS my_present
      FROM sessions s
      WHERE s.dojo_id = :dojo AND s.starts_at BETWEEN :from AND :to
        ${mine ? `AND ${audienceSql('s')}` : ''}
      ORDER BY s.starts_at`).all({ uid: req.user.id, dojo: req.user.dojo.id, from, to, ...(mine ? { age: req.user.ageGroup } : {}) });
    res.json({
      season: { label: `${season.startYear}-${String(season.startYear + 1).slice(2)}`, start: localStamp(season.start).slice(0, 10), end: localStamp(season.end).slice(0, 10) },
      now: localStamp(),
      sessions: rows.map(shapeSession),
    });
  });

  r.get('/sessions/:id', (req, res) => {
    const s = db.prepare('SELECT * FROM sessions WHERE id = ? AND dojo_id = ?').get(req.params.id, req.user.dojo.id);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    // Everyone sees who is coming; coaches also get the full roster to take attendance.
    const roster = db.prepare(`
      SELECT u.id, u.name, u.role, u.belt, u.age_group, u.child_name, r.status AS rsvp, a.present
      FROM users u
      LEFT JOIN rsvps r ON r.session_id = :sid AND r.user_id = u.id
      LEFT JOIN attendance a ON a.session_id = :sid AND a.user_id = u.id
      WHERE u.dojo_id = :dojo AND u.role != 'coach'
        AND (:aud = 'all' OR (:aud = 'kids' AND u.age_group = 'kids') OR (:aud = 'adults' AND u.age_group != 'kids'))
      ORDER BY u.name`).all({ sid: s.id, dojo: req.user.dojo.id, aud: s.audience });
    const people = roster.map((m) => ({
      id: m.id, name: m.child_name ? `${m.child_name}` : m.name, parent: m.child_name ? m.name : null,
      belt: m.belt, rsvp: m.rsvp, present: m.present === null ? null : Boolean(m.present),
    }));
    const mine = db.prepare('SELECT status FROM rsvps WHERE session_id = ? AND user_id = ?').get(s.id, req.user.id);
    res.json({
      session: shapeSession({ ...s, my_rsvp: mine?.status }),
      now: localStamp(),
      going: people.filter((p) => p.rsvp === 'going').map((p) => p.name),
      roster: req.user.role === 'coach' ? people : undefined,
    });
  });

  // Create a session. A repeating schedule (weekdays + end date) uses the
  // recurring builder, which is being rolled out behind `schedule-builder`.
  r.post('/sessions', requireCoach, async (req, res) => {
    const b = req.body ?? {};
    const title = String(b.title ?? '').trim();
    if (!title) return res.status(400).json({ error: 'Title is required' });
    if (!TYPES.includes(b.type) || !AUDIENCES.includes(b.audience)) return res.status(400).json({ error: 'Invalid type or audience' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date ?? '') || !/^\d{2}:\d{2}$/.test(b.time ?? '')) return res.status(400).json({ error: 'Date and time are required' });
    const duration = Math.max(15, Math.min(Number(b.durationMin) || 60, 14 * 24 * 60));

    let dates = [b.date];
    let seriesId = null;
    if (b.repeat) {
      if (!(await isEnabled(FLAGS.SCHEDULE_BUILDER, req.user, false))) {
        return res.status(403).json({ error: 'The recurring schedule builder is not enabled for your account yet.', flagOff: true });
      }
      const weekdays = (b.repeat.weekdays ?? []).map(Number).filter((n) => n >= 0 && n <= 6);
      if (!weekdays.length || !/^\d{4}-\d{2}-\d{2}$/.test(b.repeat.until ?? '')) return res.status(400).json({ error: 'Pick at least one weekday and an end date' });
      const closed = new Set();
      if (b.repeat.skipClosures !== false) {
        for (const c of db.prepare("SELECT starts_at, duration_min FROM sessions WHERE dojo_id = ? AND type = 'closure'").all(req.user.dojo.id)) {
          const startDay = new Date(c.starts_at.slice(0, 10) + 'T12:00');
          const days = Math.max(1, Math.round(c.duration_min / 1440));
          for (let i = 0; i < days; i++) closed.add(localStamp(new Date(startDay.getTime() + i * 86_400_000)).slice(0, 10));
        }
      }
      dates = [];
      const until = new Date(b.repeat.until + 'T12:00');
      for (let x = new Date(b.date + 'T12:00'); x <= until && dates.length < MAX_OCCURRENCES; x.setDate(x.getDate() + 1)) {
        const day = localStamp(x).slice(0, 10);
        if (weekdays.includes(x.getDay()) && !closed.has(day)) dates.push(day);
      }
      if (!dates.length) return res.status(400).json({ error: 'No dates match that pattern' });
      seriesId = `series-${crypto.randomBytes(4).toString('hex')}`;
    }

    const insert = db.prepare(`INSERT INTO sessions (dojo_id, title, type, audience, starts_at, duration_min, location, description, series_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const ids = tx(db, () => dates.map((day) => Number(insert.run(
      req.user.dojo.id, title, b.type, b.audience, `${day}T${b.time}`, duration,
      String(b.location ?? '').trim() || 'Main mat', String(b.description ?? '').trim(), seriesId, req.user.id,
    ).lastInsertRowid)));
    res.status(201).json({ created: ids.length, ids, seriesId });
  });

  // DELETE /api/sessions/:id?scope=series removes this and all later sessions in the series.
  r.delete('/sessions/:id', requireCoach, (req, res) => {
    const s = db.prepare('SELECT * FROM sessions WHERE id = ? AND dojo_id = ?').get(req.params.id, req.user.dojo.id);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    const info = req.query.scope === 'series' && s.series_id
      ? db.prepare('DELETE FROM sessions WHERE series_id = ? AND starts_at >= ?').run(s.series_id, s.starts_at)
      : db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id);
    res.json({ deleted: Number(info.changes) });
  });

  // Members mark whether they are coming.
  r.put('/sessions/:id/rsvp', (req, res) => {
    const status = req.body?.status;
    if (!RSVP.includes(status)) return res.status(400).json({ error: 'Status must be going, not_going or maybe' });
    const s = db.prepare('SELECT * FROM sessions WHERE id = ? AND dojo_id = ?').get(req.params.id, req.user.dojo.id);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    if (s.type === 'closure') return res.status(400).json({ error: "The dojo is closed - there's nothing to RSVP to." });
    if (s.starts_at < localStamp()) return res.status(400).json({ error: 'This session has already started.' });
    db.prepare(`INSERT INTO rsvps (session_id, user_id, status, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`)
      .run(s.id, req.user.id, status, nowIso());
    res.json({ status });
  });

  // Coaches take attendance: { records: [{ userId, present }] }
  r.put('/sessions/:id/attendance', requireCoach, (req, res) => {
    const s = db.prepare('SELECT * FROM sessions WHERE id = ? AND dojo_id = ?').get(req.params.id, req.user.dojo.id);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    const records = Array.isArray(req.body?.records) ? req.body.records : [];
    const upsert = db.prepare(`INSERT INTO attendance (session_id, user_id, present, marked_by, marked_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id, user_id) DO UPDATE SET present = excluded.present, marked_by = excluded.marked_by, marked_at = excluded.marked_at`);
    let saved = 0;
    tx(db, () => {
      for (const rec of records) {
        const member = loadUser(db, 'id', Number(rec.userId));
        if (!member || member.dojo.id !== req.user.dojo.id) continue;
        upsert.run(s.id, member.id, rec.present ? 1 : 0, req.user.id, nowIso());
        saved++;
      }
    });
    res.json({ saved });
  });

  return r;
}
