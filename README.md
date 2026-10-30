# Build-a-bot

Make your own AI assistant in about a minute: pick a face, give it a name, choose its brain (NVIDIA Nemotron and other open models on Nebius, or your own API key), give it your apps, and decide how much it can do on its own. Then chat with it on the web, Discord or Slack, or just call it: it answers in its own voice and gets things done while you talk. Its desktop app takes notes in your meetings and types for you by voice in any app.

- **Live site:** [build-a-bot.site](https://build-a-bot.site). Free to try: every account starts with $5 of credit, no card needed.
- **Demo video (2:56):** [youtu.be/pamiWbqzm_s](https://youtu.be/pamiWbqzm_s)
- **Desktop app** for Mac and Windows: [build-a-bot.site/download](https://build-a-bot.site/download)
- **Judges:** [`docs/HACKATHON.md`](docs/HACKATHON.md) has the testing steps, and what's real on the site. Build-a-bot is our entry in the Nebius × NVIDIA Global AI Hackathon.

## Try it

On [build-a-bot.site](https://build-a-bot.site), with nothing to install:

1. **Build a bot:** click **Build your bot** (no account needed), or start from a recipe. Pick a face and a name, keep Nemotron 3.5 Lightning as the brain, add a couple of apps, and finish.
2. **Chat with it:** the first five messages are free. Then sign in with your email (a link, no password), and your $5 of starter credit comes with it, no card needed.
3. **Call it:** click **Call** in the bot's header and allow the microphone. NVIDIA Parakeet hears you, NVIDIA Magpie answers, and you can cut in anytime.
4. **Voice typing and meeting notes** are in the desktop app for Mac and Windows: get it from [build-a-bot.site/download](https://build-a-bot.site/download), and pair it from the site's **Desktop app** page.

Step by step, with what to ask it: [`docs/HACKATHON.md`](docs/HACKATHON.md#for-the-judges-testing-instructions).

## Built on NVIDIA and Nebius

- **The brains:** NVIDIA Nemotron on **Nebius Token Factory**. Nemotron 3.5 Lightning is every new bot's default: fast, and cheap (about $0.0004 for a typical message, at Token Factory's price). Nemotron 3 Super and Nemotron 3 Ultra take the harder jobs. Token Factory also runs the other included open models, and the AI cleanup for voice typing. Zero data retention is on: Token Factory keeps none of the included models' prompts or replies.
- **The ears:** NVIDIA **Parakeet TDT 0.6B v3** turns speech into text on the user's own computer, for voice typing and meeting notes. The desktop app runs it on NVIDIA's NeMo-Speech.cpp, so the audio stays on the computer. An optional speech server (`speech/`: Parakeet and **Nemotron 3.5 ASR**, built to deploy as a **Nebius Serverless AI** endpoint) covers computers that can't run Parakeet; build-a-bot.site doesn't run one.
- **The voice:** on calls, NVIDIA **Magpie TTS Multilingual** speaks and Parakeet hears, on NeMo-Speech.cpp on our own server (`voice/`), while Nemotron 3.5 Lightning holds the conversation and hands the work to the bot.
- **Web search and fact checks:** Tavily. Bots search and read the web with it, and the tutor checks its flashcards and quizzes against the student's course: the course's own pages first, then open textbooks (`src/lib/tools/builtin/check.ts`).

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

Recipes fill it in (`/build?recipe=inbox-zero`, or any shared `/r/[slug]`). The account comes later: a bot works right away, and signing in with your email keeps it.

**Or start with a ready-made bot:** a Tutor, a Job applier, a Language partner or a Fitness coach. One tap fills in every step. Each one works the way its role should, and its first message asks what it needs to know: what you're learning and why, or the job you want and your résumé.

### Brains

- **Included open models** on Nebius Token Factory: Nemotron 3.5 Lightning by default, plus Qwen, gpt-oss, DeepSeek, GLM, MiniMax, Kimi and Hermes, each at Token Factory's price.
- **Your own key:** Anthropic, OpenAI, Gemini, OpenRouter, Groq, Mistral, xAI, DeepSeek, Together, Fireworks, Cerebras, or any OpenAI-compatible endpoint. Checked live, then encrypted.

### Apps

- A searchable catalog of ~190 apps (110+ connectable today): Gmail, Outlook, Google Calendar/Drive/Docs/Sheets, GitHub, GitLab, Notion, Slack, Linear, Jira, Todoist, Spotify, Stripe and more.
- Connected through official MCP servers (OAuth 2.1), Composio, or any MCP URL.
- Built-ins need no sign-in. Every bot has web search, the page reader, memory, reminders, weather, math and its files; notes, its own inbox and meeting notes can be added.

### Trust

- Four levels: **Look only**, **Ask me first** (the default), **Trusted helper**, **Full faith**. A policy engine enforces them in code, with per-app permissions (allow / ask / off).
- Hard limits apply even under Full faith:
  - a prompt-injection guard;
  - no secrets out;
  - money off unless a monthly cap is set;
  - bulk deletes and sensitive apps (money, health, identity) ask;
  - quiet hours;
  - it says it's an AI when it writes to other people;
  - it only listens to a meeting after you say yes, and only while you can see it's listening: on screen, or as the app icon's recording badge when you hide it for a screen share.
- STOP works from any channel, and every action gets an append-only receipt.

### Channels, several at once

Web chat, phone calls, Discord (`/ask`) and Slack (one click, or the bot's own app). Texts (Twilio) and email (the bot's own address) are built too; on build-a-bot.site they wait for carrier registration and a mail domain. Telegram, WhatsApp and iMessage are on a waitlist (Telegram's code is here, switched off).

### Calls

- **Call your bot:** the **Call** button in its header, or its phone number. It answers in its own voice, usually about 3 seconds after you stop talking (the call panel shows each answer's time), and you talk like you would to a person: cut in whenever you like and it stops mid-word.
- **It does the work while you talk:** "what's on my calendar tomorrow?", "move the three o'clock to Friday and tell Sam". The bot's own agent does it, with your apps, its memory and the same approvals as the chat: anything risky waits for your tap in the app, and the bot says so. Slow jobs keep going after the bot says "one sec", and it tells you when they're done.
- **It knows who's calling:** you on the app, or on your own phone when your carrier vouches for the number. Otherwise it asks for your phone PIN (Account → Phone PIN), which the AI never sees. Anyone else can leave a message, and the bot does nothing for them.
- **Heard and spoken by NVIDIA's open models on our own server:** Parakeet hears, Magpie speaks, Nemotron 3.5 Lightning talks (`voice/`). The audio isn't kept; the transcript lands in the chat. Calls cost what they cost us: the talker's tokens, plus Twilio's minute on a phone.

### Meeting notes

- **In the desktop app** (`desktop/`), like Granola: no bot joins the call. It notices when a call starts in Zoom, Meet, Teams, Webex, Slack, Discord and more. The bot peeks up from the very bottom of the screen: "Want me to take notes?" For a meeting in the room, *Take notes in the room* is in the app's menu.
- While it listens it stays there with a red dot, a timer, a level meter and live captions. Pause, Stop and "Stop and delete" are one click away.
- **Heard on your computer:** NVIDIA Parakeet turns the call into text on the computer, about 20 seconds at a time, and only the lines are sent. On build-a-bot.site the audio never leaves the computer.
- Afterwards it writes a summary, decisions and action items, sends them to you, and answers questions about past meetings ("What did we decide?").
- The **Meetings** tab on the website has the meetings and their notes (search, action items to tick off, export). The website itself never records.
- It never records without a yes, only listens while you can see it's listening, and throws each piece of audio away once it's text. Transcripts are kept 90 days by default; notes stay until deleted.

### Voice typing

- **Hold a key in any app and talk** (desktop app: Right Option on a Mac, Right Ctrl on Windows and Linux). Let go, and what you meant is typed where your cursor is. Tap twice to keep talking hands-free.
- **Cleaned up:** no ums or repeats, the right punctuation, your corrections kept ("at 2, no, 3" → "at 3"), "new line" and "scratch that". Casual in chats, proper in email, exact in code.
- **Your words:** names and terms spelled your way, what speech-to-text writes instead, snippets ("my booking link" types the link), and the names your bots already remember. Fix a dictation and it learns.
- **Edit by voice:** select text, hold Shift with your key, and say what to change ("make it friendlier", "turn it into a list", "translate it to Spanish"). With nothing selected, it writes what you ask for.
- **"Hey Otto, …"** asks your bot instead of typing; it answers in a small bubble with Paste, Copy, Reply and Open chat. With Shift held, it also gets what you selected ("Hey Otto, add this to my calendar").
- **Private:** the mic is on only while you hold the key, with a pill on screen the whole time. NVIDIA Parakeet hears you on your own computer; the server gets the words to clean up and keeps a word count, not the words. History stays on your computer, encrypted.
- **Only in the desktop app**, like Wispr Flow. The site's **Voice typing** page (`/app/voice`) gets you the app, pairs it, and holds your words and snippets. Hearing you is free on your computer; the AI cleanup is paid from credit (a fraction of a cent).

### Your files, and studying from them

- **Give your bot files:** drop them on the chat, use the paperclip or paste a screenshot, add them in the bot's **Memory › Files**, or send them with Discord's `/ask`. PDFs, Word, PowerPoint (with speaker notes), text and photos, up to 25 MB each and 500 MB in all.
- **Read once, cited always:** each file is read into passages with their page or slide, and searched with Postgres full-text search. The bot says which file and page it used. Photos and scanned pages are read by a vision model on Nebius Token Factory, paid from credit.
- **Flashcards and practice quizzes** that work right in the chat: flip a card, mark *Got it* or *Again* (spaced repetition brings misses back sooner); answer a quiz one question at a time, see why, get a score, and send your mistakes back to the bot to go over. Each answer says where it's from: the file and page, or a web page the bot checked it against (only pages it really looked at). CSV export for Anki and Quizlet.
- **Private:** files live in a private store, read back only for their owner; people who message the bot can't search them; deleting a bot or the account deletes them. A file's text is outside content to the model, never instructions.

### Web actions (coming soon)

It browses sites and fills in forms in a cloud browser (Browser Use Cloud). Before anything is sent, the owner sees every field it filled and a picture of the form, and taps to send. Payment pages, card details, passwords and logins are refused in code. It's built, and switched on once Browser Use is set up for build-a-bot.site.

### It reaches out

An optional morning brief (on by default), routines and reminders, on any channel. Its face follows it into HTML emails.

### It remembers

- It keeps up to 2,000 facts about you and uses only the ones that matter for each message, so small, fast brains work as well as big ones. Pin the basics to keep them always on its mind.
- **Bring my memories:** copy one message into ChatGPT, Claude or Gemini, paste the answer back, untick anything private, save. It knows you from day one.
- Ask it to forget something and it does. You can see, edit and delete everything in the Memory tab.

### The dashboard (`/app`)

- **For each bot, six tabs:** Chat (with inline approvals and file attachments), Meetings, Memory (what it remembers, its files with their flashcards and quizzes, its notes, the people it knows), Apps & channels (trust, apps, the ways to talk), Routines, and Settings (look, personality, brain, recipes, MCP access, and Activity: every receipt).
- **For the account:** Approvals inbox, Voice typing, Desktop app (download and pairing), Credit & usage, Account (export, delete).

### The business side

- **No plans: you pay for what you use, at cost.** A message on an included model costs Token Factory's price for its tokens, a web lookup Tavily's $0.008, a text or a call Twilio's price, and a bot on your own AI key is free here. Every account starts with $5 of credit. Adding $5, $10 or $20 goes through Stripe Checkout, with Stripe's card fee on top so the credit is all yours; on build-a-bot.site it says "Coming soon" until Stripe is set up. Prices are in `src/lib/billing/prices.ts` and on `/pricing`.
- An operator dashboard (`/admin`, locked to `ADMIN_EMAILS`): credit sold against what was used, growth, usage and costs, as aggregates only.
- Shareable recipes (`/r/[slug]`). Each bot is also an MCP server, usable from Claude Desktop or Claude Code.
- A public site: landing, pricing, safety, legal drafts, explore.

## Run it on your own computer

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

Pair it from the web app: **Desktop app** → **Get a pairing code**. Real keys go in `.env.local` (see `.env.example`); anything left out stays simulated. [`docs/TRY-IT.md`](docs/TRY-IT.md) walks through everything in a local copy, and [`docs/DEPLOY.md`](docs/DEPLOY.md) says what each integration needs.

### Tests

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
cd ../voice
npm test               # the voice server: turn-taking, barge-in, fillers, the PIN, Twilio and the
                       # browser end to end on fakes (CI also runs whole calls on NVIDIA's real models)
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
  - `tools`, `connectors`, `channels`, `billing`, `scheduler`, `db`.
  - `bridge`: pairing the desktop app (device tokens). The name is from the Bridge, gone since 2026-10-20.
  - `meetings` and `transcribe`: meeting notes and speech-to-text.
  - `library`: the owner's files (storage, reading, search) and study sets.
  - `calls`: calls with a bot: who's calling, the phone PIN, call tokens, what the voice server asks the app.
  - `web-actions`: the cloud browser.
- `src/components`: the UI, including `avatar` (the five characters), `meetings` (the meetings, their notes, and the bot the desktop app shows at the bottom of the screen) and `call` (the Call button and the call itself).
- `desktop/`: the desktop app for meeting notes, voice typing and a bot's synced folder (Electron), with NVIDIA Parakeet on the computer. Its README covers permissions, building and signing.
- `speech/`: our optional speech-to-text server: NVIDIA Parakeet and Nemotron on NVIDIA NeMo-Speech.cpp, for a Nebius Serverless AI endpoint. Its README covers deploying it and what it costs.
- `voice/`: the voice server for calls: NVIDIA Parakeet and Magpie on NeMo-Speech.cpp, Silero VAD, turn-taking, Twilio Media Streams and the browser. Its README covers how it works and how fast it is; `docs/DEPLOY.md` §8 covers deploying it.
- `video/`: the promo and the demo video, rebuilt from code (`video/README.md`, `video/demo/README.md`).
- `tests/` and `e2e/`: unit and end-to-end tests.
- `docs/`:
  - `HACKATHON.md`: the judges' guide.
  - `TRY-IT.md`: running it on your own computer, and what to click.
  - `ARCHITECTURE.md`: how it works.
  - `DEPLOY.md`: how to ship it.
  - `DECISIONS.md`: decisions with Diego's own words, the ground rules, and what's still open.
  - `research/` and `research-2026-10-13.md`: the research behind it (integrations, models and costs, safety, law).
  - `history/`: the first build brief, and the hackathon submission's drafts and checklist.

## License

Apache License 2.0 (`LICENSE`). The name, brand and hosted service at build-a-bot.site are not covered by the license.
