# Tatami: a judo club app, powered by LaunchDarkly

Tatami is a web app for running a judo club (a *dojo*). Coaches invite members, post on the club wall,
publish the season's schedule and take attendance. Members RSVP to sessions, react to and comment on
posts, and ask the **Sensei Assistant** chatbot questions.

It's a sample app showing how **LaunchDarkly** lets a team ship faster without taking on more risk:

| Exercise part | Where it lives in Tatami | LaunchDarkly feature |
|---|---|---|
| **1. Release & Remediate** | Comments and emoji reactions on the dojo wall | Boolean flag `wall-reactions-comments`, a streaming **listener** (no page reload), a **flag trigger** fired with curl or automatically by an error-rate monitor |
| **2. Target** | New 12-month calendar with one-tap RSVP (vs the classic list) | Flag `schedule-calendar-v2`, **multi-context** (`user` + `dojo`) with custom attributes, **individual** and **rule-based** targeting |
| **Extra: Experimentation** | Does the new calendar make people RSVP more? | Metric `session-rsvp`, experiment on `schedule-calendar-v2`, traffic simulator |
| **Extra: AI Configs** | Sensei Assistant chatbot | AI Config `sensei-assistant`: prompt and model chosen per member, with metrics and 👍/👎 feedback tracked |
| **Extra: Integrations** | Kill-switch alerts | Slack integration (setup steps in the docs) |
| Bonus | Recurring schedule builder for coaches | Flag `schedule-builder` (progressive rollout) |

---

## Contents

