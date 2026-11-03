// EXTRA CREDIT - AI CONFIGS: Sensei Assistant chat widget.
// The prompt and model are chosen server-side by the LaunchDarkly AI Config
// `sensei-assistant`; this widget shows which model answered and collects
// thumbs-up/down feedback that is sent back to LaunchDarkly.

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../App.jsx';
import { api } from '../lib/api.js';

export default function ChatWidget() {
  const { user } = useAuth();
  const [cfg, setCfg] = useState(null);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  // Re-read the AI Config whenever the member changes or the widget opens,
  // so a variation change in LaunchDarkly is reflected right away.
  useEffect(() => {
    api.get('/chat/config').then(setCfg).catch(() => setCfg(null));
  }, [user.key, open]);

  useEffect(() => { setMessages([]); }, [user.key]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  if (!cfg?.enabled) return null; // AI Config disabled -> no assistant

  async function send(e) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const r = await api.post('/chat', { messages: next.map(({ role, content }) => ({ role, content })) });
      setMessages([...next, { role: 'assistant', content: r.reply, meta: r }]);
    } catch (err) {
      setMessages([...next, { role: 'assistant', content: err.message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  async function feedback(i, positive) {
    const m = messages[i];
    if (!m.meta?.feedbackToken || m.feedback !== undefined) return;
    await api.post('/chat/feedback', { feedbackToken: m.meta.feedbackToken, positive }).catch(() => {});
    setMessages((ms) => ms.map((x, j) => (j === i ? { ...x, feedback: positive } : x)));
  }

  const suggestions = user.role === 'parent'
    ? ['When is the next kids class?', 'What should my child bring to a grading?']
    : ['When is my next class?', 'How do I tie my belt?', 'Am I ready for my next grading?'];

  return (
    <>
      <button className="chat-fab" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? '✕' : '🥋 Ask Sensei'}
      </button>
      {open && (
        <section className="chat" aria-label="Sensei Assistant">
          <header>
            <div>
              <strong>Sensei Assistant</strong>
              <span className="small muted">{cfg.provider} · <span className="mono">{cfg.model}</span>{cfg.mode === 'mock' ? ' · offline mode' : ''}</span>
            </div>
          </header>
          <div className="chat-log">
            {messages.length === 0 && (
              <div className="chat-empty">
                <p>Osu! Ask me about your schedule, gradings, belts or dojo etiquette.</p>
                {suggestions.map((s) => <button key={s} className="chip" onClick={() => setInput(s)}>{s}</button>)}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`bubble ${m.role} ${m.error ? 'error' : ''}`}>
                <div className="bubble-text">{m.content}</div>
                {m.meta && (
                  <div className="bubble-meta">
                    <span className="mono">{m.meta.model}</span>
                    {m.meta.variationKey && <span> · variation <span className="mono">{m.meta.variationKey}</span></span>}
                    <span className="fb">
                      <button aria-label="Helpful" className={m.feedback === true ? 'on' : ''} onClick={() => feedback(i, true)} disabled={m.feedback !== undefined}>👍</button>
                      <button aria-label="Not helpful" className={m.feedback === false ? 'on' : ''} onClick={() => feedback(i, false)} disabled={m.feedback !== undefined}>👎</button>
                    </span>
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="bubble assistant typing"><span /><span /><span /></div>}
            <div ref={endRef} />
          </div>
          <form className="chat-input" onSubmit={send}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask Sensei…" maxLength={1000} />
            <button className="btn primary" disabled={busy || !input.trim()}>Send</button>
          </form>
        </section>
      )}
    </>
  );
}
