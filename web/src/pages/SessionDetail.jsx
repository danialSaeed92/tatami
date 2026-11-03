// Session page: details, RSVP, who's coming and (for coaches) attendance.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../App.jsx';
import { api } from '../lib/api.js';
import { AUDIENCE_LABEL, fmtDate, fmtDuration, fmtTime } from '../lib/format.js';
import { RsvpButtons, RsvpStatus } from '../components/Rsvp.jsx';
import { useToast } from '../components/Toasts.jsx';
import BeltBadge from '../components/BeltBadge.jsx';
import { TypeTag } from './Schedule.jsx';

export default function SessionDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => api.get(`/sessions/${id}`).then(setData).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <p className="error-text">{error} <Link to="/schedule">Back to schedule</Link></p>;
  if (!data) return <div className="card skeleton" />;
  const s = data.session;
  const started = s.startsAt < data.now;

  async function remove(scope) {
    if (!confirm(scope === 'series' ? 'Delete this and all later sessions in the series?' : 'Delete this session?')) return;
    const r = await api.del(`/sessions/${s.id}${scope === 'series' ? '?scope=series' : ''}`);
    toast(`Deleted ${r.deleted} session${r.deleted === 1 ? '' : 's'}`, 'info');
    navigate('/schedule');
  }

  return (
    <div className="session-page">
      <Link to="/schedule" className="small">← Schedule</Link>
      <div className="card session-hero">
        <TypeTag type={s.type} />
        <h1>{s.title}</h1>
        <p className="lead">{fmtDate(s.startsAt, { weekday: 'long', year: 'numeric' })} · {s.type === 'closure' ? 'All day' : `${fmtTime(s.startsAt)} · ${fmtDuration(s.durationMin)}`}</p>
        <p className="muted">{AUDIENCE_LABEL[s.audience]} · {s.location}</p>
        {s.description && <p>{s.description}</p>}
        {s.rsvp && (
          started
            ? <p className="muted">This session has started - RSVPs are closed.</p>
            : <div className="rsvp-block"><span>Are you coming?</span><RsvpButtons session={s} onChange={load} source="session-page" /></div>
        )}
        {user.role === 'coach' && (
          <div className="row gap">
            <button className="btn ghost sm" onClick={() => remove('one')}>Delete session</button>
            {s.seriesId && <button className="btn ghost sm" onClick={() => remove('series')}>Delete rest of series</button>}
          </div>
        )}
      </div>

      {s.rsvp && (
        <div className="card">
          <h3>Who's coming <span className="muted">({s.rsvp.going} going · {s.rsvp.maybe} maybe · {s.rsvp.notGoing} can't)</span></h3>
          {data.going.length ? <p>{data.going.join(', ')}</p> : <p className="muted">No one has said they're going yet.</p>}
        </div>
      )}

      {data.roster && s.rsvp && <Attendance session={s} roster={data.roster} onSaved={load} />}
    </div>
  );
}

// Coaches take attendance. Pre-fills from attendance already saved, or from RSVPs.
function Attendance({ session, roster, onSaved }) {
  const toast = useToast();
  const [present, setPresent] = useState(() => Object.fromEntries(roster.map((m) => [m.id, m.present ?? m.rsvp === 'going'])));
  const [busy, setBusy] = useState(false);
  const taken = roster.some((m) => m.present !== null);
  const count = Object.values(present).filter(Boolean).length;

  async function save() {
    setBusy(true);
    try {
      await api.put(`/sessions/${session.id}/attendance`, { records: Object.entries(present).map(([userId, p]) => ({ userId: Number(userId), present: p })) });
      toast(`Attendance saved: ${count} present`, 'success');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row between">
        <h3>Attendance {taken ? <span className="tag ok">Taken</span> : <span className="tag">Not taken yet</span>}</h3>
        <div className="row gap">
          <button className="btn ghost sm" onClick={() => setPresent(Object.fromEntries(roster.map((m) => [m.id, true])))}>All present</button>
          <button className="btn ghost sm" onClick={() => setPresent(Object.fromEntries(roster.map((m) => [m.id, false])))}>Clear</button>
        </div>
      </div>
      <table className="table attendance">
        <thead><tr><th>Present</th><th>Judoka</th><th>Belt</th><th>RSVP</th></tr></thead>
        <tbody>
          {roster.map((m) => (
            <tr key={m.id} onClick={() => setPresent((p) => ({ ...p, [m.id]: !p[m.id] }))} className="clickable">
              <td><input type="checkbox" checked={Boolean(present[m.id])} readOnly aria-label={`${m.name} present`} /></td>
              <td><strong>{m.name}</strong>{m.parent && <span className="small muted"> (parent: {m.parent})</span>}</td>
              <td><BeltBadge belt={m.belt} small /></td>
              <td><RsvpStatus status={m.rsvp} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row between">
        <span className="muted small">{count} of {roster.length} present</span>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save attendance'}</button>
      </div>
    </div>
  );
}
