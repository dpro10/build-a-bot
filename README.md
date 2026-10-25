# Build-a-bot

Anyone makes their own AI agent in about a minute: pick a face, give it a name, choose a brain (an open model we include, or their own API key), give it their apps, decide how much it can do on its own, and talk to it anywhere — calls, texts, email, Discord, Slack. Call it, from the app or a phone, and it answers in its own voice and gets things done while you talk. It can also sit in on their calls and take the notes, and type for them by voice in any app.

- **Site:** [build-a-bot.site](https://build-a-bot.site), live on Vercel + Supabase since 2026-10-14, for real (no demo mode) since 2026-10-21. What's real there and what's still coming: [`docs/HACKATHON.md`](docs/HACKATHON.md#whats-real-on-build-a-botsite).
- **Status (2026-10-17):** the whole product is built (the website, the dashboard, and a desktop app for meeting notes, voice typing and a bot's synced folder) and runs locally in demo mode with zero keys. Meeting notes and voice typing are only in the desktop app, which hears them on the user's own computer. Calls with a bot run on our voice server (`voice/`), live since 2026-10-17 with a real test call after every deploy, and phones reach bots through Twilio. The repository is public under Apache 2.0, and the desktop app downloads from build-a-bot.site/download: the Mac app signed with Developer ID and notarized, the Windows installer signed with Azure Artifact Signing (`docs/DEPLOY.md` §9). `docs/DEPLOY.md` lists what each integration needs.
- **Reviewing it?** Judges: [`docs/HACKATHON.md`](docs/HACKATHON.md) has the testing steps for the live site. To run it yourself, [`docs/TRY-IT.md`](docs/TRY-IT.md) says how to run both apps, what to click, and what's simulated in a local copy.

## Built on NVIDIA and Nebius

- **The brains:** NVIDIA Nemotron on **Nebius Token Factory**. Nemotron 3.5 Lightning is every new bot's default: fast, and cheap (about $0.0004 for a typical message, at Token Factory's price). Nemotron 3 Super and Nemotron 3 Ultra take the harder jobs. Token Factory also runs the other included open models, and the AI cleanup for voice typing.
- **The ears:** NVIDIA **Parakeet TDT 0.6B v3** turns speech into text on the user's own computer, for voice typing and meeting notes. The desktop app runs it on NVIDIA's NeMo-Speech.cpp, so the audio stays on the computer. Our own speech server (`speech/`: Parakeet and **Nemotron 3.5 ASR** on NeMo-Speech.cpp, built to deploy as a **Nebius Serverless AI** endpoint) is optional, for computers where Parakeet can't run; only a site that has one (or another speech-to-text service) ever gets audio, and the site's copy says which it is.
- **The voice:** on calls, NVIDIA **Magpie TTS Multilingual** speaks and Parakeet hears, on NeMo-Speech.cpp on our own server (`voice/`), while Nemotron 3.5 Lightning holds the conversation and hands the work to the bot. No speech API hears anyone.
- **Web search and fact checks:** Tavily. Bots search and read the web with it, and the tutor checks its flashcards and quizzes against the student's course: the course's own pages first, then open textbooks (`src/lib/tools/builtin/check.ts`).
- Our entry in the Nebius × NVIDIA Global AI Hackathon (due October 30): [`docs/HACKATHON.md`](docs/HACKATHON.md).

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

Pair it from the web app: **Desktop app** → **Get a pairing code**. Real keys go in `.env.local` (see `.env.example`); anything left out stays simulated.

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

**Or start with a ready-made bot:** a Tutor, a Job applier, a Language partner or a Fitness coach. One tap fills in every step. Each one works the way its role should, and its first message asks what it needs to know: what you're learning and why, or the job you want and your résumé.

### Brains

- **Included open models** on Nebius Token Factory: Nemotron 3.5 Lightning by default, plus Qwen, gpt-oss, DeepSeek, GLM, MiniMax, Kimi and Hermes, each at Token Factory's price.
- **The owner's own key:** Anthropic, OpenAI, Gemini, OpenRouter, Groq, Mistral, xAI, DeepSeek, Together, Fireworks, Cerebras, or any OpenAI-compatible endpoint. Checked live, then encrypted.
- **Not a Claude or ChatGPT chat plan** (removed on 2026-10-20, `docs/DECISIONS.md`). It ran on the owner's computer through the Bridge, so a bot on one couldn't think while that computer slept, and consumer plans don't offer zero data retention. An API key from the same company works instead.

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

Web chat, phone calls and texts (Twilio), email (its own brand-free address), Discord (`/ask`) and Slack (one click, or the bot's own app). On build-a-bot.site, texts wait for carrier registration (A2P) and email for a mail domain. Telegram, WhatsApp and iMessage are on a waitlist. Telegram's code is all here (a managed bot, or your own from BotFather), switched off in the channel catalog.

### Calls

- **Call your bot:** the **Call** button in its header, or its phone number. It answers in its own voice, usually about 3 seconds after you stop talking (the call panel shows each answer's time), and you talk like you would to a person: cut in whenever you like and it stops mid-word.
- **It does the work while you talk:** "what's on my calendar tomorrow?", "move the three o'clock to Friday and tell Sam". The bot's own agent does it, with your apps, its memory and the same approvals as the chat: anything risky waits for your tap in the app, and the bot says so. Slow jobs keep going after the bot says "one sec", and it tells you when they're done.
- **It knows who's calling:** you on the app, or on your own phone when your carrier vouches for the number. Otherwise it asks for your phone PIN (Account → Phone PIN), which the AI never sees. Anyone else can leave a message, and the bot does nothing for them.
- **Heard and spoken by NVIDIA's open models on our own server:** Parakeet hears, Magpie speaks, Nemotron 3.5 Lightning talks (`voice/`). The audio isn't kept; the transcript lands in the chat. Calls cost what they cost us: the talker's tokens, plus Twilio's minute on a phone.

### Meeting notes (beta)

- **In the desktop app** (`desktop/`), like Granola: no bot joins the call. It notices when a call starts in Zoom, Meet, Teams, Webex, Slack, Discord and more. The bot peeks up from the very bottom of the screen: "Want me to take notes?" For a meeting in the room, *Take notes in the room* is in the app's menu.
- While it listens it stays there with a red dot, a timer, a level meter and live captions. Pause, Stop and "Stop and delete" are one click away.
- **Heard on your computer:** NVIDIA Parakeet turns the call into text on the computer, about 20 seconds at a time, and only the lines are sent. The audio goes to the server only where Parakeet can't run (or with Private speech off), and only if the server has speech-to-text of its own.
- Afterwards it writes a summary, decisions and action items, sends them to you, and answers questions about past meetings ("What did we decide?").
- The **Meetings** tab on the website has the meetings and their notes (search, action items to tick off, export), and gets you the app. The website itself never records.
- The site offers the app from its own `/download` page, which lists the latest signed builds (`NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL` can point elsewhere).
- It never records without a yes, only listens while you can see it's listening, and throws each piece of audio away once it's text. Transcripts are kept 90 days by default; notes stay until deleted.

### Voice typing (beta)

- **Hold a key in any app and talk** (desktop app: Right Option on a Mac, Ctrl + Windows on Windows, Right Ctrl on Linux). Let go, and what you meant is typed where your cursor is. Tap twice to keep talking hands-free.
- **Cleaned up:** no ums or repeats, the right punctuation, your corrections kept ("at 2, no, 3" → "at 3"), "new line" and "scratch that". Casual in chats, proper in email, exact in code.
- **Your words:** names and terms spelled your way, what speech-to-text writes instead, snippets ("my booking link" types the link), and the names your bots already remember. Fix a dictation and it learns.
- **Edit by voice:** select text, hold Shift with your key, and say what to change ("make it friendlier", "turn it into a list", "translate it to Spanish"). With nothing selected, it writes what you ask for. "Hey Otto, add this to my calendar" sends your bot what you selected, treated as outside content so it asks before sending anything to someone new.
- **"Hey Otto, …"** asks your bot instead of typing; it answers in a small bubble with Paste, Copy, Reply and Open chat.
- **Private:** the mic is on only while you hold the key, with a pill on screen the whole time. NVIDIA Parakeet hears you on your own computer; the server gets the words to clean up and keeps a word count, not the words. (Audio reaches the server only if it has speech-to-text of its own, before Parakeet has downloaded or in a language it doesn't know.) History stays on your computer, encrypted.
- **In the desktop app**, like Wispr Flow: the website has no voice typing, and its chat has no microphone. The **Voice typing** page (`/app/voice`) gets you the app, pairs it, and holds your words and snippets. No word limit: hearing you is free on your computer, and the AI cleanup is paid from credit (a fraction of a cent).

### Your files, and studying from them

- **Give your bot files:** drop them on the chat, use the paperclip or paste a screenshot, add them in the bot's **Memory › Files**, or send them with Discord's `/ask`. PDFs, Word, PowerPoint (with speaker notes), text and photos, up to 25 MB each and 500 MB in all.
- **Read once, cited always:** each file is read into passages with their page or slide, and searched with Postgres full-text search. The bot says which file and page it used. Photos and scanned pages are read by a vision model on Nebius Token Factory, paid from credit.
- **Flashcards and practice quizzes** that work right in the chat: flip a card, mark *Got it* or *Again* (spaced repetition brings misses back sooner); answer a quiz one question at a time, see why, get a score, and send your mistakes back to the bot to go over. Each answer says where it's from: the file and page, or a web page the bot checked it against (only pages it really looked at). CSV export for Anki and Quizlet.
- **Private:** files live in a private store, read back only for their owner; people who message the bot can't search them; deleting a bot or the account deletes them. A file's text is outside content to the model, never instructions.

### Web actions (beta)

It browses sites and fills in forms in a cloud browser (Browser Use Cloud). Before anything is sent, the owner sees every field it filled and a picture of the form, and taps to send. Payment pages, card details, passwords and logins are refused in code.

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

- **No plans: people pay for what they use, at cost** (Diego, 2026-10-16). A message on an included model costs Token Factory's price for its tokens, a web lookup Tavily's $0.008, a text or a call Twilio's price, and a bot on your own AI key is free here. Every account starts with $5 of credit; adding $5, $10 or $20 goes through Stripe Checkout, with Stripe's card fee on top so the credit is all yours. Prices are in `src/lib/billing/prices.ts`, on `/pricing` and in `docs/DECISIONS.md`. In demo mode, credit is added without paying; on a real server without Stripe, adding credit says "Coming soon".
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
- `tests/` and `e2e/`: unit and end-to-end tests.
- `docs/`:
  - `TRY-IT.md`: the review guide.
  - `ARCHITECTURE.md`: how it works.
  - `DEPLOY.md`: how to ship it.
  - `DECISIONS.md`: decisions, gotchas and open questions.
  - `research/`: integrations, MCP and brains, connectors, web actions, meetings (2026-10-14).
  - `research-2026-10-13.md`: market, channels, models and costs, safety, law, name, and sources.
- `docs/history/first-build-brief.md`: the first build brief. Its rules from day one still apply.

## Decisions so far

The full notes, with Diego's own words, are in `docs/DECISIONS.md`.

**Diego, 2026-10-13**

- **Separate from Cookbook at first:** its own brand and site. When people want their bots to talk to each other, that happens in Cookbook.
- **Reuse the hackathon stack:** Nebius Token Factory for open-weight models, Tavily for web search.
- **Bots act on the web:** they need to fill things out online.
- **Dead-simple setup:** choose an avatar from a small set, a name, and a model, or connect a subscription you already pay for. It must look clean and modern and be easy enough for anyone.
- **Keep the name** Build-a-bot.
- **The user picks the model.** Don't apply for Sign in with ChatGPT yet. Subscriptions run the way Cookbook's Bridge does: the user's own CLI, signed in by them. (Reversed on 2026-10-20: no subscriptions, see below.)

**Diego, 2026-10-14**

- **Build the whole product now, end to end:** five cute avatars, a name, a brain (their subscription or an open-weight model on Nebius), apps from an extensive list, how much to trust it (including full faith), and several ways to talk to it.
- **Meeting notes** (an idea from his mom): the bot notices a meeting, pops up to ask, and stays visible at the very bottom of the screen while it transcribes.
- **Consent:** "It's one party consent. So as long as one person hits record, we're good." It still asks first and shows it's listening.
- **Apple:** he already has an Apple Developer account, for signing the Mac app.

**Diego, 2026-10-20**

- **No Claude or ChatGPT plans:** "it goes against a core thing for this product (ZDR) and ... you cant talk to those models if the computer is closed." Then: "yes remove it, keep the api key option." The Bridge is gone from the web app, the desktop app and the repo; bots on a plan moved to the default open model.

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
2. **Pricing:** pay for usage at cost is decided (2026-10-16). The starter credit is $5 (Diego, 2026-10-21). Open: refunding unused credit by hand when asked, and when, if ever, to add a margin.
3. **Web actions:** confirm Browser Use Cloud, then test with a live key on about 10 real forms before turning it on for everyone.
4. **Before launch:** a brand-free domain for bot inboxes, Twilio A2P 10DLC registration, and a Composio plan.
5. **Trademark clearance** before spending on the brand.
6. **Meeting notes and voice typing before launch:**
   - a lawyer's look at the consent flow and retention;
   - signed downloads, since both are only in the app: done on 2026-10-17: the Mac app is signed and notarized, the Windows installer is signed with Azure Artifact Signing, and both download from the public repository's releases.
7. **Meeting notes, next:** meeting titles from the calendar, telling the call's speakers apart, and languages beyond Parakeet's 25.
8. **Calls:** the voice server and Twilio are live (2026-10-17); texting waits on A2P 10DLC registration. Next: the bot calling you back when a job is done, a call starting your other agents (research, the cloud browser), and calls heard on your own computer.

## Ground rules

These hold whatever gets built next.

**Subscriptions:**
- **None** since 2026-10-20: bots don't think with a Claude, ChatGPT or Gemini chat plan, anywhere. Owners bring an API key instead.
- **Never** collect, store or relay a Claude or ChatGPT login, and never reuse one on our servers.

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
- **Calls:** the voice server's VM is about $124 a month (on Google Cloud's free trial credit for now), whatever the volume. A phone call adds Twilio's $0.0129 a minute (with the audio stream).
- **Speech-to-text:** nothing: the desktop app hears voice typing and meetings on the user's computer (NVIDIA Parakeet). The optional speech server (`speech/`), a Nebius Serverless AI endpoint, would be about $190 a month for an 8-vCPU machine, whatever the volume. Its backup: NVIDIA Parakeet on Together AI, $0.0015 per audio minute.
- **Reachability:** Token Factory, Tavily and the cloud-browser hosts all work on Diego's network. Kimi, DeepSeek and Together AI (the speech-to-text backup) are blocked there; the app calls Together from its server, so only local testing is affected.

**Name:**
- Build-A-Bear defeated a BUILD A BOT trademark application in 2004 (for toys).
- Keep the brand name out of anything a bot owns (email addresses, phone numbers, handles), so a forced rename doesn't break contacts.
- No bears or "Workshop", and nothing aimed at kids.
- Get a clearance check before spending on the brand. The Texas A&M Law Trademark Clinic (tmc-info@law.tamu.edu) is in the USPTO's free clinic program.

**Law:**
- Say it's an AI, publish a crisis protocol, and launch 18+ only.
- Meeting notes ask first and show they're listening. The caveats to one-party consent are in `docs/research/meetings-2026-10-14.md` §5.

## Prior work

These live in the Cookbook (dev) workspace:
- the same research file;
- the "Text your agents" doc (2026-10-01);
- Chef / cookbook-dispatch, from the hackathon;
- the DP jr. setup notes.

## License

Apache License 2.0 (`LICENSE`). The name, brand and hosted service at build-a-bot.site are not covered by the license.
