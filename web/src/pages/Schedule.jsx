// Yearly schedule.
//
// PART 2 - TARGETING (and the EXPERIMENT)
// `schedule-calendar-v2` chooses which component renders:
//   false -> <ClassicList/>      the existing list; RSVP from the session page
//   true  -> <YearCalendar/>     new 12-month calendar with one-tap RSVP
// Who gets `true` is decided entirely in LaunchDarkly from the member's context:
// individual targets (e.g. sensei-kenji) and rules on role / belt / betaTester /
// email domain, then a percentage rollout (which the experiment uses).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFlags } from 'launchdarkly-react-client-sdk';
import { useAuth } from '../App.jsx';
import { api } from '../lib/api.js';
import { FLAGS, flagValue } from '../lib/flags.js';
import { AUDIENCE_LABEL, SESSION_TYPES, fmtDate, fmtDuration, fmtTime, toDate } from '../lib/format.js';
import { RsvpButtons, RsvpStatus } from '../components/Rsvp.jsx';

export default function Schedule() {
  const { user } = useAuth();
  const flags = useFlags();
  const calendarV2 = flagValue(flags, FLAGS.SCHEDULE_CALENDAR_V2);
  const [mine, setMine] = useState(user.role !== 'coach');
  const [data, setData] = useState(null);

  const load = useCallback(() => api.get(`/sessions${mine ? '?mine=1' : ''}`).then(setData), [mine]);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Schedule {data && <span className="muted">· {data.season.label} season</span>}</h1>
          <p className="muted small">{calendarV2 ? 'Tap a day to see sessions and RSVP in one tap.' : 'Upcoming classes and events. Open a session to RSVP.'}</p>
        </div>
        <div className="page-actions">
          <label className="check small"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only sessions for me</label>
          {user.role === 'coach' && <Link className="btn primary" to="/schedule/new">＋ New session</Link>}
        </div>
      </div>
      {!data ? <div className="card skeleton" /> : calendarV2
        ? <YearCalendar data={data} reload={load} />
        : <ClassicList data={data} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OLD component (flag false): classic list
// ---------------------------------------------------------------------------
function ClassicList({ data }) {
  const [showPast, setShowPast] = useState(false);
  const groups = useMemo(() => {
    const list = data.sessions.filter((s) => showPast || s.startsAt >= data.now.slice(0, 10));
    const map = new Map();
    for (const s of list) {
      const k = s.startsAt.slice(0, 7);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(s);
    }
    return [...map.entries()];
  }, [data, showPast]);

  return (
    <div className="classic">
      <button className="btn ghost sm" onClick={() => setShowPast((p) => !p)}>{showPast ? 'Hide past sessions' : 'Show past sessions'}</button>
      {groups.map(([month, sessions]) => (
        <section key={month} className="card month-list">
          <h2>{toDate(`${month}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
          <table className="table">
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className={s.startsAt < data.now ? 'past' : ''}>
                  <td className="nowrap">{fmtDate(s.startsAt)}</td>
                  <td className="nowrap muted">{s.type === 'closure' ? 'All day' : fmtTime(s.startsAt)}</td>
                  <td><strong>{s.title}</strong> <TypeTag type={s.type} /></td>
                  <td className="muted small">{AUDIENCE_LABEL[s.audience]}</td>
                  <td>{s.rsvp && (s.startsAt < data.now ? <AttendedTag attended={s.attended} /> : <RsvpStatus status={s.rsvp.mine} />)}</td>
                  <td>{s.type !== 'closure' && <Link className="btn ghost sm" to={`/sessions/${s.id}`}>Details</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {groups.length === 0 && <p className="muted">No upcoming sessions.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NEW component (flag true): yearly calendar with one-tap RSVP
// ---------------------------------------------------------------------------
function YearCalendar({ data, reload }) {
  const today = data.now.slice(0, 10);
  const [selected, setSelected] = useState(today);

  // day 'YYYY-MM-DD' -> sessions (multi-day events/closures cover every day)
  const byDay = useMemo(() => {
    const map = new Map();
    for (const s of data.sessions) {
      const days = s.durationMin >= 1440 ? Math.round(s.durationMin / 1440) : 1;
      const start = toDate(s.startsAt.slice(0, 10));
      for (let i = 0; i < days; i++) {
        const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const k = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(s);
      }
    }
    return map;
  }, [data]);

  const months = useMemo(() => {
    const start = toDate(data.season.start);
    return Array.from({ length: 12 }, (_, i) => new Date(start.getFullYear(), start.getMonth() + i, 1));
  }, [data.season.start]);

  const nextUp = data.sessions.filter((s) => s.startsAt >= data.now && s.rsvp).slice(0, 3);
  const dayList = byDay.get(selected) ?? [];

  return (
    <div className="calendar-layout">
      <div>
        <div className="next-up">
          {nextUp.map((s) => (
            <div key={s.id} className="card next-card">
              <div className="small muted">{fmtDate(s.startsAt)} · {fmtTime(s.startsAt)}</div>
              <Link to={`/sessions/${s.id}`}><strong>{s.title}</strong></Link>
              <RsvpButtons session={s} onChange={reload} compact source="calendar-next-up" />
            </div>
          ))}
        </div>
        <Legend />
        <div className="year-grid">
          {months.map((m) => <MonthGrid key={m.toISOString()} month={m} byDay={byDay} today={today} selected={selected} onSelect={setSelected} />)}
        </div>
      </div>
      <aside className="card day-panel">
        <h3>{fmtDate(selected, { weekday: 'long', year: 'numeric' })}</h3>
        {dayList.length === 0 && <p className="muted">Nothing scheduled.</p>}
        {dayList.map((s) => (
          <div key={`${s.id}-${selected}`} className={`day-item type-${s.type}`}>
            <div className="day-item-head">
              <TypeTag type={s.type} />
              <span className="small muted">{s.type === 'closure' || s.durationMin >= 1440 ? fmtDuration(s.durationMin) : `${fmtTime(s.startsAt)} · ${fmtDuration(s.durationMin)}`}</span>
            </div>
            {s.type === 'closure' ? <strong>{s.title}</strong> : <Link to={`/sessions/${s.id}`}><strong>{s.title}</strong></Link>}
            <div className="small muted">{AUDIENCE_LABEL[s.audience]} · {s.location}</div>
            {s.rsvp && (s.startsAt < data.now
              ? <AttendedTag attended={s.attended} />
              : <>
                <RsvpButtons session={s} onChange={reload} source="calendar-day" />
                <div className="small muted">{s.rsvp.going} going · {s.rsvp.maybe} maybe</div>
              </>)}
          </div>
        ))}
      </aside>
    </div>
  );
}

function MonthGrid({ month, byDay, today, selected, onSelect }) {
  const y = month.getFullYear();
  const m = month.getMonth();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Monday-first
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <div className="card month">
      <h4>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h4>
      <div className="dow">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="days">
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const k = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const list = byDay.get(k) ?? [];
          const closed = list.some((s) => s.type === 'closure');
          const types = [...new Set(list.filter((s) => s.type !== 'closure').map((s) => s.type))];
          const going = list.some((s) => s.rsvp?.mine === 'going');
          return (
            <button key={i} className={`day ${closed ? 'closed' : ''} ${k === today ? 'today' : ''} ${k === selected ? 'selected' : ''} ${k < today ? 'past' : ''}`}
              onClick={() => onSelect(k)} aria-label={`${k}: ${list.length} items`}>
              <span className={going ? 'num going' : 'num'}>{d}</span>
              <span className="dots">{types.slice(0, 3).map((t) => <i key={t} style={{ background: SESSION_TYPES[t].color }} />)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend small">
      {Object.entries(SESSION_TYPES).map(([k, v]) => <span key={k}><i style={{ background: v.color }} />{v.label}</span>)}
      <span><b className="num going">12</b> you're going</span>
    </div>
  );
}

export function TypeTag({ type }) {
  return <span className="type-tag" style={{ '--c': SESSION_TYPES[type].color }}>{SESSION_TYPES[type].label}</span>;
}

function AttendedTag({ attended }) {
  if (attended === null || attended === undefined) return <span className="small muted">-</span>;
  return attended ? <span className="rsvp-status going">Attended</span> : <span className="rsvp-status not_going">Absent</span>;
}
