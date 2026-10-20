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
   │ owner commands (STOP/START/HELP) → paused? → credit / fair use → brain │
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
| `src/lib/meetings`, `src/lib/transcribe`, `desktop/` | Meeting notes: the desktop app that notices calls and hears them on the computer, the transcript, notes |
| `src/lib/dictation`, `src/components/voice`, `desktop/src/main/voice` | Voice typing: the dictation pipeline, the personal dictionary, the `/app/voice` page and the desktop app's hold-to-talk |
| `src/lib/calls`, `src/components/call`, `voice/` | Calls: who's calling, the phone PIN, the call API the voice server uses, the Call button; the voice server itself (NVIDIA Parakeet and Magpie, turn-taking, Twilio Media Streams) |
| `src/app/desktop` | Pages the desktop app shows (the buddy at the bottom of the screen) |
| `src/lib/mcp-server` | The bot's tools as an MCP server |
| `src/lib/scheduler` | Reminders and routines (time zones, next-run math, the tick) |
| `src/lib/billing` | Prices (at cost), credit, usage metering, Stripe top-ups |
| `src/lib/db` | Drizzle schema, Postgres/PGlite, migrations in `drizzle/` |
| `src/components` | UI kit, avatars, builder, catalog, chat, dashboard sections |

## Data

Postgres via Drizzle (`src/lib/db/schema.ts`). Locally and in tests it's PGlite (embedded Postgres), so `npm run dev` needs nothing installed. Migrations run on first use behind an advisory lock.

Main tables: `users`, `sessions`, `bots`, `connections` (a bot's apps + per-capability permissions), `channels`, `conversations`, `messages`, `approvals`, `receipts`, `contacts`, `memories`, `notes`, `schedules`, `usage`, `credentials` (encrypted secrets), `bridge_devices`, `bridge_jobs`, `recipes`, `meetings`, `meeting_segments`, `dictionary` (voice typing's words and snippets), `calls` (who called, the transcript, the report, what it cost).

- **Receipts are append-only.** A trigger rejects updates and deletes (`drizzle/0001_safety.sql`); only account/bot deletion may remove them, inside a transaction that sets `app.allow_receipt_delete`.
- **Row-level security is on** for every table with no policies, so the database's public API roles (e.g. Supabase's) see nothing; the app connects as the owner role.
- **Secrets** (API keys, OAuth tokens, bot tokens) are AES-256-GCM encrypted under `ENCRYPTION_KEY` (`src/lib/crypto.ts`), never logged, and never sent back to the browser.

## The agent loop

`runTurn` (`src/lib/agent/run.ts`) is the only way a bot does anything. Every caller uses it: the web chat (streams events over SSE), channel webhooks, the scheduler, approval follow-ups and the first greeting.

1. **Owner commands** (STOP, START, HELP) are handled before any model call. STOP pauses the bot from any channel; while paused nothing runs, not even reads.
2. **Credit**: a turn on an included model needs credit left; on the owner's own AI, a monthly fair-use limit applies (`checkSpend` in `src/lib/billing/usage.ts`). What the turn cost (tokens at Token Factory's price, lookups at Tavily's) is recorded as it happens.
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
  - Each role has a featured recipe (`FEATURED_RECIPES`, with `role`): face, built-ins, routines, kept small (at most 2 routines and 3 apps).
  - `createBot` takes the builder's `role`, or the recipe's when none is sent.
  - `botToRecipe` keeps the role when a bot is shared.
- **UI:**
  - The builder's first step links to each role's recipe ("Or start with a ready-made bot").
  - The review shows the role.
  - Settings → What it helps with has a Role picker (`PATCH /api/bots/[botId]` with `role`, or `null` for a general assistant).
  - The header badge reads "AI tutor".

## Checking facts (Tavily)

The tutor checks study material against the web, the student's course first (`src/lib/tools/builtin/check.ts`; both tools come with Web search):

