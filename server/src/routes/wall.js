// The dojo wall: posts, comments and emoji reactions.
//
// PART 1 - RELEASE & REMEDIATE
// Comments + reactions are the "new feature" behind the `wall-reactions-comments`
// flag. The flag is enforced here on the server as well as in the UI, so turning
// it off (by hand or with a trigger) truly removes the feature.
//
// The demo panel can switch on a *simulated bug* that makes these endpoints fail.
// Every request is reported to the ErrorRateMonitor, which fires the LaunchDarkly
// trigger when the error rate gets too high (see remediation.js).

import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { FLAGS, isEnabled } from '../launchdarkly.js';
import { nowIso } from '../db.js';

export const REACTION_EMOJI = ['🥋', '👏', '🔥', '❤️', '💪', '😂'];

export function wallRoutes(db, { demo, monitor }) {
  const r = Router();
  r.use(requireAuth);

  const reactionsOn = (user) => isEnabled(FLAGS.WALL_REACTIONS, user, false);

  r.get('/posts', async (req, res) => {
    const engagement = await reactionsOn(req.user);
    const posts = db.prepare(`
      SELECT p.id, p.body, p.pinned, p.created_at, u.id AS author_id, u.name AS author, u.role AS author_role, u.belt AS author_belt
      FROM posts p JOIN users u ON u.id = p.author_id
      WHERE p.dojo_id = ? ORDER BY p.pinned DESC, p.created_at DESC LIMIT 100`).all(req.user.dojo.id);

    const result = posts.map((p) => ({
      id: p.id,
      body: p.body,
      pinned: Boolean(p.pinned),
      createdAt: p.created_at,
      author: { id: p.author_id, name: p.author, role: p.author_role, belt: p.author_belt },
      canDelete: p.author_id === req.user.id || req.user.role === 'coach',
    }));

    if (engagement && result.length) {
      const ids = result.map((p) => p.id);
      const ph = ids.map(() => '?').join(',');
      const comments = db.prepare(`
        SELECT c.id, c.post_id, c.body, c.created_at, u.id AS author_id, u.name AS author, u.role AS author_role
        FROM comments c JOIN users u ON u.id = c.author_id WHERE c.post_id IN (${ph}) ORDER BY c.created_at`).all(...ids);
      const reactions = db.prepare(`SELECT post_id, emoji, user_id FROM reactions WHERE post_id IN (${ph})`).all(...ids);
      for (const p of result) {
        p.comments = comments.filter((c) => c.post_id === p.id).map((c) => ({
          id: c.id, body: c.body, createdAt: c.created_at,
          author: { id: c.author_id, name: c.author, role: c.author_role },
          canDelete: c.author_id === req.user.id || req.user.role === 'coach',
        }));
        p.reactions = REACTION_EMOJI.map((emoji) => {
          const rs = reactions.filter((x) => x.post_id === p.id && x.emoji === emoji);
          return { emoji, count: rs.length, mine: rs.some((x) => x.user_id === req.user.id) };
        }).filter((x) => x.count > 0);
      }
    }
    res.json({ posts: result, engagementEnabled: engagement, emoji: REACTION_EMOJI });
  });

  r.post('/posts', (req, res) => {
    const body = String(req.body?.body ?? '').trim();
    if (!body) return res.status(400).json({ error: 'Write something first.' });
    if (body.length > 2000) return res.status(400).json({ error: 'Posts are limited to 2000 characters.' });
    const pinned = req.user.role === 'coach' && req.body?.pinned ? 1 : 0;
    const info = db.prepare('INSERT INTO posts (dojo_id, author_id, body, pinned, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.dojo.id, req.user.id, body, pinned, nowIso());
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.delete('/posts/:id', (req, res) => {
    const post = db.prepare('SELECT author_id FROM posts WHERE id = ? AND dojo_id = ?').get(req.params.id, req.user.dojo.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.author_id !== req.user.id && req.user.role !== 'coach') return res.status(403).json({ error: 'Not allowed' });
    db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---- Flagged feature: comments & reactions -----------------------------
  // Guard used by every engagement endpoint:
  //   1. flag OFF  -> 404, the feature does not exist for this user
  //   2. simulated bug ON -> most requests fail with a 500 (what a bad deploy looks like)
  //   3. every outcome is fed to the error-rate monitor
  async function engagementGuard(req, res, next) {
    if (!(await reactionsOn(req.user))) {
      return res.status(404).json({ error: 'Comments and reactions are not available right now.', flagOff: true });
    }
    if (demo.bugEnabled && Math.random() < 0.8) {
      monitor.record(false);
      console.error(`[wall] simulated bug: ${req.method} ${req.originalUrl} failed`);
      return res.status(500).json({ error: 'Something went wrong saving that. (Simulated bug: duplicate-write race in reactions service)' });
    }
    res.on('finish', () => monitor.record(res.statusCode < 500));
    next();
  }

  function postInDojo(req) {
    return db.prepare('SELECT id FROM posts WHERE id = ? AND dojo_id = ?').get(req.params.id, req.user.dojo.id);
  }

  // Toggle a reaction (click once to add, again to remove).
  r.post('/posts/:id/reactions', engagementGuard, (req, res) => {
    const { emoji } = req.body ?? {};
    if (!REACTION_EMOJI.includes(emoji)) return res.status(400).json({ error: 'Unsupported reaction' });
    if (!postInDojo(req)) return res.status(404).json({ error: 'Post not found' });
    const existing = db.prepare('SELECT 1 FROM reactions WHERE post_id = ? AND user_id = ? AND emoji = ?').get(req.params.id, req.user.id, emoji);
    if (existing) db.prepare('DELETE FROM reactions WHERE post_id = ? AND user_id = ? AND emoji = ?').run(req.params.id, req.user.id, emoji);
    else db.prepare('INSERT INTO reactions (post_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(req.params.id, req.user.id, emoji, nowIso());
    res.json({ reacted: !existing });
  });

  r.post('/posts/:id/comments', engagementGuard, (req, res) => {
    const body = String(req.body?.body ?? '').trim();
    if (!body) return res.status(400).json({ error: 'Comment is empty' });
    if (body.length > 1000) return res.status(400).json({ error: 'Comments are limited to 1000 characters.' });
    if (!postInDojo(req)) return res.status(404).json({ error: 'Post not found' });
    const info = db.prepare('INSERT INTO comments (post_id, author_id, body, created_at) VALUES (?, ?, ?, ?)').run(req.params.id, req.user.id, body, nowIso());
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.delete('/comments/:id', engagementGuard, (req, res) => {
    const c = db.prepare('SELECT c.author_id FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ? AND p.dojo_id = ?').get(req.params.id, req.user.dojo.id);
    if (!c) return res.status(404).json({ error: 'Comment not found' });
    if (c.author_id !== req.user.id && req.user.role !== 'coach') return res.status(403).json({ error: 'Not allowed' });
    db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  return r;
}
