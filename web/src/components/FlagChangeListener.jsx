// PART 1 - "Instant releases/rollbacks" LISTENER
//
// The LaunchDarkly browser SDK keeps a streaming connection open. When a flag
// changes in the dashboard (or a trigger flips it), the SDK emits a `change`
// event within milliseconds. Two things happen with no page reload:
//
//   1. useFlags() hooks re-render, so components swap between old/new code
//      (e.g. Wall.jsx shows or hides comments + reactions).
//   2. This listener announces the release/rollback with a toast, so the
//      audience can see the switch happen live.

import { useEffect } from 'react';
import { useLDClient } from 'launchdarkly-react-client-sdk';
import { FLAGS } from '../lib/flags.js';
import { recentlyIdentified } from '../lib/identify.js';
import { useToast } from './Toasts.jsx';

const MESSAGES = {
  [FLAGS.WALL_REACTIONS]: {
    on: '🚀 Released: comments & reactions are live on the wall',
    off: '↩️ Rolled back: comments & reactions switched off',
  },
  [FLAGS.SCHEDULE_CALENDAR_V2]: {
    on: '📅 New yearly calendar view is now on',
    off: '📋 Back to the classic schedule list',
  },
  [FLAGS.SCHEDULE_BUILDER]: {
    on: '🔁 Recurring schedule builder enabled',
    off: 'Recurring schedule builder disabled',
  },
};

export default function FlagChangeListener() {
  const ldClient = useLDClient();
  const toast = useToast();

  useEffect(() => {
    if (!ldClient) return undefined;
    const onChange = (changes) => {
      // Ignore changes caused by switching persona (identify), only announce real releases.
      if (recentlyIdentified()) return;
      for (const [key, { current }] of Object.entries(changes)) {
        const msg = MESSAGES[key];
        console.info(`[LaunchDarkly] flag "${key}" changed ->`, current);
        if (msg) toast(current ? msg.on : msg.off, current ? 'success' : 'warn');
      }
    };
    ldClient.on('change', onChange);
    return () => ldClient.off('change', onChange);
  }, [ldClient, toast]);

  return null;
}
