// Sensei Assistant chatbot endpoints (AI Configs).

import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { chat, describeAiConfig, recordFeedback } from '../ai.js';
import { localStamp } from '../db.js';
import { attendanceStats, audienceSql } from '../stats.js';

/** Per-member values injected into the AI Config's prompt template. */
function promptVariables(db, user) {
  const upcoming = db.prepare(`
    SELECT s.title, s.starts_at, s.type, r.status FROM sessions s
    LEFT JOIN rsvps r ON r.session_id = s.id AND r.user_id = :uid
    WHERE s.dojo_id = :dojo AND s.starts_at >= :now AND ${audienceSql('s')}
    ORDER BY s.starts_at LIMIT 6`).all({ uid: user.id, dojo: user.dojo.id, now: localStamp(), age: user.ageGroup });
  const fmt = (iso) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const stats = user.role === 'coach' ? null : attendanceStats(db, user);
  return {
    memberName: user.name,
    role: user.role,
    belt: user.belt,
    ageGroup: user.ageGroup,
    childName: user.childName ?? '',
    dojoName: user.dojo.name,
    attendancePct: stats?.pct != null ? `${stats.pct}% (${stats.attended}/${stats.eligible} classes)` : 'n/a',
    upcomingSessions: upcoming.map((s) => `- ${fmt(s.starts_at)}: ${s.title}${s.type === 'closure' ? '' : ` (RSVP: ${s.status ?? 'not answered'})`}`).join('\n') || '- nothing scheduled',
  };
}

export function chatRoutes(db) {
  const r = Router();
  r.use(requireAuth);

  r.get('/chat/config', async (req, res) => {
    res.json(await describeAiConfig(req.user, promptVariables(db, req.user)));
  });

  r.post('/chat', async (req, res) => {
    try {
      const out = await chat(req.user, req.body?.messages, promptVariables(db, req.user));
      if (out.disabled) return res.status(503).json({ error: 'Sensei Assistant is switched off right now.', disabled: true });
      res.json(out);
    } catch (err) {
      console.error('[chat] provider error:', err.message);
      res.status(502).json({ error: 'The assistant could not answer right now. Please try again.' });
    }
  });

  r.post('/chat/feedback', (req, res) => {
    const { feedbackToken, positive } = req.body ?? {};
    if (!feedbackToken) return res.status(400).json({ error: 'feedbackToken required' });
    try {
      recordFeedback(req.user, feedbackToken, Boolean(positive));
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: `Could not record feedback: ${err.message}` });
    }
  });

  return r;
}
