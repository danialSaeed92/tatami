# LaunchDarkly setup guide

This guide recreates everything the Tatami demo expects in your own LaunchDarkly account.
It takes about 20 minutes. Flag keys, metric keys and the AI Config key **must match exactly**:
they are referenced in code (`server/src/launchdarkly.js` and `web/src/lib/flags.js`).

> A free trial (https://launchdarkly.com/start-trial/) includes everything used here.
> LaunchDarkly's UI changes from time to time. If a menu name below doesn't match exactly,
> search the docs for the feature name (for example "flag triggers").

---

## 0. Project, environment and keys

1. Create a project (for example **Tatami**) or use the default one.
2. Pick an environment (for example **Test**). Everything below is per environment.
3. Go to **Project settings → Environments → Test** and copy:
   - **SDK key** → `LD_SDK_KEY` in `.env` (server only, keep it secret)
   - **Client-side ID** → `VITE_LD_CLIENT_SIDE_ID` in `.env` (browser)

## 1. Context kinds

The app sends a **multi-context** made of two kinds: `user` and `dojo`.
`user` exists by default. LaunchDarkly creates `dojo` automatically the first time it sees it.
You can also add it ahead of time under **Project settings → Context kinds → Create context kind** (key `dojo`).

| Kind | Attribute | Example | Used for |
|---|---|---|---|
| user | `key` | `sensei-kenji` | individual targeting |
| user | `email` (private) | `kenji@tatami.dojo` | "internal staff" rule |
| user | `role` | `coach` / `student` / `parent` | rules |
| user | `belt` | `white` ... `black` | rules |
| user | `ageGroup` | `kids` / `teens` / `adults` | rules, AI Config targeting |
| user | `betaTester` | `true` / `false` | rules |
| dojo | `key`, `name`, `city`, `plan` | `dojo-tatami-sf`, `San Francisco` | dojo-wide targeting |

`email` is marked private, so you can still target on it but LaunchDarkly doesn't store it with analytics events.

---

## 2. Flags

Create three **boolean** flags. For **each one**, under **Client-side SDK availability**, tick
**"SDKs using Client-side ID"**. Without this the browser can't see the flag and always gets the default.

| Name | Key | Variations |
|---|---|---|
| Wall reactions & comments | `wall-reactions-comments` | `true` / `false` |
| Schedule calendar v2 | `schedule-calendar-v2` | `true` (yearly calendar) / `false` (classic list) |
| Recurring schedule builder | `schedule-builder` | `true` / `false` |

### 2a. `wall-reactions-comments` (Part 1: Release & Remediate)

- Targeting **ON**, default rule serves **true**. When targeting is **OFF** the flag serves the **false** variation.
- That's all you need. Toggle the flag on and off to release and roll back.

**Create the trigger (Remediate):**

1. Open the flag → **Settings** → **Triggers** → **Add trigger**.
2. Choose **Generic trigger** and the action **Turn the flag off**.
3. Copy the trigger URL into `.env` as `LD_TRIGGER_URL`. Restart `npm run dev`.

The URL is a secret: anyone who has it can turn the flag off. You can disable or regenerate it from the same screen.
Test it with `npm run trigger`, or with `curl -X POST "$LD_TRIGGER_URL"`.

### 2b. `schedule-calendar-v2` (Part 2: Target)

Turn targeting **ON** and set it up like this:

1. **Individual targeting.** Add **user** `sensei-kenji` to the **true** variation.
   (After you sign in as Kenji once, his key appears in the picker. You can also type it in.)
2. **Rule 1 - Internal staff.** `user` · `email` · **ends with** · `@tatami.dojo` → serve **true**
3. **Rule 2 - Advanced judoka.** `user` · `belt` · **is one of** · `brown`, `black` → serve **true**
4. **Rule 3 - Beta testers.** `user` · `betaTester` · **is** · `true` → serve **true**
5. **Default rule.** Serve **false** for now. The experiment in step 4 replaces it with a 50/50 split.

What each demo persona should see:

| Persona | Matches | Sees |
|---|---|---|
| Kenji Watanabe (`sensei-kenji`) | individual target | calendar |
| Maria Silva (`maria@tatami.dojo`) | Rule 1 | calendar |
| Alex Chen (brown belt) | Rule 2 | calendar |
| Priya Patel (beta tester) | Rule 3 | calendar |
| Aiko Tanaka (parent, kids) | default rule | list (50/50 while the experiment runs) |
| Sam Okafor (white belt) | default rule | list (50/50 while the experiment runs) |

Optional: add a rule on the `dojo` context kind (for example `city` is `San Francisco`) to show targeting a whole club.

### 2c. `schedule-builder` (progressive delivery bonus)

- Targeting **ON**. Add `sensei-kenji` to **true** with individual targeting. Default rule serves **false**.
- Kenji sees **Repeat weekly** on *New session* and Maria doesn't. Later you can add Maria, or move to a percentage rollout.

---

## 3. Metric (Experimentation)

**Metrics → Create metric**:

- Event kind: **Custom**
- Event key: `session-rsvp`
- Measurement: **Occurrence** (conversion, "did the member RSVP?"), success when the value is **higher**
- Randomization unit / context kind: **user**
- Name: `Session RSVP`

The browser sends this event every time a member RSVPs (`web/src/lib/useRsvp.js`).

## 4. Experiment

**Experiments → Create experiment**:

1. Name: *Yearly calendar increases RSVPs*. Hypothesis: *"Members who see the yearly calendar with one-tap RSVP will RSVP more often than members who see the classic list."*
2. Randomization unit: **user**
3. Metric: **Session RSVP** (`session-rsvp`)
4. Flag: `schedule-calendar-v2`, targeting rule: **Default rule**
5. Variations: **false** = control, **true** = treatment. Split 50/50, with 100% of the default-rule audience in the experiment.
6. Save, then **Start** the experiment (in the environment the app uses).

People caught by the individual target and Rules 1-3 still get the calendar. Only the default-rule audience is randomized.

**Generate data.** Real clicks in the app count, but to get a readable result quickly, run:

```bash
npm run simulate                      # 2000 synthetic members, 30% vs 42% RSVP probability
npm run simulate -- --users 5000 --control 0.30 --treatment 0.36
```

The simulator (`scripts/simulate-experiment.js`) evaluates the flag for each synthetic member, so their exposure is
recorded, then sends `session-rsvp` with a different probability per variation. **The data is synthetic**, so say so
when you present it. Results appear on the experiment page after a few minutes. Use the probability to beat
control and the credible interval to decide whether to ship.

---

## 5. AI Config: `sensei-assistant` (extra credit)

**AI Configs → Create AI Config** → mode **Completion**, key `sensei-assistant`.

Create three variations. If a model isn't in the model list, add it as a custom model with the exact model ID.
The provider name must contain `anthropic` or `openai` so the server knows which API to call.

| Variation key | Provider / model | Parameters | System message |
|---|---|---|---|
| `concise-coach` | Anthropic / `claude-haiku-5-5` | `maxTokens` 300, `temperature` 0.3 | see A |
| `kids-friendly` | Anthropic / `claude-haiku-5-5` | `maxTokens` 250, `temperature` 0.6 | see B |
| `technical-sensei` | Anthropic / `claude-sonnet-5-5` | `maxTokens` 500, `temperature` 0.4 | see C |

(OpenAI works too: use provider `openai`, a model such as `gpt-5-mini`, and set `OPENAI_API_KEY`.)

**A - concise-coach**
```
You are Sensei Assistant for {{dojoName}}, a judo club. You're helping {{memberName}} ({{role}}, {{belt}} belt).
Answer in 3 sentences or fewer. Only answer questions about judo, the club and its schedule; politely decline anything else.
Upcoming sessions for this member:
{{upcomingSessions}}
Attendance this season: {{attendancePct}}. Gradings need 75% attendance.
```

**B - kids-friendly**
```
You are a warm, encouraging judo helper for {{dojoName}}. You're talking with {{memberName}}, a parent of
{{childName}} ({{belt}} belt, kids class). Use simple words, a friendly tone and short answers that suit families.
Focus on safety, fun, what to bring and when to come. Never give medical advice - suggest talking to a coach.
Upcoming sessions: {{upcomingSessions}}
Attendance: {{attendancePct}}.
```

**C - technical-sensei**
```
You are an experienced judo coach at {{dojoName}} helping {{memberName}}, a {{belt}} belt {{role}}.
Use correct Japanese terminology (e.g. kuzushi, tsukuri, kake) and explain technique step by step.
Keep answers under 150 words. Upcoming sessions: {{upcomingSessions}}. Attendance: {{attendancePct}}.
```

**Targeting** (turn the AI Config's targeting on):

1. Rule: `user` · `ageGroup` is `kids` → **kids-friendly**
2. Rule: `user` · `belt` is one of `brown`, `black` → **technical-sensei**
3. Default rule → **concise-coach**

Ask the same question as Aiko (parent), Alex (brown belt) and Sam (white belt). Each gets a different prompt and model.
Change a prompt in LaunchDarkly and ask again: the next message uses it, with no deploy.

**Monitoring.** The server records duration, token usage, success/error and 👍/👎 feedback (`server/src/ai.js`).
You'll find them on the AI Config's **Monitoring** tab.

**Optional experiment.** Create an experiment on the AI Config that compares two variations on the default rule,
using the AI positive-feedback metric (or latency or tokens).

**No API key?** The assistant still works. It returns canned offline replies and shows which model and prompt
LaunchDarkly selected, so you can still demo the targeting.

---

## 6. Slack integration (optional)

1. **Integrations → Slack App → Add integration** and authorize your workspace.
2. Subscribe a channel (for example `#dojo-ops`) to flag changes in the Tatami project, or only to `wall-reactions-comments`.
3. When the trigger turns the flag off, Slack shows who or what changed it (the trigger) and when.
