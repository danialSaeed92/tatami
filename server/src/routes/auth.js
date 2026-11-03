// Sign in / sign up. Signup is INVITE-ONLY: a coach creates an invite link
// (/join/<code>) and only people holding a valid code can create an account.

import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { loadUser, setSession, clearSession } from '../auth.js';
import { config } from '../config.js';
import { nowIso, localStamp } from '../db.js';
import { buildContext } from '../launchdarkly.js';

const BELTS = ['white', 'yellow', 'orange', 'green', 'blue', 'brown', 'black'];
const AGE_GROUPS = ['kids', 'teens', 'adults'];

function inviteStatus(db, code) {
  const invite = db.prepare(`
    SELECT i.*, d.name AS dojo_name, u.name AS inviter
    FROM invites i JOIN dojos d ON d.id = i.dojo_id JOIN users u ON u.id = i.created_by
    WHERE i.code = ?`).get(String(code).toUpperCase());
  if (!invite) return { valid: false, reason: 'This invite link does not exist.' };
  if (invite.revoked) return { valid: false, reason: 'This invite was revoked by a coach.' };
  if (invite.expires_at < nowIso()) return { valid: false, reason: 'This invite has expired. Ask your coach for a new one.' };
  if (invite.uses >= invite.max_uses) return { valid: false, reason: 'This invite has already been used.' };
  return { valid: true, invite };
}

export function authRoutes(db) {
  const r = Router();

  r.get('/auth/me', (req, res) => {
    if (!req.user) return res.json({ user: null });
    // The browser uses `ldContext` verbatim with ldClient.identify(), so client
    // and server evaluate flags against exactly the same context.
    res.json({ user: req.user, ldContext: buildContext(req.user) });
  });

  r.post('/auth/login', (req, res) => {
    const { email, password } = req.body ?? {};
    const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(String(email ?? '').toLowerCase().trim());
    if (!row || !bcrypt.compareSync(String(password ?? ''), row.password_hash)) {
      return res.status(401).json({ error: 'Wrong email or password.' });
    }
    const user = loadUser(db, 'id', row.id);
    setSession(res, user);
    res.json({ user });
  });

  r.post('/auth/logout', (_req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  // ---- Demo persona switcher (DEMO_MODE only) -----------------------------
  // Lets a presenter jump between users with different context attributes to
  // show individual + rule-based targeting without typing passwords.
  r.get('/auth/personas', (_req, res) => {
    if (!config.demoMode) return res.json({ personas: [] });
    const rows = db.prepare('SELECT key, name, role, belt, age_group, beta_tester, email, child_name FROM users WHERE is_demo = 1 ORDER BY id').all();
    res.json({ personas: rows.map((p) => ({ key: p.key, name: p.name, role: p.role, belt: p.belt, ageGroup: p.age_group, betaTester: Boolean(p.beta_tester), email: p.email, childName: p.child_name })) });
  });

  r.post('/auth/persona', (req, res) => {
    if (!config.demoMode) return res.status(404).end();
    const user = loadUser(db, 'key', String(req.body?.key ?? ''));
    if (!user) return res.status(404).json({ error: 'Unknown persona' });
    setSession(res, user);
    res.json({ user });
  });

  // ---- Invite-only signup --------------------------------------------------
  r.get('/invites/:code', (req, res) => {
    const status = inviteStatus(db, req.params.code);
    if (!status.valid) return res.json({ valid: false, reason: status.reason });
    const { invite } = status;
    res.json({ valid: true, role: invite.role, dojoName: invite.dojo_name, invitedBy: invite.inviter });
  });

  r.post('/auth/signup', (req, res) => {
    const { code, name, email, password, belt = 'white', ageGroup = 'adults', childName } = req.body ?? {};
    const status = inviteStatus(db, code ?? '');
    if (!status.valid) return res.status(400).json({ error: status.reason });
    const { invite } = status;

    const cleanEmail = String(email ?? '').toLowerCase().trim();
    if (!name?.trim() || !/^\S+@\S+\.\S+$/.test(cleanEmail)) return res.status(400).json({ error: 'Name and a valid email are required.' });
    if (String(password ?? '').length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (!BELTS.includes(belt) || !AGE_GROUPS.includes(ageGroup)) return res.status(400).json({ error: 'Invalid belt or age group.' });
    if (invite.role === 'parent' && !childName?.trim()) return res.status(400).json({ error: "Please enter your child's name." });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(cleanEmail)) return res.status(409).json({ error: 'An account with that email already exists. Sign in instead.' });

    // Stable, unique LaunchDarkly context key for the new member.
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 24);
    const key = `member-${slug}-${crypto.randomBytes(3).toString('hex')}`;
    const effectiveAge = invite.role === 'parent' ? 'kids' : ageGroup;

    db.prepare(`INSERT INTO users (key, dojo_id, name, email, password_hash, role, belt, age_group, child_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      key, invite.dojo_id, name.trim(), cleanEmail, bcrypt.hashSync(password, 10), invite.role,
      invite.role === 'coach' ? 'black' : belt, effectiveAge, invite.role === 'parent' ? childName.trim() : null, localStamp(),
    );
    db.prepare('UPDATE invites SET uses = uses + 1 WHERE code = ?').run(invite.code);

    const user = loadUser(db, 'key', key);
    setSession(res, user);
    res.status(201).json({ user });
  });

  return r;
}
