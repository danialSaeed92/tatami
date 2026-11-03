import { useState } from 'react';
import { useRsvp } from '../lib/useRsvp.js';
import { useToast } from './Toasts.jsx';

const OPTIONS = [
  { value: 'going', label: 'Going', icon: '✓' },
  { value: 'maybe', label: 'Maybe', icon: '?' },
  { value: 'not_going', label: "Can't make it", icon: '✕' },
];

export function RsvpStatus({ status }) {
  if (!status) return <span className="rsvp-status none">No reply</span>;
  const o = OPTIONS.find((x) => x.value === status);
  return <span className={`rsvp-status ${status}`}>{o.icon} {o.label}</span>;
}

/** Going / Maybe / Can't make it buttons. */
export function RsvpButtons({ session, onChange, compact, source }) {
  const rsvp = useRsvp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const mine = session.rsvp?.mine;

  async function choose(value) {
    if (value === mine) return;
    setBusy(true);
    try {
      await rsvp(session.id, value, source);
      onChange?.(value);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rsvp-buttons ${compact ? 'compact' : ''}`} role="group" aria-label="Are you coming?">
      {OPTIONS.map((o) => (
        <button key={o.value} className={`rsvp-btn ${o.value} ${mine === o.value ? 'selected' : ''}`} onClick={() => choose(o.value)} disabled={busy} aria-pressed={mine === o.value}>
          <span>{o.icon}</span>{!compact && ` ${o.label}`}
        </button>
      ))}
    </div>
  );
}
