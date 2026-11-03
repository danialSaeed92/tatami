import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { asyncWithLDProvider } from 'launchdarkly-react-client-sdk';
import Observability from '@launchdarkly/observability';
import SessionReplay from '@launchdarkly/session-replay';
import App from './App.jsx';
import './styles.css';

// >>> REPLACE ME: put your LaunchDarkly *client-side ID* in the root .env file:
//     VITE_LD_CLIENT_SIDE_ID=<id>
//     (LaunchDarkly > Project settings > Environments > <env> > Client-side ID)
//     The client-side ID is safe to ship to browsers; the SDK key is NOT.
const clientSideID = import.meta.env.VITE_LD_CLIENT_SIDE_ID;

async function start() {
  let Provider = ({ children }) => children;

  if (clientSideID) {
    try {
      Provider = await asyncWithLDProvider({
        clientSideID,
        // Start with an anonymous context; App.jsx calls ldClient.identify() with
        // the member's multi-context (user + dojo) as soon as they sign in.
        context: { kind: 'user', anonymous: true },
        // Keep flag keys exactly as they appear in LaunchDarkly (no camelCasing),
        // so code and dashboard match: flags['wall-reactions-comments'].
        reactOptions: { useCamelCaseFlagKeys: false },
        // Don't block first paint for more than 3s if LaunchDarkly is slow.
        timeout: 3,
        // LaunchDarkly Observability (errors, logs, traces) + Session Replay.
        // They reuse this client's client-side ID - no extra key needed.
        // privacySetting 'strict' masks all text and inputs in recordings.
        options: {
          plugins: [
            new Observability(),
            new SessionReplay({ privacySetting: 'strict' }),
          ],
        },
      });
    } catch (err) {
      console.error('LaunchDarkly failed to initialize - continuing with flag defaults', err);
    }
  } else {
    console.warn('VITE_LD_CLIENT_SIDE_ID is not set - feature flags use their defaults (see README).');
  }

  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <Provider>
        <BrowserRouter>
          <App ldConfigured={Boolean(clientSideID)} />
        </BrowserRouter>
      </Provider>
    </React.StrictMode>,
  );
}

start();
