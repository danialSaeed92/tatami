// RSVP helper used everywhere a member answers "are you coming?".
//
// EXTRA CREDIT - EXPERIMENTATION
// Every RSVP sends the custom event `session-rsvp` to LaunchDarkly. The
// experiment on `schedule-calendar-v2` uses it as a conversion metric to answer:
// "does the new yearly calendar (with one-tap RSVP) get more members to RSVP?"

import { useCallback } from 'react';
import { useLDClient } from 'launchdarkly-react-client-sdk';
import { api } from './api.js';
import { METRICS } from './flags.js';

export function useRsvp() {
  const ldClient = useLDClient();
  return useCallback(async (sessionId, status, source) => {
    await api.put(`/sessions/${sessionId}/rsvp`, { status });
    // track(eventKey, data) - `data` is visible in LaunchDarkly's event debugger.
    ldClient?.track(METRICS.RSVP, { sessionId, status, source });
  }, [ldClient]);
}
