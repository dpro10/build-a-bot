# Build-a-bot

Anyone makes their own AI agent in about a minute: pick a face, give it a name, choose a brain (or connect the AI subscription they already pay for), give it their apps, decide how much it can do on its own, and talk to it anywhere — calls, texts, email, Telegram, Discord, Slack. It can also sit in on their calls and take the notes, and type for them by voice in any app.

- **Site:** [build-a-bot.site](https://build-a-bot.site), live on Vercel + Supabase since 2026-10-14, still in demo mode until the last keys are in (`docs/DECISIONS.md` → *Live*).
- **Status (2026-10-15):** the whole product is built (the website, the dashboard, and a desktop app for meeting notes and voice typing) and runs locally in demo mode with zero keys. `docs/DEPLOY.md` lists what each integration needs.
- **Reviewing it?** Start with [`docs/TRY-IT.md`](docs/TRY-IT.md): how to run both apps, what to click, and what's simulated.

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

- **Included open models** on Nebius Token Factory: Nemotron 3.5 Lightning by default, plus Qwen, gpt-oss, DeepSeek, GLM, MiniMax, Kimi and Hermes by plan.
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

- The desktop app (`desktop/`) notices when a call starts in Zoom, Meet, Teams, Webex, Slack, Discord and more. The bot peeks up from the very bottom of the screen: "Want me to take notes?"
- While it listens it stays there with a red dot, a timer, a level meter and live captions. Pause, Stop and "Stop and delete" are one click away.
- Afterwards it writes a summary, decisions and action items, sends them to you, and answers questions about past meetings ("What did we decide?").
- The Meetings tab does the same in Chrome or Edge, with the bot in a floating window.
- Until signed downloads are published (`NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL`), a real server shows the desktop app as "Coming soon"; demo mode shows how to run it from this repo.
- It never records without a yes, only listens while it's on screen, and throws the audio away once it's text. Transcripts are kept 90 days by default; notes stay until deleted.

### Voice typing (beta)

- **Hold a key in any app and talk** (desktop app: Right Option on a Mac, Ctrl + Windows on Windows, Right Ctrl on Linux). Let go, and what you meant is typed where your cursor is. Tap twice to keep talking hands-free.
- **Cleaned up:** no ums or repeats, the right punctuation, your corrections kept ("at 2, no, 3" → "at 3"), "new line" and "scratch that". Casual in chats, proper in email, exact in code.
- **Your words:** names and terms spelled your way, what speech-to-text writes instead, snippets ("my booking link" types the link), and the names your bots already remember. Fix a dictation and it learns.
- **Edit by voice:** select text, hold Shift with your key, and say what to change ("make it friendlier", "turn it into a list", "translate it to Spanish"). With nothing selected, it writes what you ask for. "Hey Otto, add this to my calendar" sends your bot what you selected, treated as outside content so it asks before sending anything to someone new.
- **"Hey Otto, …"** asks your bot instead of typing; it answers in a small bubble with Paste, Copy, Reply and Open chat.
- **Private:** the mic is on only while you hold the key, with a pill on screen the whole time; the audio is turned into text and thrown away, and the server keeps a word count, not the words. History stays on your computer, encrypted.
- The **Voice typing** page (`/app/voice`) does it in the browser, and holds your words and snippets. Free: 8,000 words a month; Plus and Pro: unlimited.

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
- **For the account:** Approvals inbox, Voice typing, Bridge (your computer, including the desktop app), Plan & usage, Account (export, delete).

### The business side

- Plans and billing with Stripe: Free, Plus ($12/mo) and Pro ($39/mo). The full table is in `docs/DECISIONS.md`. In demo mode, plans switch without paying; on a real server without Stripe, Plus and Pro say "Coming soon" and offer a waitlist.
- An operator dashboard (`/admin`, locked to `ADMIN_EMAILS`): revenue, growth, usage and costs, as aggregates only.
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
npm test               # detection on each OS, the call state machine, the safety rules, uploads
npm run test:e2e       # the real Electron app against the dev server (Linux, under xvfb)
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
- `src/components`: the UI, including `avatar` (the five characters) and `meetings` (the recorder and the bot at the bottom of the screen).
- `desktop/`: the desktop app for meeting notes (Electron). Its README covers permissions, building and signing.
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
- the pricing table;
- the morning brief, on by default;
- web actions on Browser Use Cloud, with Stagehand + Browserbase as the fallback;
- the meeting-notes safety rules.

"Cookbook on the inside" is still only a proposal: every bot would be a Cookbook agent under the hood, so bots talking to each other means one shared room. v1 is a standalone app with its own Postgres.

## Still open

The current list is in `docs/DECISIONS.md`.

1. **First users:** tinkerers or everyday iPhone users? A 3-week hand-built test with 5 non-developers could decide.
2. **Pricing:** confirm the table. Is Full faith a paid feature?
3. **Web actions:** confirm Browser Use Cloud, then test with a live key on about 10 real forms before turning it on for everyone.
4. **Before launch:** a brand-free domain for bot inboxes, Twilio A2P 10DLC registration, and a Composio plan. The Bridge needs nothing on npm: the site serves its own copy.
5. **Trademark clearance** before spending on the brand.
6. **Meeting notes before launch:**
   - a lawyer's look at the consent flow and retention;
   - Groq's paid tier;
   - signing and notarizing the Mac app (a Developer ID certificate and notarization credentials in CI secrets, built on a Mac or a macOS runner);
   - whether the desktop app and the Bridge become one app.
7. **Meeting notes, next:** transcription on the owner's own key or on the device, and meeting titles from the calendar.

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
- **Speech-to-text:** Groq's Whisper large-v3 turbo, about $0.04 per audio hour.
- **Reachability:** Token Factory, Tavily and the cloud-browser hosts all work on Diego's network. Kimi, DeepSeek and Together AI (the speech-to-text fallback) are blocked there.

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
