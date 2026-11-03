// Formatting helpers. Session times are dojo-local strings 'YYYY-MM-DDTHH:MM'.

export const BELTS = ['white', 'yellow', 'orange', 'green', 'blue', 'brown', 'black'];

export const SESSION_TYPES = {
  class: { label: 'Class', color: 'var(--c-class)' },
  grading: { label: 'Grading', color: 'var(--c-grading)' },
  tournament: { label: 'Tournament', color: 'var(--c-tournament)' },
  seminar: { label: 'Seminar', color: 'var(--c-seminar)' },
  event: { label: 'Club event', color: 'var(--c-event)' },
  closure: { label: 'Closed', color: 'var(--c-closure)' },
};

export const AUDIENCE_LABEL = { kids: 'Kids', adults: 'Teens & adults', all: 'Everyone' };

export const toDate = (stamp) => new Date(stamp.length === 10 ? `${stamp}T00:00` : stamp);

export const fmtDate = (stamp, opts = {}) =>
  toDate(stamp).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...opts });

export const fmtTime = (stamp) => toDate(stamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function fmtDuration(min) {
  if (min >= 1440) return `${Math.round(min / 1440)} day${min >= 2880 ? 's' : ''}`;
  if (min % 60 === 0) return `${min / 60} h`;
  return min > 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const initials = (name = '') => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

export const cap = (s = '') => s.charAt(0).toUpperCase() + s.slice(1);
