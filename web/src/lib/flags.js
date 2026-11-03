// LaunchDarkly flag keys used by the web app.
// >>> RECREATE THESE FLAGS in your LaunchDarkly project and tick
//     "SDKs using Client-side ID" under each flag's "Client-side SDK availability",
//     otherwise the browser SDK can't see them. See docs/launchdarkly-setup.md.
// The server uses the same keys in server/src/launchdarkly.js.

export const FLAGS = {
  // Part 1 - Release & Remediate: comments + emoji reactions on the dojo wall.
  WALL_REACTIONS: 'wall-reactions-comments',
  // Part 2 - Targeting + Experiment: false = classic list, true = yearly calendar with one-tap RSVP.
  SCHEDULE_CALENDAR_V2: 'schedule-calendar-v2',
  // Bonus - recurring session builder for coaches.
  SCHEDULE_BUILDER: 'schedule-builder',
};

// Metric event key for the experiment. >>> RECREATE as a custom conversion metric.
export const METRICS = {
  RSVP: 'session-rsvp',
};

// Defaults used until LaunchDarkly answers (or if it is not configured).
export const FLAG_DEFAULTS = {
  [FLAGS.WALL_REACTIONS]: false,
  [FLAGS.SCHEDULE_CALENDAR_V2]: false,
  [FLAGS.SCHEDULE_BUILDER]: false,
};

export function flagValue(flags, key) {
  return flags?.[key] ?? FLAG_DEFAULTS[key];
}
