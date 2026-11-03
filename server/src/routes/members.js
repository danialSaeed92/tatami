// Members roster (with attendance %) and coach-managed invites.

import { Router } from 'express';
import crypto from 'node:crypto';
import { requireAuth, requireCoach, toUser } from '../auth.js';
import { nowIso } from '../db.js';
import { attendanceStats } from '../stats.js';

const BELTS = ['white', 'yellow', 'orange', 'green', 'blue', 'brown', 'black'];

export function memberRoutes(db) {
  const r = Router();
  r.use(requireAuth);

  r.get('/members', (req, res) => {
    const rows = db.prepare(`
      SELECT u.*, d.key AS dojo_key, d.name AS dojo_name, d.city AS dojo_city, d.plan AS dojo_plan
      FROM users u JOIN dojos d ON d.id = u.dojo_id WHERE u.dojo_id = ?
      ORDER BY CASE u.role WHEN 'coach' THEN 0 ELSE 1 END, u.name`).all(req.user.dojo.id);
    const isCoach = req.user.role === 'coach';
    const members = rows.map(toUser).map((m) => ({
      id: m.id, name: m.name, role: m.role, belt: m.belt, ageGroup: m.ageGroup, childName: m.childName,
      // Attendance is private: coaches see everyone's, members only see their own.
      attendance: m.role !== 'coach' && (isCoach || m.id === req.user.id) ? attendanceStats(db, m) : undefined,
      email: isCoach ? m.email : undefined,
      isMe: m.id === req.user.id,
    }));
    res.json({ members });
  });

  // Coaches promote belts after a grading.
  r.patch('/members/:id', requireCoach, (req, res) => {
    const { belt } = req.body ?? {};
    if (!BELTS.includes(belt)) return res.status(400).json({ error: 'Invalid belt' });
    const info = db.prepare('UPDATE users SET belt = ? WHERE id = ? AND dojo_id = ?').run(belt, req.params.id, req.user.dojo.id);
    if (!info.changes) return res.status(404).json({ error: 'Member not found' });
    res.json({ ok: true });
  });

  // ---- Invites -----------------------------------------------------------
  r.get('/invites', requireCoach, (req, res) => {
    const invites = db.prepare(`SELECT i.*, u.name AS created_by_name FROM invites i JOIN users u ON u.id = i.created_by
      WHERE i.dojo_id = ? ORDER BY i.created_at DESC`).all(req.user.dojo.id);
    res.json({
      invites: invites.map((i) => ({
        code: i.code, role: i.role, createdBy: i.created_by_name, createdAt: i.created_at, expiresAt: i.expires_at,
        uses: i.uses, maxUses: i.max_uses,
        active: !i.revoked && i.expires_at > nowIso() && i.uses < i.max_uses,
      })),
    });
  });

  r.post('/invites', requireCoach, (req, res) => {
    const role = ['student', 'parent', 'coach'].includes(req.body?.role) ? req.body.role : 'student';
    const maxUses = Math.max(1, Math.min(Number(req.body?.maxUses) || 1, 500));
    const days = Math.max(1, Math.min(Number(req.body?.days) || 14, 365));
    const code = `${role.slice(0, 3).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    db.prepare('INSERT INTO invites (code, dojo_id, role, created_by, created_at, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(code, req.user.dojo.id, role, req.user.id, nowIso(), new Date(Date.now() + days * 86_400_000).toISOString(), maxUses);
    res.status(201).json({ code });
  });

  r.delete('/invites/:code', requireCoach, (req, res) => {
    db.prepare('UPDATE invites SET revoked = 1 WHERE code = ? AND dojo_id = ?').run(req.params.code, req.user.dojo.id);
    res.json({ ok: true });
  });

  return r;
}
