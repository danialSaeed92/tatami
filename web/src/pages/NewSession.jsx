// Coaches create sessions.
//
// The "Repeat weekly" section is the recurring schedule builder, released
// progressively behind the `schedule-builder` flag (the API enforces it too).

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFlags } from 'launchdarkly-react-client-sdk';
import { api } from '../lib/api.js';
import { FLAGS, flagValue } from '../lib/flags.js';
import { SESSION_TYPES } from '../lib/format.js';
import { useToast } from '../components/Toasts.jsx';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function NewSession() {
  const flags = useFlags();
  const builderOn = flagValue(flags, FLAGS.SCHEDULE_BUILDER);
  const navigate = useNavigate();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ title: '', type: 'class', audience: 'adults', date: today, time: '18:00', durationMin: 90, location: 'Main mat', description: '' });
  const [repeat, setRepeat] = useState(false);
  const [weekdays, setWeekdays] = useState([]);
  const [until, setUntil] = useState('');
  const [skipClosures, setSkipClosures] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const toggleDay = (d) => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort()));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { ...f, durationMin: Number(f.durationMin), ...(builderOn && repeat ? { repeat: { weekdays, until, skipClosures } } : {}) };
      const r = await api.post('/sessions', body);
      toast(`Created ${r.created} session${r.created === 1 ? '' : 's'}`, 'success');
      navigate(r.created === 1 ? `/sessions/${r.ids[0]}` : '/schedule');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <Link to="/schedule" className="small">← Schedule</Link>
      <h1 className="page-title">New session</h1>
      <form className="card stack" onSubmit={submit}>
        <label>Title<input value={f.title} onChange={set('title')} placeholder="e.g. Competition team training" required /></label>
        <div className="row">
          <label>Type<select value={f.type} onChange={set('type')}>{Object.entries(SESSION_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          <label>For<select value={f.audience} onChange={set('audience')}>
            <option value="kids">Kids</option><option value="adults">Teens &amp; adults</option><option value="all">Everyone</option>
          </select></label>
        </div>
        <div className="row">
          <label>{repeat ? 'First date' : 'Date'}<input type="date" value={f.date} onChange={set('date')} required /></label>
          <label>Start time<input type="time" value={f.time} onChange={set('time')} required /></label>
          <label>Duration (min)<input type="number" min={15} step={15} value={f.durationMin} onChange={set('durationMin')} /></label>
        </div>
        <label>Location<input value={f.location} onChange={set('location')} /></label>
        <label>Description<textarea rows={3} value={f.description} onChange={set('description')} placeholder="What should members bring or know?" /></label>

        {/* ---- Feature flag: schedule-builder ---- */}
        {builderOn && (
          <fieldset className="repeat">
            <label className="check"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> <strong>Repeat weekly</strong> <span className="tag new">New</span></label>
            {repeat && (
              <>
                <div className="weekday-picker">
                  {WEEKDAYS.map((d, i) => (
                    <button type="button" key={d} className={weekdays.includes(i) ? 'on' : ''} onClick={() => toggleDay(i)} aria-pressed={weekdays.includes(i)}>{d}</button>
                  ))}
                </div>
                <div className="row">
                  <label>Until<input type="date" value={until} min={f.date} onChange={(e) => setUntil(e.target.value)} required /></label>
                  <label className="check small"><input type="checkbox" checked={skipClosures} onChange={(e) => setSkipClosures(e.target.checked)} /> Skip dojo closures</label>
                </div>
              </>
            )}
          </fieldset>
        )}
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : repeat && builderOn ? 'Create series' : 'Create session'}</button>
      </form>
    </div>
  );
}
