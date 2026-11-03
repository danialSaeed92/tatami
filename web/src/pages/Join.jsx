// Invite-only signup: /join/:code
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth, Logo } from '../App.jsx';
import { api } from '../lib/api.js';
import { BELTS, cap } from '../lib/format.js';

export default function Join() {
  const { code } = useParams();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', belt: 'white', ageGroup: 'adults', childName: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/invites/${encodeURIComponent(code)}`).then(setInvite).catch(() => setInvite({ valid: false, reason: 'Could not check this invite.' }));
  }, [code]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/signup', { code, ...form });
      await refresh();
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand"><Logo /><div><h1>Join Tatami</h1>
          {invite?.valid && <p className="muted">{invite.invitedBy} invited you to <b>{invite.dojoName}</b> as a <b>{invite.role}</b>.</p>}
        </div></div>
        {!invite && <p>Checking invite…</p>}
        {invite && !invite.valid && (
          <div className="stack">
            <p className="error-text">{invite.reason}</p>
            <Link to="/" className="btn">Back to sign in</Link>
          </div>
        )}
        {invite?.valid && (
          <form onSubmit={submit} className="stack">
            <label>Your name<input value={form.name} onChange={set('name')} required /></label>
            <label>Email<input type="email" value={form.email} onChange={set('email')} required autoComplete="email" /></label>
            <label>Password<input type="password" value={form.password} onChange={set('password')} minLength={6} required autoComplete="new-password" /></label>
            {invite.role === 'parent' && (
              <label>Your child's name<input value={form.childName} onChange={set('childName')} required /></label>
            )}
            {invite.role !== 'coach' && (
              <div className="row">
                <label>{invite.role === 'parent' ? "Child's belt" : 'Current belt'}
                  <select value={form.belt} onChange={set('belt')}>{BELTS.map((b) => <option key={b} value={b}>{cap(b)}</option>)}</select>
                </label>
                {invite.role === 'student' && (
                  <label>Class
                    <select value={form.ageGroup} onChange={set('ageGroup')}>
                      <option value="teens">Teens</option>
                      <option value="adults">Adults</option>
                    </select>
                  </label>
                )}
              </div>
            )}
            {error && <p className="error-text">{error}</p>}
            <button className="btn primary" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
            <p className="muted small center">Already a member? <Link to="/">Sign in</Link></p>
          </form>
        )}
      </div>
    </div>
  );
}