1. [Assumptions about your environment](#1-assumptions-about-your-environment)
2. [Quick start](#2-quick-start)
3. [LaunchDarkly configuration](#3-launchdarkly-configuration)
4. [How it works](#4-how-it-works)
5. [Project structure](#5-project-structure)
6. [Running with Docker](#6-running-with-docker)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Assumptions about your environment

- **macOS, Linux or Windows (WSL)** with a terminal.
- **Node.js 22.13 or newer** (Node 24 LTS recommended). Check with `node -v`.
  Tatami uses Node's built-in `node:sqlite` module, so there's no database to install and nothing native to compile.
- **npm 10+** (comes with Node).
- **Ports 4000** (API) and **5173** (web dev server) are free.
- A **LaunchDarkly account**. A free trial is enough: https://launchdarkly.com/start-trial/
- *Optional:* an **Anthropic** or **OpenAI** API key for real chatbot answers. Without one, the bot returns labelled offline replies.
- *Optional:* **Docker** if you prefer containers, and `curl` for the trigger demo.
- A modern browser (Chrome, Edge, Firefox, Safari).

## 2. Quick start

```bash
git clone <this-repo-url> tatami
cd tatami
npm install                 # installs the root, server and web workspaces
cp .env.example .env        # then edit .env (see below)
npm run dev                 # API on :4000 + web app on :5173
```

Open **http://localhost:5173**. The database is created and seeded on first start in `server/data/tatami.db`.

Seeded data: one club, 13 members, a full season (September to August) of classes, gradings, tournaments and closures,
past attendance and a few wall posts. To start over, run `npm run seed`.

### Fill in `.env`

| Variable | Where to find it | Required |
|---|---|---|
| `LD_SDK_KEY` | LaunchDarkly → Project settings → Environments → *env* → **SDK key** | yes |
| `VITE_LD_CLIENT_SIDE_ID` | same page → **Client-side ID** | yes |
| `LD_TRIGGER_URL` | Flag `wall-reactions-comments` → Settings → Triggers (see docs) | for the remediation demo |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | your LLM provider | optional |
| `JWT_SECRET` | any long random string | change for shared deployments |
| `DEMO_MODE`, `VITE_DEMO_MODE` | `true` shows the demo panel and persona switcher | default `true` |

> If you change `.env`, restart `npm run dev`. Vite reads `VITE_*` variables only at startup.

Without LaunchDarkly keys the app still runs in **offline mode**. Every flag uses its code default (off),
and a yellow banner says so.

### Sign in

The login page has one-click **demo personas**. The password for every seeded account is `judo123`.

| Persona | Key | Attributes |
|---|---|---|
| Kenji Watanabe | `sensei-kenji` | head coach · black belt · `kenji@tatami.dojo` |
| Maria Silva | `coach-maria` | coach · black belt · `maria@tatami.dojo` |
| Alex Chen | `student-alex` | student · brown belt · adults |
| Priya Patel | `student-priya` | student · green belt · teens · **beta tester** |
| Aiko Tanaka | `parent-aiko` | parent of Yuki (kids class) · yellow belt |
| Sam Okafor | `student-sam` | student · white belt · adults |

To try **invite-only signup**, open **http://localhost:5173/join/WELCOME-DOJO**, or sign in as a coach →
*Members* → **Create invite link**.

## 3. LaunchDarkly configuration

👉 **Follow [`docs/launchdarkly-setup.md`](docs/launchdarkly-setup.md).** It walks you through creating:

- flags `wall-reactions-comments`, `schedule-calendar-v2` and `schedule-builder`, each with **client-side SDK availability** ticked
- the targeting rules for `schedule-calendar-v2`
- a flag **trigger** on `wall-reactions-comments`
- the metric `session-rsvp` and the experiment
- the AI Config `sensei-assistant`, with three variations and targeting
- the Slack integration (optional)

Every place in the code where a key or a recreated flag is needed is marked with a `>>> REPLACE ME` or `>>> RECREATE` comment:

```bash
grep -rn ">>> RE" server/src web/src scripts .env.example
```

## 4. How it works

```
 Browser (React + launchdarkly-react-client-sdk)          API (Express + @launchdarkly/node-server-sdk)
 ┌───────────────────────────────────────────┐   /api    ┌────────────────────────────────────────────┐
 │ identify(multi-context from /auth/me)     │ ────────▶ │ buildContext(user)  (one source of truth)  │
 │ useFlags()  → old/new component           │           │ variation() guards flagged endpoints       │
 │ on('change') listener → toast             │           │ ErrorRateMonitor → POST trigger URL         │
 │ track('session-rsvp')  → experiment       │           │ AI SDK completionConfig() → Anthropic/OpenAI│
 └──────────────┬────────────────────────────┘           └───────────────┬────────────────────────────┘
                │ streaming (SSE)                                          │ streaming
                ▼                                                          ▼
                         LaunchDarkly  (flags · targeting · triggers · experiments · AI Configs)
```

- **One context, two SDKs.** The server builds the LaunchDarkly multi-context (`server/src/launchdarkly.js#buildContext`)
  and returns it from `/api/auth/me`. The browser passes it straight to `ldClient.identify()`, so both SDKs
  always evaluate the same attributes.
- **Flags are enforced on both sides.** The UI hides a feature that's switched off, and the API refuses its endpoints
  (for example `POST /api/posts/:id/reactions` returns 404 when `wall-reactions-comments` is off). A rolled-back feature
  can't be reached through the API either.
- **Instant updates.** Both SDKs stream flag changes. The React SDK re-renders components that use `useFlags()`.
  `FlagChangeListener` also subscribes to `ldClient.on('change')` to announce releases and rollbacks.
- **Auto-remediation.** `server/src/remediation.js` keeps a sliding window of request outcomes for the
  comments/reactions API. Past the threshold (default: at least 5 requests and 50% or more errors in 60 seconds), it POSTs
  to the flag trigger URL. Covered by unit tests in `server/test/`.
- **AI Configs.** `server/src/ai.js` calls `aiClient.completionConfig('sensei-assistant', context, default, variables)`.
  It fills the prompt template with the member's name, belt, upcoming sessions and attendance, calls whichever provider
  the variation names, and records duration, tokens, success and feedback through the AI SDK tracker.
- **Privacy.** `email` is a private attribute, so it's available for targeting but not stored with analytics events.

## 5. Project structure

```
tatami/
├── server/                      Express API (Node, ES modules)
│   ├── src/
│   │   ├── index.js             app bootstrap, monitor wiring
│   │   ├── config.js            every env var (with REPLACE ME notes)
│   │   ├── launchdarkly.js      SDK init, flag keys, buildContext(), server-side listener
│   │   ├── remediation.js       ErrorRateMonitor + fireTrigger()
│   │   ├── ai.js                Sensei Assistant via AI Configs
│   │   ├── db.js / seed.js      SQLite schema + demo season generator
│   │   ├── auth.js / stats.js   cookie auth, attendance %
│   │   └── routes/              auth, wall, schedule, members, chat, demo
│   └── test/                    node:test unit tests
├── web/                         React (Vite) front end
│   └── src/
│       ├── main.jsx             LaunchDarkly provider (client-side ID goes here via .env)
│       ├── App.jsx              auth + identify(), layout, routes
│       ├── lib/flags.js         flag + metric keys
│       ├── components/          FlagChangeListener, DemoPanel, ChatWidget, Rsvp, ...
│       └── pages/               Wall, Schedule (list vs calendar), SessionDetail, NewSession, Members, Login, Join
├── scripts/
│   ├── simulate-experiment.js   synthetic experiment traffic
│   └── fire-trigger.sh          curl the kill-switch trigger
├── docs/launchdarkly-setup.md   step-by-step LaunchDarkly configuration
├── Dockerfile, docker-compose.yml, .github/workflows/ci.yml
└── .env.example
```

Useful scripts (run from the repo root):

| Command | What it does |
|---|---|
| `npm run dev` | API (auto-restart) + Vite dev server |
| `npm run build` / `npm start` | build the web app and serve everything from the API on :4000 |
| `npm test` | server unit tests |
| `npm run seed` | wipe and re-seed the demo database |
| `npm run trigger` | fire the LaunchDarkly kill-switch trigger |
| `npm run simulate` | send synthetic experiment traffic |

## 6. Running with Docker

```bash
cp .env.example .env    # fill it in
docker compose up --build
# → http://localhost:4000
```

The browser's client-side ID is baked into the build, so `docker compose` passes `VITE_LD_CLIENT_SIDE_ID` from `.env`
as a build argument. Data is kept in the `tatami-data` volume.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| Yellow "LaunchDarkly is not configured" banner | `VITE_LD_CLIENT_SIDE_ID` is missing. Add it to `.env` and restart `npm run dev`. |
| A flag never changes in the browser | Tick **SDKs using Client-side ID** on that flag. Check that `.env` uses keys from the **same environment** you are editing. |
| Flag is on, but comments say "not available" | The server can't see the flag. Check `LD_SDK_KEY` (it must start with `sdk-`) and look for `[launchdarkly] server SDK initialized` in the API log. |
| "Trigger not fired: LD_TRIGGER_URL not configured" | Create the trigger (docs §2a), put the URL in `.env`, restart. |
| Auto-remediation didn't fire | It needs at least 5 reaction/comment requests in 60s with 50% or more failing. The demo panel shows the live error rate. You can change `REMEDIATION_*` in `.env`. |
| Chat replies say "Offline demo reply" | Add `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, matching the provider in your AI Config variation. |
| No "Ask Sensei" button | The AI Config is turned off, or the member is served a disabled variation. |
| Experiment shows only one variation | Make sure the experiment is **started** and uses the **default rule**. The simulator's members don't match Rules 1-3. |
| `node:sqlite` errors | Upgrade to Node 22.13 or newer. |
| Port in use | Set `PORT` in `.env` (and update the proxy in `web/vite.config.js` if it isn't 4000). |

---

Built with the LaunchDarkly [React Web SDK](https://docs.launchdarkly.com/sdk/client-side/react/react-web),
[Node.js server SDK](https://docs.launchdarkly.com/sdk/server-side/node-js) and
[Node.js AI SDK](https://docs.launchdarkly.com/sdk/ai/node-js).
