# Architecture

Build-a-bot is one Next.js 16 app (App Router, TypeScript) with Postgres behind it. Everything that keeps people safe runs on the server, in code, not in the model's prompt.

```
            ┌──────────── channels in ─────────────┐
 web chat · Telegram · SMS · phone · email · Slack · Discord · MCP clients
            └──────────────────┬───────────────────┘
                               ▼
                 handleInbound / chat route (SSE)
                               ▼
   ┌──────────────────── runTurn (src/lib/agent/run.ts) ────────────────────┐
   │ owner commands (STOP/START/HELP) → paused? → plan limits → brain       │
   │ → [model ⇄ tools]×8, each tool call → policy engine → allow/ask/deny   │
   │ → approvals (tap to run) → receipts → AI disclosure / crisis footer    │
   └────────────────────────────────┬───────────────────────────────────────┘
                                    ▼
             deliver (src/lib/channels/outbound.ts) → the right channel
```

## Layout

| Path | What lives there |
|---|---|
| `src/app/(marketing)` | Public site: landing, pricing, safety, legal drafts, recipe gallery (`/explore`, `/r/[slug]`) |
| `src/app/build` | The builder (seven steps, no account needed) |
| `src/app/app` | The dashboard: bots, chat, activity, apps & trust, channels, routines, memory, settings, approvals, billing, Bridge, account |
| `src/app/api` | JSON + SSE routes, channel webhooks, OAuth callbacks, the MCP endpoint, cron |
| `src/lib/agent` | The agent loop, prompts, brain resolution, approvals |
| `src/lib/policy` | The policy engine (pure function + tests) |
| `src/lib/llm` | Provider-neutral LLM layer: OpenAI-compatible (Token Factory and most BYOK), Anthropic, and a scripted demo brain |
| `src/lib/tools` | Tool specs, built-in tools, the per-bot toolset, SSRF-safe networking |
| `src/lib/connectors` | The app catalog (data), MCP client + OAuth 2.1, Composio, demo tools |
| `src/lib/channels` | Inbound/outbound for every channel, setup flows, webhook verification |
| `src/lib/bridge`, `bridge/` | Subscription brains on the owner's computer (server side + the CLI) |
| `src/lib/meetings`, `src/lib/transcribe`, `desktop/` | Meeting notes: recording, speech-to-text, notes, and the desktop app that notices calls |
| `src/lib/dictation`, `src/components/voice`, `desktop/src/main/voice` | Voice typing: the dictation pipeline, the personal dictionary, the `/app/voice` page and the desktop app's hold-to-talk |
| `src/app/desktop` | Pages the desktop app shows (the buddy at the bottom of the screen) |
| `src/lib/mcp-server` | The bot's tools as an MCP server |
| `src/lib/scheduler` | Reminders and routines (time zones, next-run math, the tick) |
| `src/lib/billing` | Plans, usage metering, Stripe |
| `src/lib/db` | Drizzle schema, Postgres/PGlite, migrations in `drizzle/` |
| `src/components` | UI kit, avatars, builder, catalog, chat, dashboard sections |

## Data

Postgres via Drizzle (`src/lib/db/schema.ts`). Locally and in tests it's PGlite (embedded Postgres), so `npm run dev` needs nothing installed. Migrations run on first use behind an advisory lock.

Main tables: `users`, `sessions`, `bots`, `connections` (a bot's apps + per-capability permissions), `channels`, `conversations`, `messages`, `approvals`, `receipts`, `contacts`, `memories`, `notes`, `schedules`, `usage`, `credentials` (encrypted secrets), `bridge_devices`, `bridge_jobs`, `recipes`, `meetings`, `meeting_segments`, `dictionary` (voice typing's words and snippets).

- **Receipts are append-only.** A trigger rejects updates and deletes (`drizzle/0001_safety.sql`); only account/bot deletion may remove them, inside a transaction that sets `app.allow_receipt_delete`.
- **Row-level security is on** for every table with no policies, so the database's public API roles (e.g. Supabase's) see nothing; the app connects as the owner role.
- **Secrets** (API keys, OAuth tokens, bot tokens) are AES-256-GCM encrypted under `ENCRYPTION_KEY` (`src/lib/crypto.ts`), never logged, and never sent back to the browser.

## The agent loop

`runTurn` (`src/lib/agent/run.ts`) is the only way a bot does anything. Every caller uses it: the web chat (streams events over SSE), channel webhooks, the scheduler, approval follow-ups and the first greeting.