- **`find_course_sources`**: from a syllabus (course, school, textbook, instructor), two Tavily searches: the course by its name, school and instructor (which finds its department and catalog pages), and open textbooks on its subject (OpenStax, LibreTexts, MIT OpenCourseWare, Khan Academy, the Open Textbook Library). What it finds goes in a note, "Course: <course>", with the textbook's name; the owner can see and edit it. Tavily refuses a `*.edu` domain filter (HTTP 400), so the course search has none, and a search for the textbook's errata was dropped: it returned spam and pirated-book sites.
- **`check_facts`**: up to 8 short claims, one search each, preferring the course's sites (from those notes) and open textbooks (`include_domains_mode: "prefer"`), with homework-answer and pirated-book sites left out (`exclude_domains`, and filtered again from the results). Only the claims go to Tavily, never the files. The bot judges each claim from the sources; when they disagree with the class, it says both and goes with the class for exams.
- **Billing:** each search is a lookup at Tavily's price. The calls are counted against the day's search ceiling before they run; a check that doesn't fit doesn't run and isn't counted.
- **Sources on cards:** flashcards and quiz questions take a `source_url`, kept only if a lookup returned that page in the last day (each tool receipt keeps the pages it returned in `detail.sources`, which Activity shows), so a card never links a made-up page. The study window shows it as a link.

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
| SMS & phone calls | Twilio; signatures verified. With the voice server (below) and `TWILIO_MEDIA_STREAMS=1`, a call is streamed to it; otherwise, or when it's down or busy, voice uses speech `<Gather>` turns with a short async poll so slow brains don't time out |
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

The bot takes notes in calls, only after the owner says yes, and stays visible the whole time it listens. Notes are taken in the desktop app (like voice typing); the website shows them and never records.

```
desktop app (Electron, desktop/)
  notices a call → the bot peeks up: "Want me to take notes?"
  yes → it sits at the bottom of the screen with a red dot and a timer
            │  mic track = the owner, system track = the call (everyone else); "in the room": mic only
            ▼  ~20-second standalone webm/opus pieces, each ending at a pause when there's one near
            │  (6 s with scripted speech, in tests)
  each piece → 16 kHz WAV (hidden decoder page) → NVIDIA Parakeet on the computer, with word times
            │  → transcript lines (at pauses and sentence ends); the audio never leaves the computer
            ▼  (a piece waits on disk while Parakeet downloads; voice typing goes first)
POST /api/bots/[botId]/meetings/[id]/audio  { heard: [{ startMs, endMs, text }] }  →  stored lines
            │  (or a piece's audio, from an app that can't run Parakeet, to a server with speech-to-text)
            ▼
POST …/finish  →  the bot writes notes  →  web chat + the owner's best channel
```

