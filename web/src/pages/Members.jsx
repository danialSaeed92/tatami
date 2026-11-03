// Members roster with attendance %, belt promotions and invites (coaches).
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../App.jsx';
import { api } from '../lib/api.js';
import { BELTS, cap, initials } from '../lib/format.js';
import BeltBadge from '../components/BeltBadge.jsx';
import { useToast } from '../components/Toasts.jsx';

export default function Members() {
  const { user } = useAuth();
  const isCoach = user.role === 'coach';
  const toast = useToast();
  const [members, setMembers] = useState(null);
  const load = useCallback(() => api.get('/members').then((d) => setMembers(d.members)), []);
  useEffect(() => { load(); }, [load]);

  async function promote(m, belt) {
    try {
      await api.patch(`/members/${m.id}`, { belt });
      toast(`${m.childName ?? m.name} is now ${cap(belt)} belt 🎉`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
    load();
  }

  const me = members?.find((m) => m.isMe);

  return (
    <div>
      <h1 className="page-title">Members</h1>
      {me?.attendance && <AttendanceCard stats={me.attendance} who={user.role === 'parent' ? user.childName : 'You'} />}
      {isCoach && <Invites />}
      <div className="card">
        <h3>Roster <span className="muted">({members?.length ?? '…'})</span></h3>
        <table className="table">
          <thead><tr><th>Judoka</th><th>Role</th><th>Belt</th><th>Class</th><th>Attendance</th>{isCoach && <th>Promote</th>}</tr></thead>
          <tbody>
            {members?.map((m) => (
              <tr key={m.id} className={m.isMe ? 'me-row' : ''}>
                <td>
                  <div className="row gap center-y">
                    <div className={`avatar xs ${m.role === 'coach' ? 'coach' : ''}`}>{initials(m.childName ?? m.name)}</div>
                    <div><strong>{m.childName ?? m.name}</strong>{m.childName && <div className="small muted">parent: {m.name}</div>}{isCoach && m.email && <div className="small muted">{m.email}</div>}</div>
                  </div>
                </td>
                <td>{cap(m.role)}</td>
                <td><BeltBadge belt={m.belt} small /></td>
                <td className="muted">{cap(m.ageGroup)}</td>
                <td>{m.attendance ? <Bar pct={m.attendance.pct} label={`${m.attendance.attended}/${m.attendance.eligible}`} /> : <span className="muted small">{m.role === 'coach' ? '-' : 'private'}</span>}</td>
                {isCoach && (
                  <td>{m.role !== 'coach' && (
                    <select value={m.belt} onChange={(e) => promote(m, e.target.value)} aria-label="Belt">
                      {BELTS.map((b) => <option key={b} value={b}>{cap(b)}</option>)}
                    </select>
                  )}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AttendanceCard({ stats, who }) {
  const ready = stats.pct !== null && stats.pct >= 75;
  return (
    <div className="card attendance-card">
      <div>
        <div className="big">{stats.pct ?? '-'}%</div>
        <div className="muted small">{who === 'You' ? 'Your' : `${who}'s`} attendance this season ({stats.attended} of {stats.eligible} classes)</div>
      </div>
      <div className={`grading ${ready ? 'ok' : ''}`}>{ready ? '✓ Meets the 75% grading requirement' : 'Needs 75% attendance to grade'}</div>
    </div>
  );
}

function Bar({ pct, label }) {
  if (pct === null) return <span className="muted small">no classes yet</span>;
  return (
    <div className="bar" title={label}>
      <div className="bar-track"><div className={`bar-fill ${pct >= 75 ? 'ok' : pct >= 50 ? 'mid' : 'low'}`} style={{ width: `${pct}%` }} /></div>
      <span className="small">{pct}%</span>
    </div>
  );
}

function Invites() {
  const toast = useToast();
  const [invites, setInvites] = useState([]);
  const [role, setRole] = useState('student');
  const [maxUses, setMaxUses] = useState(1);
  const [days, setDays] = useState(14);
  const [latest, setLatest] = useState(null);

  const load = useCallback(() => api.get('/invites').then((d) => setInvites(d.invites)), []);
  useEffect(() => { load(); }, [load]);

  const link = (code) => `${window.location.origin}/join/${code}`;

  async function create(e) {
    e.preventDefault();
    const { code } = await api.post('/invites', { role, maxUses, days });
    setLatest(code);
    load();
  }

  async function copy(code) {
    try {
      await navigator.clipboard.writeText(link(code));
      toast('Invite link copied', 'success', 2000);
    } catch {
      toast(link(code), 'info', 8000);
    }
  }

  async function revoke(code) {
    await api.del(`/invites/${code}`);
    load();
  }

  return (
    <div className="card">
      <h3>Invite members</h3>
      <p className="muted small">Signup is invite-only. Share a link with new students, parents or coaches.</p>
      <form className="row gap wrap invite-form" onSubmit={create}>
        <label>Role<select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="student">Student</option><option value="parent">Parent</option><option value="coach">Coach</option>
        </select></label>
        <label>Uses<input type="number" min={1} max={500} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} /></label>
        <label>Valid (days)<input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} /></label>
        <button className="btn primary">Create invite link</button>
      </form>
      {latest && (
        <div className="invite-latest">
          <span className="mono">{link(latest)}</span>
          <button className="btn sm" onClick={() => copy(latest)}>Copy</button>
        </div>
      )}
      {invites.length > 0 && (
        <table className="table small">
          <thead><tr><th>Code</th><th>Role</th><th>Used</th><th>Expires</th><th>By</th><th /></tr></thead>
          <tbody>
            {invites.map((i) => (
              <tr key={i.code} className={i.active ? '' : 'past'}>
                <td className="mono">{i.code}</td>
                <td>{cap(i.role)}</td>
                <td>{i.uses}/{i.maxUses}</td>
                <td>{new Date(i.expiresAt).toLocaleDateString()}</td>
                <td>{i.createdBy}</td>
                <td className="nowrap">{i.active && <><button className="link" onClick={() => copy(i.code)}>Copy</button> · <button className="link" onClick={() => revoke(i.code)}>Revoke</button></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