1. **Owner commands** (STOP, START, HELP) are handled before any model call. STOP pauses the bot from any channel; while paused nothing runs, not even reads.
2. **Limits**: the owner's plan meters included messages, searches, voice minutes and texts (`src/lib/billing/usage.ts`).
3. **Brain** (`src/lib/agent/brain.ts`): included models on Nebius Token Factory, the owner's API key (12 providers + any OpenAI-compatible endpoint), or the owner's subscription via the Bridge. Thinking knobs differ per model family (`includedRequestOptions`); reasoning models get generous `max_tokens`.
4. **Tools** (`src/lib/tools/registry.ts`): built-ins + the bot's apps (MCP or Composio), capped at 48 and filtered by trust (Look only never even sees action tools).
5. **Every tool call goes through the policy engine** and gets a receipt. "Ask" creates an approval (24-hour expiry) the owner can tap from the web or any channel; approving runs the exact stored call.
6. **Replies to other people** carry an AI disclosure; crisis language adds resources (988 in the US) and the bot does not act as a therapist.

## Memory

What a bot knows about its owner lives in `memories`: up to 2,000 per bot, of which up to 15 can be pinned (`src/lib/memory`). Only the ones that matter go into each turn, so small models aren't buried.

- **Choosing them:** `memoriesForTurn` ranks memories against the new message, and at lower weight the directive and the last few messages. It uses BM25 over lightly stemmed words, plus a few groups of related words (family, food, work, travel, health…). Pinned memories go first, then the best matches, then the newest, within a budget set by the brain's tier:

  | Tier | Memories | Characters |
  |---|---|---|
  | Fast models | 24 | 2,400 |
  | Balanced models | 40 | 4,500 |
  | Smart models and subscriptions | 80 | 9,000 |

  The prompt says how many there are in all; the bot finds the rest with `recall`, which uses the same ranking.
- **Keeping it clean:** `remember` skips a fact it already has and updates one when the new fact adds a little detail (`compareFacts`), or when the model names the fact it `replaces`. `forget` deletes on request. The owner edits, pins and deletes in the Memory tab.
- **Bring my memories** (`import.ts`, `POST /api/bots/[botId]/memories/import`):
  - `read`: the owner pastes another assistant's answer to `IMPORT_PROMPT`. A big included model (`TIDY_MODEL`, one call) tidies it into third-person facts and marks a few pins. Without it, a line-by-line reader rewrites "you"/"I" lines about the owner.
  - Both paths drop secrets, lines that steer an assistant, chatter, repeats and facts the bot already knows. Nothing is saved yet.
  - `save`: the facts the owner kept are checked again and inserted as `source = "import"`, with a receipt.

## Roles

A role makes a bot a specialist: a tutor, a job applier, a language partner, a fitness coach or a meal planner (`src/lib/roles.ts`, stored in `bots.role`).

- **Prompt:**
  - The bot is "an AI tutor" instead of "a personal AI assistant".
  - It gets the role's method as short lines that small models follow too.
  - It's told to pin the basics with `remember` (`pin: true`, capped at 15 pins), and to stay in its lane softly.
  - The bot's jobs come after the role as extras.
- **First message:** `greetingDirective` asks the role's `firstAsk` instead of offering ideas. The chat's starter chips list the role's ideas first.
- **Recipes:**
  - Each role has a featured recipe (`FEATURED_RECIPES`, with `role`): face, built-ins, routines, Free-plan sized.
  - `createBot` takes the builder's `role`, or the recipe's when none is sent.
  - `botToRecipe` keeps the role when a bot is shared.
- **UI:**
  - The builder's first step links to each role's recipe ("Or start with a ready-made bot").
  - The review shows the role.
  - Settings → What it helps with has a Role picker (`PATCH /api/bots/[botId]` with `role`, or `null` for a general assistant).
  - The header badge reads "AI tutor".

## The policy engine

`evaluate()` in `src/lib/policy/engine.ts` is a pure function with its own tests. Inputs: trust level, effect (read/write/send/delete/spend/admin), risk, recipients, whether the run has read outside content ("tainted"), owner rules per app capability, caps, quiet hours. Output: allow, ask or deny, with reasons.

| | Look only | Ask me first | Trusted helper | Full faith |
|---|---|---|---|---|
| Read, search | ✓ | ✓ | ✓ | ✓ |
| Low/medium-risk writes | ✗ | ask | ✓ | ✓ |
| High-risk changes, deletes | ✗ | ask | ask | ✓ |
| Message someone new | ✗ | ask | ask | ✓ (clean run) |

