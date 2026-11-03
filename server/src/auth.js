// Minimal cookie-based auth: a signed JWT in an httpOnly cookie.
// Good enough for a demo; swap for your IdP (Auth0, Okta, ...) in production.

import jwt from 'jsonwebtoken';
import { config } from './config.js';

const COOKIE = 'tatami_session';

/** Load a user row + dojo and shape it for the API (and for LaunchDarkly contexts). */
export function loadUser(db, where, value) {
  const row = db.prepare(`
    SELECT u.*, d.key AS dojo_key, d.name AS dojo_name, d.city AS dojo_city, d.plan AS dojo_plan
    FROM users u JOIN dojos d ON d.id = u.dojo_id WHERE u.${where} = ?`).get(value);
  return row ? toUser(row) : null;
}

export function toUser(row) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    email: row.email,
    role: row.role,
    belt: row.belt,
    ageGroup: row.age_group,
    childName: row.child_name,
    betaTester: Boolean(row.beta_tester),
    isDemo: Boolean(row.is_demo),
    createdAt: row.created_at,
    dojo: { id: row.dojo_id, key: row.dojo_key, name: row.dojo_name, city: row.dojo_city, plan: row.dojo_plan },
  };
}

export function setSession(res, user) {
  const token = jwt.sign({ uid: user.id }, config.jwtSecret, { expiresIn: '7d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    maxAge: 7 * 86_400_000,
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE);
}

/** Express middleware: attaches req.user if the cookie is valid. */
export function authenticate(db) {
  return (req, _res, next) => {
    const token = req.cookies?.[COOKIE];
    if (token) {
      try {
        const { uid } = jwt.verify(token, config.jwtSecret);
        req.user = loadUser(db, 'id', uid);
      } catch {
        /* expired or tampered - treat as signed out */
      }
    }
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  next();
}

export function requireCoach(req, res, next) {
  if (req.user?.role !== 'coach') return res.status(403).json({ error: 'Only coaches can do that.' });
  next();
}
