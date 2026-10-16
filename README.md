# Build-a-bot

Anyone makes their own AI agent in about a minute: pick a face, give it a name, choose a brain (or connect the AI subscription they already pay for), give it their apps, decide how much it can do on its own, and talk to it anywhere — calls, texts, email, Telegram, Discord, Slack. It can also sit in on their calls and take the notes, and type for them by voice in any app.

- **Site:** [build-a-bot.site](https://build-a-bot.site), live on Vercel + Supabase since 2026-10-14, still in demo mode until the last keys are in (`docs/DECISIONS.md` → *Live*).
- **Status (2026-10-16):** the whole product is built (the website, the dashboard, and a desktop app for meeting notes and voice typing) and runs locally in demo mode with zero keys. Meeting notes and voice typing are only in the desktop app, which hears them on the user's own computer. `docs/DEPLOY.md` lists what each integration needs.
- **Reviewing it?** Start with [`docs/TRY-IT.md`](docs/TRY-IT.md): how to run both apps, what to click, and what's simulated.

## Built on NVIDIA and Nebius

- **The brains:** NVIDIA Nemotron on **Nebius Token Factory**. Nemotron 3.5 Lightning is every new bot's default: fast, and cheap (about $0.0004 for a typical message, at Token Factory's price). Nemotron 3 Super and Nemotron 3 Ultra take the harder jobs. Token Factory also runs the other included open models, and the AI cleanup for voice typing.
- **The ears:** NVIDIA **Parakeet TDT 0.6B v3** turns speech into text on the user's own computer, for voice typing and meeting notes. The desktop app runs it on NVIDIA's NeMo-Speech.cpp, so the audio never leaves the computer. Our own speech server (`speech/`: Parakeet and **Nemotron 3.5 ASR** on NeMo-Speech.cpp, built to deploy as a **Nebius Serverless AI** endpoint) is optional, for computers where Parakeet can't run.
- **Web search:** Tavily.
- A possible entry in the Nebius × NVIDIA Global AI Hackathon (due October 30): [`docs/HACKATHON.md`](docs/HACKATHON.md).

## Try it

```bash
npm install
npm run dev        # http://localhost:3000, demo mode: simulated brain, apps and channels
```

The desktop app, in a second terminal (needs the server above):

```bash
cd desktop
npm install
npm run dev        # pairs with http://localhost:3000
```

Pair it from the web app: **Bridge (your computer)** → **Desktop app**. Real keys go in `.env.local` (see `.env.example`); anything left out stays simulated.

## What it does

### Making a bot (`/build`, no account needed)

Seven steps, with a live preview that assembles the bot as you go:

1. **Face:** five original characters (Blip the robot, Nimbus the cloud, Sprout the seedling, Ember the spark, Otto the octopus) in 8 colorways, each with its own personality.
2. **Name** ("Surprise me" helps).
3. **Brain** (below).
4. **Apps:** first "what should it help with?" (inbox, reminders, research, errands, meetings…), which brings the right built-ins along, then anything from the catalog.
5. **Trust:** how much it does on its own.
6. **Talk:** where you'll reach it, several channels at once.
7. **Go:** a review, then the bot greets you first.

Recipes prefill it (`/build?recipe=inbox-zero`, or any shared `/r/[slug]`). The account comes later: a bot works right away, and "Save your account" (a magic link) keeps it.

**Or start with a ready-made bot:** a Tutor, a Job applier, a Language partner, a Fitness coach or a Meal planner. One tap fills in every step. Each one works the way its role should, and its first message asks what it needs to know: what you're learning and why, or the job you want and your résumé.

### Brains

- **Included open models** on Nebius Token Factory: Nemotron 3.5 Lightning by default, plus Qwen, gpt-oss, DeepSeek, GLM, MiniMax, Kimi and Hermes, each at Token Factory's price.
- **The owner's own key:** Anthropic, OpenAI, Gemini, OpenRouter, Groq, Mistral, xAI, DeepSeek, Together, Fireworks, Cerebras, or any OpenAI-compatible endpoint. Checked live, then encrypted.
- **Their Claude or ChatGPT subscription, through the Bridge** (`bridge/`): a small program on their own computer that runs their own `claude -p` or `codex exec`, signed in by them, with only the bot's tools. We never see the login. While the computer sleeps the bot waits, unless the owner opts in to fall back to the included model.

### Apps

- A searchable catalog of ~190 apps (110+ connectable today): Gmail, Outlook, Google Calendar/Drive/Docs/Sheets, GitHub, GitLab, Notion, Slack, Linear, Jira, Todoist, Spotify, Stripe and more.
- Connected through official MCP servers (OAuth 2.1), Composio, or any MCP URL.
- Built-ins need no sign-in: web search, reader, weather, reminders, notes, memory, its own inbox, meeting notes.