Hard limits that apply at every level:
- **Prompt-injection guard:** after a run reads outside content (an email, a web page, a tool result), sending to a recipient who isn't the owner or a known contact always asks — even under Full faith, even with an owner "allow" rule.
- Secrets (API keys, tokens) are never sent; to the owner it asks, to anyone else it's blocked.
- Money is off unless the owner sets a monthly cap, and the cap is never exceeded.
- Bulk deletes (more than 10 items) and the daily action cap ask.
- Sensitive apps (money, health, identity) ask before any change.
- Quiet hours hold messages to other people.

## Apps (connectors)

The catalog (`src/lib/connectors/catalog.ts`) is data: ~190 apps across 28 categories, each with capabilities (effect + risk) and ordered ways to connect:

- **builtin**: runs on our servers, no sign-in (web search via Tavily, web reader, weather, reminders, notes, memory, its own inbox...).
- **mcp**: the vendor's official remote MCP server. OAuth 2.1 client (`src/lib/connectors/mcp/oauth.ts`): protected-resource metadata → authorization-server metadata → pre-registered client, else a Client ID Metadata Document (`/oauth/client.json`), else dynamic registration; PKCE S256, `resource` indicators, issuer checks, refresh. Bearer tokens can be pasted for servers that use them.
- **composio**: managed sign-in and tools for apps without an open MCP server (each bot is its own Composio user).
- **custom_mcp**: any MCP server URL the owner pastes.

Tools from MCP/Composio are classified by name into effects and risks (`effects.ts`) so the same policy applies. Connectors that share one server (Jira/Confluence/Bitbucket on Atlassian, Outlook mail vs calendar) only see their own tools. In demo mode, apps run against simulated data (`demo-tools.ts`), including a planted phishing email for the injection guard demo.

## Channels

