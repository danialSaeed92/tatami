import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { SESSION_TYPES, fmtDate, fmtTime } from '../lib/format.js';
import { RsvpStatus } from './Rsvp.jsx';

export default function UpcomingStrip() {
  const [sessions, setSessions] = useState(null);

  useEffect(() => {
    api.get('/sessions?mine=1').then((d) => setSessions(d.sessions.filter((s) => s.startsAt >= d.now).slice(0, 5))).catch(() => setSessions([]));
  }, []);

  return (
    <div className="card upcoming">
      <h3>Coming up</h3>
      {!sessions && <p className="muted small">Loading…</p>}
      <ul>
        {sessions?.map((s) => (
          <li key={s.id}>
            <span className="type-dot" style={{ background: SESSION_TYPES[s.type].color }} />
            <div className="grow">
              <Link to={`/sessions/${s.id}`}><strong>{s.title}</strong></Link>
              <div className="small muted">{fmtDate(s.startsAt)} · {fmtTime(s.startsAt)}</div>
            </div>
            {s.rsvp && <RsvpStatus status={s.rsvp.mine} />}
          </li>
        ))}
      </ul>
      <Link to="/schedule" className="small">Full schedule →</Link>
    </div>
  );
}
