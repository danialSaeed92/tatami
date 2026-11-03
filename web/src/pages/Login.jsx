import { useEffect, useState } from 'react';
import { useAuth, Logo } from '../App.jsx';
import { api } from '../lib/api.js';
import BeltBadge from '../components/BeltBadge.jsx';

export default function Login() {
  const { refresh, demoMode } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [personas, setPersonas] = useState([]);

  useEffect(() => {
    if (demoMode) api.get('/auth/personas').then((d) => setPersonas(d.personas)).catch(() => {});
  }, [demoMode]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/login', { email, password });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function persona(key) {
    await api.post('/auth/persona', { key });
    await refresh();
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand"><Logo /><div><h1>Tatami</h1><p className="muted">Your judo club, on one mat.</p></div></div>
        <form onSubmit={submit} className="stack">
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></label>
          {error && <p className="error-text">{error}</p>}
          <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p className="muted small center">New here? Tatami is invite-only. Ask your coach for an invite link.</p>

        {demoMode && personas.length > 0 && (
          <div className="demo-login">
            <h3>Demo: sign in as…</h3>
            <p className="muted small">Each persona has different LaunchDarkly context attributes. Password for all: <span className="mono">judo123</span></p>
            <div className="persona-grid">
              {personas.map((p) => (
                <button key={p.key} className="persona" onClick={() => persona(p.key)}>
                  <strong>{p.name}</strong>
                  <span className="small">{p.role === 'parent' ? `Parent of ${p.childName}` : p.role === 'coach' ? 'Coach' : 'Student'} · {p.ageGroup}{p.betaTester ? ' · beta tester' : ''}</span>
                  <BeltBadge belt={p.belt} small />
                </button>
              ))}
            </div>
            <p className="muted small">Try signup too: <a href="/join/WELCOME-DOJO">/join/WELCOME-DOJO</a></p>
          </div>
        )}
      </div>
    </div>
  );
}