- **Tables:** `meetings` (title, app, status recording → processing → ready, summary, notes, action items) and `meeting_segments` (time-sortable transcript lines; a chunk with no speech leaves an empty marker so retries are idempotent).
- **Auth:** starting a meeting and sending what was said take the desktop app's device token only (the same pairing as the Bridge; `meetingAuth(…, { appOnly: true })` in `src/lib/meetings/auth.ts`). The web app (the session) lists meetings, stops a recording, writes notes again and deletes.
- **Hearing it on the computer** (`desktop/src/main/meeting-speech.mjs`, `decoder-window.mjs`, `voice/local-speech.mjs`): the same Parakeet engine and "Private speech" setting as voice typing. The upload queue holds a piece until it can be heard; the notes are written only once every piece is in, and while pieces wait the app sends `PATCH { hearing: true }` so the server doesn't wrap the meeting up as abandoned. The desktop session says what the server takes: `meetings.local` (lines heard on the computer) and `meetings.available` (audio it hears itself).
- **Notes** (`src/lib/meetings/notes.ts`): one model call with no tools, the transcript wrapped as untrusted content, so a hostile line in a call can only skew the notes. Meetings over about an hour are summarized in parts first. Bots on the owner's own Claude/ChatGPT plan write their notes on the owner's computer, as a Bridge job that reads the transcript through the bot's tools.
- **Tools:** `list_meetings`, `read_meeting`, `search_meetings`. All three taint the run, so a transcript can't get the bot to email a stranger without the owner's tap, even under Full faith (tested).
- **Limits:** no minutes cap: hearing a call on the computer is free, and the notes on an included model need credit (a recording heard on our server instead needs it too); minutes are counted (wall-clock time, once across both tracks) for Credit & usage; 4 hours per meeting; one recording per bot at a time; the scheduler wraps up recordings whose recorder vanished (20 minutes without audio), gives notes that never finished an honest ending, and deletes transcripts past each bot's retention (90 days by default; the notes stay).
- **Consent:** never before the owner says yes, no auto-record, and only while the bot is visible (the desktop app's window at the bottom of the screen). Each meeting records who said yes, when, and whether the heads-up was copied for the call.
- **The buddy** (`src/components/meetings/Buddy.tsx`): `/desktop/buddy` is what the desktop app shows in its transparent, always-on-top window; its contract is `src/components/meetings/desktop-api.ts`.

## Voice typing

Hold a key in any app and talk; what the owner meant is typed at the cursor. Starting with "Hey" and a bot's name asks that bot instead. It happens in the desktop app, like Wispr Flow: the website doesn't listen, and the voice endpoints (dictate, edit, ask) answer only the app's device token. `/app/voice` gets the owner the app, pairs it, and keeps their words.

```
desktop app (desktop/src/main/voice)
  hold the shortcut → the pill + the mic
  let go → one recording
  NVIDIA Parakeet on this computer → the words
  (NeMo-Speech.cpp on 127.0.0.1; or, when this server turns recordings into text and Parakeet
  can't — Private speech off, a language it doesn't know, an engine error — the recording)
            │  + the kind of app in front (chat, email, code…), language, the owner's switches
            ▼
POST /api/voice/dictate  (JSON { heard }, or a raw audio body; the app's device token)
   1. limits: credit for a recording heard on the server (words heard on the computer need none), 3,000 dictations a day, 60 a minute, the site's daily ceiling
   2. speech-to-text, unless the computer already did it (NVIDIA Parakeet on our speech server;
      Whisper providers get the owner's words and bots' names as a prompt)
   3. guards: too little speech → nothing; silence turned into "Thank you." or the prompt echoed → nothing
   4. "Hey Otto, …" → { kind: "command" } → the caller asks POST /api/voice/ask (SSE, runTurn)
   5. plain cleanup (always): fillers, stutters, "new line", "scratch that"
   6. AI cleanup: one strict prompt per app style; the answer is checked and thrown out if it
      answered the words instead of cleaning them, added words, or lost a snippet marker.
      Skipped when there's nothing for it to do (needsPolish: short, punctuated, no correction,
      no numbers or punctuation said in words, no name that sounds like one of theirs)
   7. the dictionary: spellings, then snippets → { kind: "text", text, heard, words }
audio is never stored (and from the desktop app, with Private speech, never sent); the server
keeps a word count, never the words
```

- **Private speech** (`desktop/src/main/voice/local-speech.mjs`): the desktop app downloads NVIDIA NeMo-Speech.cpp 0.2.0 for its platform (GitHub release) and Parakeet TDT 0.6B v3 in 8-bit GGUF (Hugging Face, 714 MB), each pinned to its SHA-256, resumable, into the app's folder, and runs `nemo-speech serve` on 127.0.0.1 behind a random key, from the shortcut's press until 20 minutes unused. The pill hands over the recording as 16 kHz WAV too (decoded in Chromium); the engine's text goes to `/api/voice/dictate` as `{ heard }`, and the server skips speech-to-text, so its pipeline (guards, "Hey {bot}", cleanup, dictionary) is the same for both. When it can't (a language Parakeet doesn't speak, an engine error or crash, Private speech off, a server that doesn't say `voice.local` in `/api/desktop/session`), the recording goes to the server instead, if the server turns recordings into text (`voice.available` in the session). If it doesn't, nothing is sent and the pill says why ("Getting NVIDIA Parakeet: 45%…", "Turn on Private speech…"): words are never made up. macOS (Metal on Apple silicon), Windows x64 and Linux x64. So the server needs no speech-to-text of its own for voice typing.

- **Files:** `src/lib/dictation/text.ts` (pure text rules: tidy, snippets, commands, the guards, the checks on the AI's answer), `polish.ts` (the prompt, its examples and where it runs), `index.ts` (the pipeline, limits, the owner's vocabulary), `dictionary.ts` (add/edit/delete), `demo.ts` (sample dictations, for tests: `DEMO_SPEECH`). Routes under `src/app/api/voice/`.
- **The AI cleanup** runs on the included model on Token Factory; on Groq (`openai/gpt-oss-120b`, low reasoning) when speech-to-text runs on Groq, so the words go to one provider; or not at all (`DICTATION_POLISH`). It has a few seconds: when it's slow, fails or its answer fails the checks, the plain cleanup is typed instead, so a dictation never waits long or comes back wrong.
- **The dictionary** (`dictionary` table: `kind` word | snippet, `text`, `heard` = what speech-to-text writes instead or the phrase that types a snippet, `source` manual | correction). Words are fed to speech-to-text as a hint and fixed afterwards; names the owner's bots remember (`memories`) are used too, without being copied. Snippets are swapped for markers before the AI cleanup so it can't rewrite them.
- **Speech-to-text** (`src/lib/transcribe`, `speech/`): one client for any OpenAI-compatible `/audio/transcriptions`. The recommended main provider is our own speech server, `speech/`: NVIDIA Parakeet TDT 0.6B v3 (English and 24 European languages) and NVIDIA Nemotron 3.5 ASR (Japanese, Chinese, Korean, Hindi, Arabic, Vietnamese, Turkish, Norwegian) on NVIDIA NeMo-Speech.cpp, behind a small Node server that checks a key, turns any recording into 16 kHz WAV (plus a second of silence, so the last word isn't cut), picks the model by language and answers in OpenAI's shape. It runs as a Nebius Serverless AI endpoint. The backup (`TRANSCRIBE_FALLBACK_*`) is NVIDIA Parakeet on Together AI, with Whisper there for languages neither NVIDIA model hears; a language the main provider can't hear goes straight to the backup. NVIDIA's models take no prompt, so the owner's words reach them afterwards: a name that sounds like one of theirs sends the text through the AI cleanup, which knows them, and the dictionary's spellings apply last.
- **Editing by voice** (`src/lib/dictation/edit.ts`, `POST /api/voice/edit`): Shift with the shortcut makes the recording an instruction. The desktop app copies the selection (a marker on the clipboard, then copy, then the clipboard put back; never in a terminal), dictates the instruction with the AI cleanup and commands off, and sends both. One model call, no tools: the selection is wrapped in tags as text to work on, after worked examples that include a selection giving orders; the reply must be `<replace>` (typed over the selection) or `<answer>` (shown in the pill), and a chat-style preamble, our own tags or a reply far longer than the job is refused. "Make this shorter" with nothing selected is refused before any model call. Typed words count like dictation; the selection is never stored.
- **"Hey {bot}"** goes into the bot's web conversation like a typed message (`meta.via = "voice"`), with a directive to answer briefly, so it runs through `runTurn`, the policy engine and approvals like everything else, and shows up in the chat later.
  - **With a selection** (Shift held), the selected text goes along (`meta.selection`, shown in the chat bubble). The model reads it wrapped as `<untrusted_content>` (`src/lib/agent/selection.ts`, for included brains and the Bridge alike), and the run is tainted while it's in that conversation's history, so the injection guard asks before a send to anyone new, even under Full faith.
- **Auth:** the desktop app's device token (the same pairing as the Bridge) for talking, editing and asking; the web session (same-origin checked for writes) only for the dictionary: `src/lib/dictation/auth.ts`.
- **Limits:** no word limit. `usage.dictationWords` is counted when text is typed, never for commands or nothing heard. What costs money is paid from credit: a recording heard on the server, and the AI cleanup (without credit, the plain cleanup is typed). The per-owner daily cap and the site ceiling (`DICTATION_DAILY_LIMIT`) keep it from being a blank check.
- **The desktop half:** a keyboard hook (`uiohook-napi`) hears the shortcut anywhere (a pure state machine: hold, tap, double tap for hands-free, chords left alone); the pill is a small focus-less window; the text is pasted with the clipboard (snapshot → paste → put back) and real key presses. It works out the app's kind locally and sends only that. History is encrypted on the computer. See `desktop/README.md`.

## Calls

Calling a bot takes three pieces: the caller (the Call button in the browser, or a phone through Twilio), the voice server (`voice/`, on its own machine; its README has the details and the numbers), and this app, which decides who's calling and does the work.

```
browser: Call button → POST /api/bots/:id/calls → { callId, token, wsUrl }
         → WebSocket wss://voice…/call: hello { token }, then 16 kHz PCM both ways
phone:   Twilio → POST /api/webhooks/twilio/voice → <Connect><Stream url="wss://voice…/twilio">
         with the token as a <Parameter>; then <Redirect> to …/voice/fallback (the simpler line)
            ▼
voice server: Silero VAD → turn detector → NVIDIA Parakeet → the talker (Nemotron 3.5 Lightning
  on Token Factory, streamed) → NVIDIA Magpie, streamed, stopped mid-word when the caller cuts in
            │  each request signed: x-voice-signature: t=<unix>,v1=HMAC-SHA256(secret, "t.body")
            ▼
POST /api/calls/session   the token → who's calling, the greeting, the owner's context, phrases to listen for
POST /api/calls/act       ask_bot → runTurn in the call's conversation: apps, memory, approvals, receipts
POST /api/calls/pin       a PIN said or typed on the call (the talker never sees it)
POST /api/calls/turn      each line of the transcript as it happens
POST /api/calls/end       the report: how long, how fast, the talker's tokens → usage, a receipt, the chat card
```

- **The shared secret** (`VOICE_SERVER_SECRET`, 32+ characters) signs both ways: the app signs call tokens (`v1.<payload>.<HMAC>`, `src/lib/calls/tokens.ts`, mirrored in `voice/src/auth.ts`), which name the call, the bot and the kind, and for a phone call Twilio's CallSid. The browser has 2 minutes to use its token, Twilio 10. A call is claimed once (`pending → active`, within 15 minutes). The voice server signs every request to `/api/calls/*` (300 s tolerance); a bad signature is a 401.
- **Which bot** (`routeTwilio` in `src/lib/channels/twilio-inbound.ts`): every bot's phone channels carry the shared number (`TWILIO_PHONE_NUMBER`), since they call and text from it, so on that number the caller's phone decides. A call or text reaches a bot whose owner linked that phone: one that isn't paused, and the one used last if they have several ("@Name …" picks one in a text). A phone that isn't linked hears how to link it and reaches no one's bot, and one whose bot has calls off hears that. Only a number marked as a bot's own (`channels.config.ownNumber`, which nothing sets until bots can get one) answers anyone, while exactly one bot has it; the phone channels' `address` is just the number they send from, so a number that used to be the shared one is no bot's own. Only channels that are on answer.
- **Who's calling** (`phoneSpeaker`, `greetingFor` in `src/lib/calls/index.ts`):
  - the **owner**: on the Call button, or from their number with STIR/SHAKEN attestation A (`StirVerstat=TN-Validation-Passed-A`);
  - **unverified**: their number without it (caller ID can be faked). `act` refuses until the phone PIN is said or typed (`src/lib/calls/pin.ts`: scrypt, 4–8 digits, no repeats or runs, 5 wrong tries lock it for 15 minutes);
  - a **contact**: anyone else. What they say reaches the bot as a message from someone who isn't the owner, which (as on every channel) can't use the owner's apps, so the bot takes a message.
  - The greeting says "your AI assistant" on the owner's first call only; everyone else always hears that it's an AI assistant.
- **The call's conversation** is `call:<id>` (kind `voice`): what `ask_bot` asks runs there through `runTurn` (`meta.via = "call"`), with the same credit checks, policy engine and approvals as a chat. The talker is told what's waiting for a tap and says so; it never says something was done unless the agent's answer says so.
- **The transcript** is appended to `calls.transcript` as the call goes (up to 400 lines). When the call ends it's posted to the bot's web chat as one message (`meta.kind = "call"`, the `ChatCall` card). Audio is never kept, here or on the voice server.
- **Billing** (at cost): a call in the app costs the talker's tokens at its Token Factory price; the bot's own work costs what a chat turn would. A phone call adds Twilio's minutes, counted by the status callback (`/api/webhooks/twilio/voice/status`): streamed calls at `callMinuteStreamIn`/`Out` (Twilio's minute plus Media Streams, no per-use speech fees), calls on the simpler line at `callMinute`, and a call a bot places to read out a message at `callMinuteOut`. Each is charged once, to the owner of the bot it was for, which comes from the call itself, never its phone numbers: a call that comes in gets a `calls` row when it's answered (its CallSid; `status = "line"` on the simpler line), and a bot's own call asks Twilio to report with the bot in the URL (`?b=`, inside Twilio's signature). A call no bot took (the phone isn't linked, the bot is paused or out of credit) and one that read out a phone code are charged to no one. A call needs credit to start (`checkSpend(…, "call")`).
- **When the voice server can't take it:** the app checks `/health` (cached) before handing a phone call over, and the stream's `<Redirect>` takes over if the server drops it or is busy: `/voice/fallback` hangs up if the call already ended there, else marks it failed and carries on with `<Gather>`. The Call button says the voice line is down.

## The bot as an MCP server

`/api/mcp/[botId]` serves the bot's tools over Streamable HTTP (stateless, JSON responses; legacy `initialize` and modern `server/discover` clients). Owners can mint a token in Settings and use their bot's apps from Claude Desktop, Claude Code or any MCP client, under the same rules.

## Scheduler

Reminders and routines are rows in `schedules` with a next-run time computed in the owner's time zone (`src/lib/scheduler/time.ts`: once, daily with weekdays, interval, cron). `/api/cron/tick` (Vercel Cron, every minute) or the in-process ticker (`src/instrumentation.ts`, self-hosted) runs due ones through `runTurn` and delivers results.

## Billing

There are no plans: people pay for what they use, at cost (`docs/DECISIONS.md`).

- **Prices** (`src/lib/billing/prices.ts`, safe for the browser): what each service charges us, with nothing added. Included models are charged per token at their Token Factory price (`models/catalog.ts`); lookups, texts, calls and cloud-browser tasks have per-use prices. The pricing page, Credit & usage and the builder all read the same numbers.
- **Credit** (`src/lib/billing/credit.ts`): balance = starter credit (`STARTER_CREDIT_USD`) + the `credits` table (top-ups, demo credit, refunds) − `usage.cost_micros` (what everything cost, recorded as it happens, in millionths of a dollar).
- **Before anything that costs money**, `checkSpend` (`usage.ts`) checks for credit: a turn on an included model, a lookup, a text or call (`channels/outbound.ts`), a cloud-browser task, a recording heard on our server, voice typing's AI cleanup, editing by voice, meeting notes on an included model. Your own AI has a monthly fair-use limit instead, and an account without a confirmed email gets 5 included messages. Fair use also caps bots (10), apps and routines (200 per bot).
- **Adding credit** (`stripe.ts`): a one-time Stripe Checkout payment of $5, $10 or $20 with Stripe's fee on top (`topUpChargeCents`). The webhook (`checkout.session.completed`, `checkout.session.async_payment_succeeded`) adds the credit once per session (a unique index on the session id). In demo mode, `/api/billing/demo` adds it without paying.

## Demo mode

`DEMO_MODE=1` (default outside production) simulates whatever isn't configured:
- **A scripted brain** (`src/lib/llm/demo.ts`) that calls the real tools, so the policy engine, approvals and receipts all run for real. It answers every job's starter ideas, and does its time math on the owner's clock.
- **Simulated apps and channels** with sample data: an inbox with a phishing email, a week of calendar, a few PRs.
- **A scripted meeting** and **sample dictations** for a recording sent to the server, only when you run it yourself (or tests, `DEMO_SPEECH=1`; the pill says *demo*). A deployed site never makes up speech: without a speech-to-text key, a recording isn't turned into text there, and meeting notes and voice typing work with what the desktop app hears on the computer.
- **Free credit:** Add $5, $10 or $20 in Credit & usage, without paying.

Every flow in the product can be tried with zero keys when you run it yourself, and nothing real is sent or charged. `docs/TRY-IT.md` walks through it.

## Testing

- `npm test`: the policy engine, scheduler math, the receipts trigger, and the full agent pipeline on in-memory Postgres (greeting, STOP/START, reminders, phishing detection, the injection guard under Full faith, approvals, Look only, strangers can't drive the bot, append-only receipts), and meeting notes end to end (chunks → transcript → notes → tools, device tokens, out of credit, stale recordings, notes on the owner's computer, a transcript that tries to make the bot email a stranger), and memory (which memories each brain size gets in a real turn, Bring my memories against a stand-in model and line by line, remember/recall/forget, the pin cap), and voice typing (the text rules on real-world transcripts, the pipeline against a fake Groq: prompts, guards, the AI cleanup's checks and timeouts, snippets, commands, limits; the routes and the dictionary).
- `npm run test:e2e` (after `npm run build`; it starts `next start` on port 3100 with its own database), on a phone and a desktop:
  - the builder to a live chat, an approval and STOP;
  - Bring my memories: paste, untick, save, pin;
  - a ready-made tutor: one tap in the builder, its first question, then back to a general assistant in Settings;
  - meeting notes on the web: the Meetings tab sends you to the desktop app and the website can't record; a meeting a paired app heard shows its lines live, is stopped from the website, and gets its notes, which can be ticked, searched and deleted;
  - voice typing's web side: the page sends you to the desktop app and the website doesn't listen, a request by voice from a paired app shows in the chat with its selection, a dictionary word that's then used (voice typing itself is tested in the desktop app's own e2e);
  - every page loads;
  - axe accessibility scans in light and dark.
- **On real Postgres.** Supabase runs the server through postgres.js and a transaction pooler, which are stricter than the in-memory database the tests use. Check database changes on a real one too: a local Postgres with pgbouncer in front in `pool_mode = transaction` on port 6543, like Supabase's pooler (port 6543 also makes the client skip prepared statements).
  - `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:6543/bab_test npx vitest run tests/postgres.test.ts` wipes that database and covers sign-in, rate limits, the admin numbers and the cron tick.
  - `DATABASE_URL=postgres://postgres@127.0.0.1:6543/bab_e2e ENCRYPTION_KEY=$(openssl rand -base64 32) npm run test:e2e` runs the whole e2e suite there.
- `tests/calls.test.ts`: calls end to end through the routes: call tokens and signatures that match the voice server's, who's calling from each kind of caller ID, greetings, a whole call in the app (session, act, turn, end, the bill and the chat card), the phone PIN and its lockout, the TwiML that hands a phone call to the voice server, the fallback, and billing for streamed and simpler-line calls.
- `tests/study-checks.test.ts`: the tutor's Tavily checks on a fake Tavily: finding a course (the searches, the note), checking claims (one search each, the course's sites preferred, homework sites left out, only the claims sent), lookups charged and counted against the daily ceiling, and sources on cards limited to pages the bot looked at.
- `tests/phone-shared-number.test.ts`: two owners on the shared number, linked the way the app links them: each reaches their own bot whoever linked first, a phone that isn't linked hears how to link it, calls off says so, several bots go to the one used last, a bot's own number still answers anyone, texts route the same way, and each call is charged once to the right owner (a bot's own calls too, through a link Twilio signs).
- `cd voice && npm test`: the voice server on fakes: μ-law, resampling and text made speakable; the turn detector; the sidecar protocol; the talker's stream, prompt and tools for each kind of caller; whole calls through the session (early guesses dropped or released, barge-in with what was actually heard, fillers, slow work and its follow-up, goodbyes, the PIN said or typed, noise, nobody there); the server over real WebSockets (browser calls, a Twilio Media Streams call, bad tokens and origins, a full line). CI's real-models job builds NVIDIA's engine and runs whole calls on the real Parakeet, Magpie and Silero.
- `cd desktop && npm test`: call detection on each OS (parsers on captured-style output), the call state machine, the controller's safety rules, the upload queue, placement, token storage, and voice typing's shortcut machine, paste and clipboard restore, app categories, history and controller, and Private speech against a stand-in runtime (download, resume, hashes, the key, idle stop, crashes, falling back), and meetings heard on the computer (timed words into lines, pieces that wait for Parakeet, dictations first, notes only once every piece is in).
- `cd desktop && npm run test:e2e`: the real Electron app under Xvfb against a running dev server: pair, a fake call, ask, take notes, pause, stop, notes ready, stop and delete, and the mic-only path; then voice typing with real X key presses: hold, talk, the cleaned-up text pasted into another app with the clipboard put back, hands-free, Esc, and "Hey Otto". With NVIDIA's files and two spoken sentences at hand (`BAB_E2E_SPEECH_*`), `e2e/local-speech.e2e.mjs` also downloads and runs the real Parakeet on the computer and types what was said.