### Trust

- Four levels: **Look only**, **Ask me first** (the default), **Trusted helper**, **Full faith**. A policy engine enforces them in code, with per-app permissions (allow / ask / off).
- Hard limits apply even under Full faith:
  - a prompt-injection guard;
  - no secrets out;
  - money off unless a monthly cap is set;
  - bulk deletes and sensitive apps (money, health, identity) ask;
  - quiet hours;
  - it says it's an AI when it writes to other people;
  - it only listens to a meeting after you say yes, and stays on your screen the whole time.
- STOP works from any channel, and every action gets an append-only receipt.

### Channels, several at once

Web chat, phone calls and texts (Twilio), email (its own brand-free address), Telegram (a one-tap managed bot), Discord (`/ask`) and Slack (one click, or the bot's own app). WhatsApp and iMessage are on a waitlist.

### Meeting notes (beta)

- **In the desktop app** (`desktop/`), like Granola: no bot joins the call. It notices when a call starts in Zoom, Meet, Teams, Webex, Slack, Discord and more. The bot peeks up from the very bottom of the screen: "Want me to take notes?" For a meeting in the room, *Take notes in the room* is in the app's menu.
- While it listens it stays there with a red dot, a timer, a level meter and live captions. Pause, Stop and "Stop and delete" are one click away.
- **Heard on your computer:** NVIDIA Parakeet turns the call into text on the computer, about 20 seconds at a time, and only the lines are sent. The audio never leaves the computer.
- Afterwards it writes a summary, decisions and action items, sends them to you, and answers questions about past meetings ("What did we decide?").
- The **Meetings** tab on the website has the meetings and their notes (search, action items to tick off, export), and gets you the app. The website itself never records.
- Until signed downloads are published (`NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL`), a real server shows the desktop app as "Coming soon"; demo mode shows how to run it from this repo.
- It never records without a yes, only listens while it's on screen, and throws each piece of audio away once it's text. Transcripts are kept 90 days by default; notes stay until deleted.

### Voice typing (beta)

- **Hold a key in any app and talk** (desktop app: Right Option on a Mac, Ctrl + Windows on Windows, Right Ctrl on Linux). Let go, and what you meant is typed where your cursor is. Tap twice to keep talking hands-free.
- **Cleaned up:** no ums or repeats, the right punctuation, your corrections kept ("at 2, no, 3" → "at 3"), "new line" and "scratch that". Casual in chats, proper in email, exact in code.
- **Your words:** names and terms spelled your way, what speech-to-text writes instead, snippets ("my booking link" types the link), and the names your bots already remember. Fix a dictation and it learns.
- **Edit by voice:** select text, hold Shift with your key, and say what to change ("make it friendlier", "turn it into a list", "translate it to Spanish"). With nothing selected, it writes what you ask for. "Hey Otto, add this to my calendar" sends your bot what you selected, treated as outside content so it asks before sending anything to someone new.
- **"Hey Otto, …"** asks your bot instead of typing; it answers in a small bubble with Paste, Copy, Reply and Open chat.
- **Private:** the mic is on only while you hold the key, with a pill on screen the whole time. NVIDIA Parakeet hears you on your own computer, so the audio never leaves it; the server gets the words to clean up and keeps a word count, not the words. History stays on your computer, encrypted.
- **In the desktop app**, like Wispr Flow: the website doesn't listen. The **Voice typing** page (`/app/voice`) gets you the app, pairs it, and holds your words and snippets. No word limit: hearing you is free on your computer, and the AI cleanup is paid from credit (a fraction of a cent).

### Web actions (beta)

It browses sites and fills in forms in a cloud browser (Browser Use Cloud). Before anything is sent, the owner sees every field it filled and a picture of the form, and taps to send. Payment pages, card details, passwords and logins are refused in code.

### It reaches out

An optional morning brief (on by default), routines and reminders, on any channel. Its face follows it: Telegram profile photo, HTML emails.

### It remembers

- It keeps up to 2,000 facts about you and uses only the ones that matter for each message, so small, fast brains work as well as big ones. Pin the basics to keep them always on its mind.
- **Bring my memories:** copy one message into ChatGPT, Claude or Gemini, paste the answer back, untick anything private, save. It knows you from day one.
- Ask it to forget something and it does. You can see, edit and delete everything in the Memory tab.

### The dashboard (`/app`)

- **For each bot:** Chat with inline approvals, Meetings, Activity (receipts), Apps & trust, Channels, Routines, Memory, Settings (look, personality, brain, recipes, MCP access).
- **For the account:** Approvals inbox, Voice typing, Bridge (your computer, including the desktop app), Credit & usage, Account (export, delete).

### The business side

- **No plans: people pay for what they use, at cost** (Diego, 2026-10-16). A message on an included model costs Token Factory's price for its tokens, a web lookup Tavily's $0.008, a text or a call Twilio's price, and a bot on your own AI key or subscription is free here. Every account starts with $1 of credit; adding $5, $10 or $20 goes through Stripe Checkout, with Stripe's card fee on top so the credit is all yours. Prices are in `src/lib/billing/prices.ts`, on `/pricing` and in `docs/DECISIONS.md`. In demo mode, credit is added without paying; on a real server without Stripe, adding credit says "Coming soon".
- An operator dashboard (`/admin`, locked to `ADMIN_EMAILS`): credit sold against what was used (are we breaking even?), growth, usage and costs, as aggregates only.
- Shareable recipes (`/r/[slug]`). Each bot is also an MCP server, usable from Claude Desktop or Claude Code.
- A public site: landing, pricing, safety, legal drafts, explore.

## How it's checked

```bash
npm run typecheck
npm test               # Vitest: policy engine, scheduler, database, agent pipeline,
                       # web actions, meetings, speech-to-text
npm run build
npm run test:e2e       # Playwright on a phone and a desktop: builder → chat → approval → STOP,
                       # meetings, every page loads, axe accessibility scans (light and dark)
cd desktop
npm test               # detection on each OS, the call state machine, the safety rules, uploads,
                       # hearing on the computer, voice typing
npm run test:e2e       # the real Electron app against the dev server (Linux, under xvfb)
cd ../speech
npm test               # the speech server: auth, audio formats, language routing, limits, the log
```

axe finds no serious WCAG 2.2 AA problems on the main public and dashboard pages, in light or dark mode.

## Where things are

- `src/app`: pages and API routes.
  - `(marketing)`: the public site.
  - `build`: the builder.
  - `app`: the dashboard.
  - `admin`: the operator dashboard.
  - `desktop/buddy`: the bot the desktop app shows.
  - `api`: the API routes.
- `src/lib`: the engine.
  - `agent`: runs a turn.
  - `policy`: trust.
  - `tools`, `connectors`, `channels`, `bridge`, `billing`, `scheduler`, `db`.
  - `meetings` and `transcribe`: meeting notes and speech-to-text.
  - `web-actions`: the cloud browser.
- `src/components`: the UI, including `avatar` (the five characters) and `meetings` (the meetings, their notes, and the bot the desktop app shows at the bottom of the screen).
- `desktop/`: the desktop app for meeting notes and voice typing (Electron), with NVIDIA Parakeet on the computer. Its README covers permissions, building and signing.
- `speech/`: our optional speech-to-text server: NVIDIA Parakeet and Nemotron on NVIDIA NeMo-Speech.cpp, for a Nebius Serverless AI endpoint. Its README covers deploying it and what it costs.
- `bridge/`: the Bridge, which runs a subscription brain on the owner's computer.
- `tests/` and `e2e/`: unit and end-to-end tests.
- `docs/`:
  - `TRY-IT.md`: the review guide.
  - `ARCHITECTURE.md`: how it works.
  - `DEPLOY.md`: how to ship it.
  - `DECISIONS.md`: decisions, gotchas and open questions.
  - `research/`: integrations, MCP and brains, connectors, web actions, meetings (2026-10-14).
  - `research-2026-10-13.md`: market, channels, models and costs, safety, law, name, and sources.
- `BUILD.md`: the first build brief. Its rules still apply.

## Decisions so far

The full notes, with Diego's own words, are in `docs/DECISIONS.md`.

**Diego, 2026-10-13**

- **Separate from Cookbook at first:** its own brand and site. When people want their bots to talk to each other, that happens in Cookbook.
- **Reuse the hackathon stack:** Nebius Token Factory for open-weight models, Tavily for web search.
- **Bots act on the web:** they need to fill things out online.
- **Dead-simple setup:** choose an avatar from a small set, a name, and a model, or connect a subscription you already pay for. It must look clean and modern and be easy enough for anyone.
- **Keep the name** Build-a-bot.
- **The user picks the model.** Don't apply for Sign in with ChatGPT yet. Subscriptions run the way Cookbook's Bridge does: the user's own CLI, signed in by them.

**Diego, 2026-10-14**

- **Build the whole product now, end to end:** five cute avatars, a name, a brain (their subscription or an open-weight model on Nebius), apps from an extensive list, how much to trust it (including full faith), and several ways to talk to it.
- **Meeting notes** (an idea from his mom): the bot notices a meeting, pops up to ask, and stays visible at the very bottom of the screen while it transcribes.
- **Consent:** "It's one party consent. So as long as one person hits record, we're good." It still asks first and stays visible.
- **Apple:** he already has an Apple Developer account, for signing the Mac app.

**Claude's build choices, for Diego to confirm:**

- the four trust levels and the hard limits;
- the pricing table (replaced on 2026-10-16: pay for usage, at cost);
- the morning brief, on by default;
- web actions on Browser Use Cloud, with Stagehand + Browserbase as the fallback;
- the meeting-notes safety rules.

"Cookbook on the inside" is still only a proposal: every bot would be a Cookbook agent under the hood, so bots talking to each other means one shared room. v1 is a standalone app with its own Postgres.

## Still open

The current list is in `docs/DECISIONS.md`.

1. **First users:** tinkerers or everyday iPhone users? A 3-week hand-built test with 5 non-developers could decide.
2. **Pricing:** pay for usage at cost is decided (2026-10-16). Open: the starter credit ($1), refunding unused credit by hand when asked, and when, if ever, to add a margin.
3. **Web actions:** confirm Browser Use Cloud, then test with a live key on about 10 real forms before turning it on for everyone.
4. **Before launch:** a brand-free domain for bot inboxes, Twilio A2P 10DLC registration, and a Composio plan. The Bridge needs nothing on npm: the site serves its own copy.
5. **Trademark clearance** before spending on the brand.
6. **Meeting notes and voice typing before launch:**
   - a lawyer's look at the consent flow and retention;
   - signed downloads, since both are only in the app: signing and notarizing the Mac app (a Developer ID certificate and notarization credentials in CI secrets, built on a Mac or a macOS runner), and signing the Windows installer;
   - whether the desktop app and the Bridge become one app.
7. **Meeting notes, next:** meeting titles from the calendar, telling the call's speakers apart, and languages beyond Parakeet's 25.

## Ground rules

These hold whatever gets built next.

**Subscriptions (vendor rules):**
- **ChatGPT:** allowed on the user's own computer (locally hosted). From our cloud it needs OpenAI's approval via Sign in with ChatGPT, which we are not applying for yet. Never put a Codex login on our servers.
- **Claude:** allowed on the user's own computer through their own Claude Code. In the cloud, only as the unmodified Claude Code in a per-user sandbox, signed in on Anthropic's own page; we never collect, store or relay the token. Max plans include $100–200/mo of API credit usable through an API key.
- **Gemini:** API keys only.

**Keys:**
- Users' own API keys are encrypted at rest, never logged, and never sent back to the browser after entry.
- Our keys (Token Factory, Tavily and the rest) and Apple's signing credentials never go in the repo; they live in environment variables and CI secrets.

**Channels:**
- Open today: Telegram, Discord DMs, and an email address the bot owns.
- iMessage: only through gateways Apple hasn't sanctioned.
- WhatsApp: bans general-purpose assistants in the US.
- Reading someone's Gmail: needs Google's yearly CASA security audit.

**Costs:**
- **Model:** Nemotron 3.5 Lightning on Token Factory cost $0.06 per million input tokens and $0.24 per million output (checked for the hackathon). That's about $4 to $5 a month per active bot.
- **Search:** Tavily includes 1,000 free credits a month, then $0.008 per credit; it's free for students.
- **Speech-to-text:** nothing: the desktop app hears voice typing and meetings on the user's computer (NVIDIA Parakeet). The optional speech server (`speech/`), a Nebius Serverless AI endpoint, would be about $190 a month for an 8-vCPU machine, whatever the volume. Its backup: NVIDIA Parakeet on Together AI, $0.0015 per audio minute.
- **Reachability:** Token Factory, Tavily and the cloud-browser hosts all work on Diego's network. Kimi, DeepSeek and Together AI (the speech-to-text backup) are blocked there; the app calls Together from its server, so only local testing is affected.

**Name:**
- Build-A-Bear defeated a BUILD A BOT trademark application in 2004 (for toys).
- Keep the brand name out of anything a bot owns (email addresses, phone numbers, handles), so a forced rename doesn't break contacts.
- No bears or "Workshop", and nothing aimed at kids.
- Get a clearance check before spending on the brand. The Texas A&M Law Trademark Clinic (tmc-info@law.tamu.edu) is in the USPTO's free clinic program.

**Law:**
- Say it's an AI, publish a crisis protocol, and launch 18+ only.
- Meeting notes ask first and stay visible. The caveats to one-party consent are in `docs/research/meetings-2026-10-14.md` §5.

## Prior work

These live in the Cookbook (dev) workspace:
- the same research file;
- the "Text your agents" doc (2026-10-01);
- Chef / cookbook-dispatch, from the hackathon;
- the DP jr. setup notes.
