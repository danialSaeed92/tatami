// Demo control panel (hidden when VITE_DEMO_MODE=false).
// Not part of the product: it exists to present the LaunchDarkly story.
//   * Persona switcher  -> shows individual + rule-based targeting
//   * Live context + flag values (browser SDK vs server SDK)
//   * Simulated bug + kill-switch trigger -> Release & Remediate

import { useCallback, useEffect, useState } from 'react';
import { useFlags } from 'launchdarkly-react-client-sdk';
import { useAuth } from '../App.jsx';
import { api } from '../lib/api.js';
import { FLAGS, flagValue } from '../lib/flags.js';
import { cap } from '../lib/format.js';
import { useToast } from './Toasts.jsx';
import BeltBadge from './BeltBadge.jsx';

export default function DemoPanel() {
  const { user, ldContext, refresh, ldConfigured } = useAuth();
  const flags = useFlags();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('personas');
  const [personas, setPersonas] = useState([]);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (open) api.get('/auth/personas').then((d) => setPersonas(d.personas)).catch(() => {});
  }, [open]);

  const loadStatus = useCallback(() => {
    if (!user) return;
    api.get('/demo/status').then(setStatus).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!open || !user) return undefined;
    loadStatus();
    const t = setInterval(loadStatus, 2500);
    return () => clearInterval(t);
  }, [open, user, loadStatus]);

  async function switchTo(key) {
    await api.post('/auth/persona', { key });
    const u = await refresh();
    toast(`Now signed in as ${u.name}`, 'info', 2500);
  }

  async function setBug(enabled) {
    await api.post('/demo/bug', { enabled });
    loadStatus();
    toast(enabled ? '🐛 Simulated bug ON: reactions & comments will start failing' : 'Simulated bug off', enabled ? 'warn' : 'info');
  }

  async function fireTrigger() {
    const r = await api.post('/demo/trigger').catch((e) => e.body ?? { fired: false, reason: e.message });
    toast(r.fired ? '🧯 Trigger fired - LaunchDarkly is switching the flag off' : `Trigger not fired: ${r.reason ?? r.status}`, r.fired ? 'success' : 'error');
    loadStatus();
  }

  return (
    <>
      <button className="demo-fab" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="dot" /> LaunchDarkly demo
      </button>
      {open && (
        <aside className="demo-panel" aria-label="LaunchDarkly demo panel">
          <div className="demo-head">
            <strong>Demo control panel</strong>
            <button className="btn ghost sm" onClick={() => setOpen(false)}>Close</button>
          </div>
          {!ldConfigured && <p className="muted small">LaunchDarkly client-side ID missing - values below are defaults.</p>}
          <div className="tabs">
            {['personas', 'flags', 'remediate'].map((t) => (
              <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{cap(t)}</button>
            ))}
          </div>

          {tab === 'personas' && (
            <div className="demo-body">
              <p className="muted small">Sign in as members with different context attributes to see targeting change live.</p>
              <ul className="personas">
                {personas.map((p) => (
                  <li key={p.key}>
                    <button className={user?.key === p.key ? 'persona active' : 'persona'} onClick={() => switchTo(p.key)}>
                      <strong>{p.name}</strong>
                      <span className="small">{p.role === 'parent' ? `parent of ${p.childName}` : p.role} · {p.ageGroup}{p.betaTester ? ' · beta' : ''}</span>
                      <span className="small mono">{p.key}</span>
                      <BeltBadge belt={p.belt} small />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === 'flags' && (
            <div className="demo-body">
              <table className="flag-table">
                <thead><tr><th>Flag</th><th>Browser</th><th>Server</th></tr></thead>
                <tbody>
                  {Object.values(FLAGS).map((k) => (
                    <tr key={k}>
                      <td className="mono small">{k}</td>
                      <td><FlagPill value={flagValue(flags, k)} /></td>
                      <td><FlagPill value={status?.serverFlags?.[k]} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">Browser values update instantly via streaming. Server values come from <span className="mono">allFlagsState()</span>.</p>
              <h4>Current LaunchDarkly context</h4>
              <pre className="code">{JSON.stringify(ldContext ?? { kind: 'user', anonymous: true }, null, 2)}</pre>
            </div>
          )}

          {tab === 'remediate' && (
            <div className="demo-body">
              <ol className="steps small">
                <li>Turn <span className="mono">{FLAGS.WALL_REACTIONS}</span> ON in LaunchDarkly.</li>
                <li>Switch on the simulated bug, then react/comment on the wall a few times.</li>
                <li>The server sees the error rate spike and fires the flag trigger (or fire it yourself).</li>
              </ol>
              <label className="switch">
                <input type="checkbox" checked={Boolean(status?.bugEnabled)} onChange={(e) => setBug(e.target.checked)} disabled={!user} />
                <span>Simulated bug in reactions service</span>
              </label>
              {status && (
                <div className="monitor">
                  <div><span className="muted small">Error rate (last {status.monitor.windowMs / 1000}s)</span>
                    <strong className={status.monitor.errorRate >= status.monitor.threshold ? 'bad' : ''}>{Math.round(status.monitor.errorRate * 100)}%</strong>
                    <span className="small muted">{status.monitor.errors}/{status.monitor.total} failed · trips at {Math.round(status.monitor.threshold * 100)}% after {status.monitor.minRequests} requests</span>
                  </div>
                  <div className="small">
                    Auto-remediation: <b>{status.autoRemediate ? 'on' : 'off'}</b> · Trigger URL: <b>{status.triggerConfigured ? 'configured' : 'not set'}</b>
                  </div>
                  {status.monitor.trips.length > 0 && (
                    <ul className="trips small">
                      {status.monitor.trips.map((t) => <li key={t.at}>⚡ {new Date(t.at).toLocaleTimeString()} - tripped at {Math.round(t.errorRate * 100)}% ({t.errors}/{t.total})</li>)}
                    </ul>
                  )}
                </div>
              )}
              <button className="btn danger" onClick={fireTrigger} disabled={!user}>🧯 Fire kill-switch trigger</button>
              <p className="muted small">Or from a terminal:</p>
              <pre className="code">curl -X POST "$LD_TRIGGER_URL"</pre>
            </div>
          )}
        </aside>
      )}
    </>
  );
}

function FlagPill({ value }) {
  if (value === undefined || value === null) return <span className="pill">-</span>;
  return <span className={`pill ${value ? 'on' : 'off'}`}>{String(value)}</span>;
}