| Channel | How |
|---|---|
| Web | SSE chat, approvals inline |
| Telegram | Managed bots (one tap creates the owner's own named bot from our manager bot), or a pasted BotFather token; webhook secret header |
| SMS & phone calls | Twilio; voice uses speech `<Gather>` turns with a short async poll so slow brains don't time out; signatures verified |
| Email | AgentMail or Resend inbound; each bot gets its own brand-free address; Svix signatures |
| Slack | One click: a shared app (OAuth v2). DMs are routed by workspace and Slack person to that person's own bot, and replies carry the bot's name and face. Or the bot's own app from a manifest link, where "link CODE" pairs the owner. v0 signatures |
| Discord | HTTP interactions (`/ask`, `/link`), Ed25519 verification, deferred replies |
| WhatsApp, iMessage | Waitlist (platform rules) |

Owners prove each channel is theirs (codes for phone/email, the Slack sign-in that adds the app or a link code, link codes for Discord, the managed-bot flow for Telegram); only the verified owner can drive the bot. Other people who message it get a disclosed AI assistant that can't use the owner's tools.

## Subscriptions: the Bridge

Vendor rules allow a person's Claude or ChatGPT plan only through their own CLI on their own computer. The Bridge (`bridge/bab-bridge.mjs`) is a tiny Node CLI the owner runs:

1. `pair CODE` exchanges a one-time pairing code for a device token.
2. `start` long-polls `/api/bridge/jobs`. For each job it runs the owner's own `claude -p` or `codex exec` in an empty folder, with built-in tools and hooks disabled, and only our MCP server mounted (with a short-lived, job-scoped token). API keys are scrubbed from the child's environment so it uses the owner's own login.
3. Tool calls come back to `/api/mcp/[botId]` and go through the same policy engine, approvals and receipts.
4. The reply is posted back and delivered on the right channel.

When the computer is asleep, the bot waits (default) or, if the owner opted in, answers with the included model.

## Meeting notes

The bot takes notes in calls, only after the owner says yes, and stays visible the whole time it listens.

```
desktop app (Electron, desktop/)            browser (Meetings tab)
  notices a call → the bot peeks up:          Start → share the call's tab + mic
  "Want me to take notes?"                     the bot sits at the bottom of the page
  yes → it sits at the bottom of the           (and can pop out in a floating window)
  screen with a red dot and a timer
            │  mic track = the owner, system/tab track = everyone else
            ▼  ~20-second standalone audio chunks (6 s in demo mode)
POST /api/bots/[botId]/meetings/[id]/audio  →  speech-to-text (any OpenAI-compatible
            │                                  /audio/transcriptions endpoint; Groq by default,
            │                                  Together AI as fallback) → transcript lines
            ▼                                  audio is never stored
POST …/finish  →  the bot writes notes  →  web chat + the owner's best channel
```

- **Tables:** `meetings` (title, app, status recording → processing → ready, summary, notes, action items) and `meeting_segments` (time-sortable transcript lines; a chunk with no speech leaves an empty marker so retries are idempotent).
- **Auth:** the web app uses the session; the desktop app uses a device token from the same pairing as the Bridge (`src/lib/meetings/auth.ts`).
- **Notes** (`src/lib/meetings/notes.ts`): one model call with no tools, the transcript wrapped as untrusted content, so a hostile line in a call can only skew the notes. Meetings over about an hour are summarized in parts first. Bots on the owner's own Claude/ChatGPT plan write their notes on the owner's computer, as a Bridge job that reads the transcript through the bot's tools.
- **Tools:** `list_meetings`, `read_meeting`, `search_meetings`. All three taint the run, so a transcript can't get the bot to email a stranger without the owner's tap, even under Full faith (tested).
- **Limits:** meeting minutes per plan (wall-clock time, counted once across both tracks); 4 hours per meeting; one recording per bot at a time; the scheduler wraps up recordings whose recorder vanished (20 minutes without audio), gives notes that never finished an honest ending, and deletes transcripts past each bot's retention (90 days by default; the notes stay).
- **Consent:** never before the owner says yes, no auto-record, and only while the bot is visible (the desktop window or the browser's picture-in-picture window). Each meeting records who said yes, when, and whether the heads-up was copied for the call.
- **The buddy** (`src/components/meetings/Buddy.tsx`): the same component on three surfaces. `/desktop/buddy` is what the desktop app shows in its transparent, always-on-top window; its contract is `src/components/meetings/desktop-api.ts`.

## Voice typing

Hold a key in any app and talk; what the owner meant is typed at the cursor. Starting with "Hey" and a bot's name asks that bot instead. The desktop app does it everywhere; `/app/voice` does it in the browser with the same pipeline.

```
desktop app (desktop/src/main/voice)          browser (/app/voice, TryVoice)
  hold the shortcut → the pill + the mic         hold the button (click: hands-free)
  let go → one recording                          let go → one recording
            │  + the kind of app in front (chat, email, code…), language, the owner's switches
            ▼
POST /api/voice/dictate  (raw audio body; device token or session)
   1. limits: words a month per plan, 3,000 dictations a day, 60 a minute, the site's daily ceiling
   2. speech-to-text (Groq whisper-large-v3-turbo), prompted with the owner's words and bots' names
   3. guards: too little speech → nothing; silence turned into "Thank you." or the prompt echoed → nothing
   4. "Hey Otto, …" → { kind: "command" } → the caller asks POST /api/voice/ask (SSE, runTurn)
   5. plain cleanup (always): fillers, stutters, "new line", "scratch that"
   6. AI cleanup: one strict prompt per app style; the answer is checked and thrown out if it
      answered the words instead of cleaning them, added words, or lost a snippet marker
   7. the dictionary: spellings, then snippets → { kind: "text", text, heard, words }
audio is never stored; the server keeps a word count, never the words
```

- **Files:** `src/lib/dictation/text.ts` (pure text rules: tidy, snippets, commands, the guards, the checks on the AI's answer), `polish.ts` (the prompt, its examples and where it runs), `index.ts` (the pipeline, limits, the owner's vocabulary), `dictionary.ts` (add/edit/delete), `demo.ts` (sample dictations for demo mode). Routes under `src/app/api/voice/`.
- **The AI cleanup** runs on Groq (`openai/gpt-oss-120b`, low reasoning) with the speech-to-text key, so the words go to one provider; else on the included model; or not at all (`DICTATION_POLISH`). It has a few seconds: when it's slow, fails or its answer fails the checks, the plain cleanup is typed instead, so a dictation never waits long or comes back wrong.
- **The dictionary** (`dictionary` table: `kind` word | snippet, `text`, `heard` = what speech-to-text writes instead or the phrase that types a snippet, `source` manual | correction). Words are fed to speech-to-text as a hint and fixed afterwards; names the owner's bots remember (`memories`) are used too, without being copied. Snippets are swapped for markers before the AI cleanup so it can't rewrite them.
- **"Hey {bot}"** goes into the bot's web conversation like a typed message (`meta.via = "voice"`), with a directive to answer briefly, so it runs through `runTurn`, the policy engine and approvals like everything else, and shows up in the chat later.
- **Auth:** the desktop app's device token (the same pairing as the Bridge) or the web session (same-origin checked for writes): `src/lib/dictation/auth.ts`.
- **Limits:** `usage.dictationWords` (Free 8,000 words a month; Plus and Pro unlimited), counted when text is typed, never for commands or nothing heard. The per-owner daily cap and the site ceiling (`DICTATION_DAILY_LIMIT`) keep "unlimited" from being a blank check.
- **The desktop half:** a keyboard hook (`uiohook-napi`) hears the shortcut anywhere (a pure state machine: hold, tap, double tap for hands-free, chords left alone); the pill is a small focus-less window; the text is pasted with the clipboard (snapshot → paste → put back) and real key presses. It works out the app's kind locally and sends only that. History is encrypted on the computer. See `desktop/README.md`.

## The bot as an MCP server

`/api/mcp/[botId]` serves the bot's tools over Streamable HTTP (stateless, JSON responses; legacy `initialize` and modern `server/discover` clients). Owners can mint a token in Settings and use their bot's apps from Claude Desktop, Claude Code or any MCP client, under the same rules.

## Scheduler

Reminders and routines are rows in `schedules` with a next-run time computed in the owner's time zone (`src/lib/scheduler/time.ts`: once, daily with weekdays, interval, cron). `/api/cron/tick` (Vercel Cron, every minute) or the in-process ticker (`src/instrumentation.ts`, self-hosted) runs due ones through `runTurn` and delivers results.

## Billing

Plans live in `src/lib/billing/plans.ts`; limits are enforced in code. Stripe Checkout and the customer portal handle payment; the webhook keeps `users.plan` in sync. In demo mode, plans switch instantly from the billing page.

## Demo mode

`DEMO_MODE=1` (default outside production) simulates whatever isn't configured:
- **A scripted brain** (`src/lib/llm/demo.ts`) that calls the real tools, so the policy engine, approvals and receipts all run for real. It answers every job's starter ideas, and does its time math on the owner's clock.
- **Simulated apps and channels** with sample data: an inbox with a phishing email, a week of calendar, a few PRs.
- **A scripted meeting** for transcription, and **sample dictations** for voice typing (the pill and the page say *demo*).
- **Instant plan switching.**

Every flow in the product can be tried with zero keys, and nothing real is sent or charged. `docs/TRY-IT.md` walks through it.

## Testing

- `npm test`: the policy engine, scheduler math, the receipts trigger, and the full agent pipeline on in-memory Postgres (greeting, STOP/START, reminders, phishing detection, the injection guard under Full faith, approvals, Look only, strangers can't drive the bot, append-only receipts), and meeting notes end to end (chunks → transcript → notes → tools, device tokens, plan limits, stale recordings, notes on the owner's computer, a transcript that tries to make the bot email a stranger), and memory (which memories each brain size gets in a real turn, Bring my memories against a stand-in model and line by line, remember/recall/forget, the pin cap), and voice typing (the text rules on real-world transcripts, the pipeline against a fake Groq: prompts, guards, the AI cleanup's checks and timeouts, snippets, commands, limits; the routes and the dictionary).
- `npm run test:e2e` (after `npm run build`; it starts `next start` on port 3100 with its own database), on a phone and a desktop:
  - the builder to a live chat, an approval and STOP;
  - Bring my memories: paste, untick, save, pin;
  - a ready-made tutor: one tap in the builder, its first question, then back to a general assistant in Settings;
  - meeting notes in the browser with a fake microphone: consent, the floating window, the transcript, the notes, deleting;
  - voice typing in the browser with a fake microphone: hold to type, hands-free, "Hey Otto" and its reply, a dictionary word that's then used;
  - every page loads;
  - axe accessibility scans in light and dark.
- **On real Postgres.** Supabase runs the server through postgres.js and a transaction pooler, which are stricter than the in-memory database the tests use. Check database changes on a real one too: a local Postgres with pgbouncer in front in `pool_mode = transaction` on port 6543, like Supabase's pooler (port 6543 also makes the client skip prepared statements).
  - `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:6543/bab_test npx vitest run tests/postgres.test.ts` wipes that database and covers sign-in, rate limits, the admin numbers and the cron tick.
  - `DATABASE_URL=postgres://postgres@127.0.0.1:6543/bab_e2e ENCRYPTION_KEY=$(openssl rand -base64 32) npm run test:e2e` runs the whole e2e suite there.
- `cd desktop && npm test`: call detection on each OS (parsers on captured-style output), the call state machine, the controller's safety rules, the upload queue, placement, token storage, and voice typing's shortcut machine, paste and clipboard restore, app categories, history and controller.
- `cd desktop && npm run test:e2e`: the real Electron app under Xvfb against a running dev server: pair, a fake call, ask, take notes, pause, stop, notes ready, stop and delete, and the mic-only path; then voice typing with real X key presses: hold, talk, the cleaned-up text pasted into another app with the clipboard put back, hands-free, Esc, and "Hey Otto".
