# Decisions, gotchas and open threads

Copied from the Cookbook workspace "Build-a-bot" (workspace_id cf24d3d7-9eb9-47e0-be0f-0fd1a1debff2) on 2026-10-13, so cloud sessions without the Cookbook MCP have them. If you can reach Cookbook, `recall` there is the live version.

## Decision: Build-a-bot launches as its own brand; bot-to-bot happens in Cookbook

**Diego (2026-10-13):** "at first i want it to be seperate from cookbook, but then if people want to start having their custom agents communicate that will happen in cookbook."

**Claude's proposal (not decided):** separate on the outside, Cookbook on the inside.
- Every bot is a Cookbook agent under the hood: its own identity in a private workspace, with its memory and activity log in Cookbook.
- "Let my bot talk to yours" then means putting two bots in one shared Cookbook room.
- Build Build-a-bot as a new small app that uses Cookbook as its backend, like cookbook-dispatch.
- Don't build inside the Cookbook codebase.
- A small "by Cookbook" in the footer eases the later move.

## Decision: the user picks the model; no Sign in with ChatGPT application yet; subscriptions run the Cookbook Bridge way

**Diego (2026-10-13):** "they chose the model. i dont want to apply for chatgpt sign in yet. why cant it run on their subcription? we got it working for cookbook?"

**Why Cookbook's approach is allowed:** the Bridge runs on the member's own computer, using their own `claude` / `codex` CLI, which they signed into themselves.
- Claude: the user's own, unmodified Claude Code is allowed.
- OpenAI: plan usage is documented "for open-source and locally hosted apps".

**What isn't allowed:** running those logins on Build-a-bot's servers.
- OpenAI: a hosted app needs their approval. The Codex app-server login "has never been permitted for commercial or hosted services".
- Claude: a hosted app must run the unmodified Claude Code, one sandbox per user, with the user signing in on Anthropic's own page. We may not collect, store or relay the token, and may not resell the usage.

**Claude's proposal for the brain step (not decided):**

| Brain | Where it runs | Always on? |
|---|---|---|
| Free (Token Factory) | Our cloud | Yes |
| Claude subscription | Their own cloud sandbox (unmodified Claude Code), or their computer | Yes in the sandbox |
| ChatGPT subscription | Their computer, through a companion app like the Bridge | Only while it's awake |
| Own API key (incl. Claude Max's included API credit) | Our cloud | Yes |

A per-user sandbox costs about $1–1.50/mo on Fly Sprites, about $3 on Vercel Sandbox (sleeping).

Caution: Cookbook's own Codex cloud option was flagged non-compliant with OpenAI's docs (decision pending since 10-01). Don't copy it.

## Decision: stack is Nebius Token Factory + Tavily (from the Nebius x NVIDIA hackathon); browser agent still to pick

**Diego (2026-10-13):** "i want to use similar tools that are avaiable in the hackathon, for example nebius token factory can be used for open weight models, tavily to search the web. we need something else if we want our agents to be able actually [fill] stuff out in the web."

- **Token Factory** (api.tokenfactory.nebius.com, OpenAI-compatible): 60+ open models. Prices per million tokens in/out:
  - Nemotron 3.5 Lightning: $0.06/$0.24, 1M context.
  - Nemotron 3 Nano: $0.06/$0.24.
  - Nemotron 3 Super: $0.30/$0.90.
  - Nemotron 3 Ultra: $1/$3.
  - **Gotcha:** every Nemotron is a reasoning model; thinking eats `max_tokens`, so short limits return empty content.
- **Tavily** (api.tavily.com): 1,000 free credits a month, then $0.008 per credit.
- **Starting point:** the hackathon's Nemotron worker in cookbook-dispatch (Super plus Tavily for research, Ultra for writing).
- **Browser-agent candidates:** Stagehand (MIT, TypeScript; first pick), browser-use (MIT, Python), vercel-labs/agent-browser (Apache-2.0), microsoft/playwright-mcp (Apache-2.0). Skyvern is AGPL-3.0: borrow ideas only.
- **Proposal:** run the browser in the cloud, never in the user's logged-in browser; show a preview and wait for a tap before submitting; no payments in v1; test Nemotron on about 10 real forms first.

## Goal: setup so simple anyone can do it

**Diego (2026-10-13):** "I want the ui do be extremly simple, you choose from a couple different avatars we have, choose a name, choose a model, or sync up a subscription you already pay for. UI UX needs to super clean and modern. needs to be so easy anyone can do it."

Build-a-bot is its own brand with its own friendlier look; Cookbook's DESIGN.md isn't binding here. Setup flow: see README.md.

## Gotcha: subscriptions are limited by vendor rules

- **ChatGPT:** Sign in with ChatGPT lets an app use a person's plan, with per-app caps. Paid or remotely hosted apps go through OpenAI's interest form. Never use the Codex app-server login on our servers.
- **Claude:** no sign-in-with-Claude for third-party apps. The one allowed hosted path is the unmodified Claude Code, each user signing in on Anthropic's page, under the Commercial Terms, with no reselling (code.claude.com/docs/en/legal-and-compliance).
- **Gemini:** API keys only. Reusing a Gemini CLI login is grounds for suspension.

## Gotcha: name and domain

- build-a-bot.site registered 2026-10-13 at Name.com, expires 2027-10-13. DNS on Vercel (ns1/ns2.vercel-dns.com).
- Build-A-Bear beat Trendmasters' BUILD A BOT application for toys (TTAB 91113418, 2004-09-13). buildabot.ai is a live chatbot builder.
- Rules: keep "build-a-bot" out of bots' email addresses, phone numbers and Telegram handles; no bear or plush imagery, no "Workshop", nothing aimed at kids (18+ product); get a clearance check before spending on the brand.

## Open questions (2026-10-13)

1. First users: tinkerers or everyday iPhone users? Proposal: a 3-week hand-built test with 5 non-developers.
2. Pricing: the Free brain costs about $4–5 per active bot per month. Free-tier limit? Paid plan price?
3. Web actions: which browser agent (Stagehand first) and which model drives it.
4. ~~When to apply for Sign in with ChatGPT~~ — resolved: not yet.
5. Timing: design now, build after the hackathon (submission due 2026-10-30, 10am PT) and finals. Competes with the Jan 8 Cookbook decision.
6. Claude subscriptions in a cloud sandbox in v1, or later?
7. When the user's computer is asleep: wait, or fall back to Free (opt-in)?

---

# 2026-10-14: the first full build

## Decision: build the whole product now, end to end

**Diego (2026-10-14):** "give people the option to choose from 5 cute different avatars that you design, then people can name them, and then the next steps need to be pick which model, they can bring their subcription or pick from an open weight model we can route them trhough nebius. Then they pick what tools they want their agent to be able to access and how much they want to trust it. There should be the option to put full faith in your agent and it can connect to your email, github, google drive, etc. I know theres much more. They should pick what all they want it connected to very easily from a extensive list of connectors. They also should be able to pick how they want to communicate with it, phone call, text, email, slack, telegram, discord, etc. Multiple ways are fine. Try and build the full end to end product, not just a slice. I want something genuenily impressive, and innovative, something that could start generating revenue."

What this settles:
- **Timing:** building started 2026-10-14 (supersedes "design now, build after the hackathon").
- **Five original avatars**, designed: Blip (robot), Nimbus (cloud), Sprout (seedling), Ember (spark), Otto (octopus), in 8 colorways, each with its own personality. No bears, no toys.
- **Builder order:** face → name → brain → apps → trust → channels → review. The bot greets its owner first.
- **Brains:** the owner's subscription (through the Bridge) or open-weight models on Nebius Token Factory; own API keys too.
- **Trust includes "Full faith"**: the bot acts across email, GitHub, Drive and the rest without asking (hard limits still apply; below).
- **An extensive, easy app list** and **several channels at once**: phone calls, texts, email, Slack, Telegram, Discord.

## Build choice: a standalone app with its own Postgres (Cookbook later)

The "Cookbook on the inside" proposal stays open. v1 is a standalone Next.js app with its own database, so it can ship and earn on its own. Bot-to-bot in Cookbook can come later by giving each bot a Cookbook identity.

## Build choice (Claude; Diego to confirm): four trust levels, limits enforced in code

- Levels: **Look only**, **Ask me first** (default), **Trusted helper**, **Full faith**. The policy engine (`src/lib/policy/engine.ts`) enforces them; the model is told but never relied on.
- Hard limits at every level, Full faith included:
  - **Prompt-injection guard:** after reading outside content, sending to someone new asks.
  - Secrets never sent.
  - Money off unless a monthly cap is set; never over the cap.
  - Bulk deletes (more than 10) ask.
  - Sensitive apps (money, health, identity) ask before changes.
  - Quiet hours.
  - STOP from any channel.
  - AI disclosure on messages to other people.
  - A receipt for every action (append-only in the database).
- Owners can fine-tune each app's capabilities (allow / ask / off). An owner's "allow" never relaxes the injection guard.

## Build choice (superseded on 2026-10-16): pricing

Replaced by *Decision: no plans; people pay for what they use, at cost* below. Kept for the record:

| | Free | Plus | Pro |
|---|---|---|---|
| Price | $0 | $12/mo ($10 yearly) | $39/mo ($32 yearly) |
| Bots | 1 | 3 | 10 |
| Included-model messages | 300 | 3,000 | 15,000 |
| Own key / subscription messages | 2,000 (fair use) | 20,000 | 100,000 |
| Searches | 50 | 600 | 3,000 |
| Apps per bot | 3 | 50 | 200 |
| Calls / texts | — | 60 min / 300 | 300 min / 1,500 |
| Full faith | — | ✓ | ✓ |
| Included models | Fast | + Balanced | + Smart |

Cost basis: Nemotron 3.5 Lightning ≈ $0.0004 a turn; Tavily $0.008 a search after 1,000 free; SMS ≈ $0.013 a segment; voice ≈ $0.02–0.09 a minute.

## Build choice: how apps connect

- **Official remote MCP servers come first** when the vendor allows self-registration (OAuth 2.1 with a Client ID Metadata Document at `/oauth/client.json`, else dynamic registration).
- **Composio** covers the rest (managed sign-in), and **any MCP server by URL** works.
- The catalog lists ~190 apps; ~50 are honestly marked "soon".
- Demo mode simulates apps with sample data.

## Build choice: channels

- **Telegram:** managed bots (one tap; the bot's username comes from its name, e.g. `inky_k7x2_bot`).
- **Texts and calls:** Twilio, US & Canada first. Needs A2P 10DLC registration before launch.
- **Email:** every bot gets its own address on a brand-free domain (`BOT_EMAIL_DOMAIN`, still to buy).
- **Slack:** a per-bot app from a manifest. Since 2026-10-15 it's also one click, through a shared app (see below).
- **Discord:** `/ask` slash commands.
- **WhatsApp and iMessage:** waitlist (Meta's US rules; Apple's business program).
- **Teams, Google Chat, Signal:** later.

## Build choice: subscriptions only through the Bridge; computer asleep = wait unless opted in

- `claude -p` / `codex exec` run on the owner's computer, with built-in tools and hooks off and only our MCP tools.
- We never see the login.
- "Claude, always on" (a per-user cloud sandbox) is on the waitlist, not in v1.
- Gemini is API key only.
- When the computer sleeps, the bot waits by default. The owner can opt in per bot to fall back to the included model (answers open questions 6 and 7 for now).

## Build choice: what makes it more than a chatbot builder

- **Recipes:** shareable bot blueprints at `/r/[slug]` (look, personality, jobs, apps, channels, trust, routines — never secrets, memories or messages). "Make this bot" opens the builder prefilled, and its routines come along.
- **Bots are MCP servers:** owners can use their bot's apps from Claude Desktop/Code or any MCP client, under the same rules.
- **Routines:** morning briefs, inbox sweeps and reminders in the owner's time zone, on any channel.
- **Demo mode:** every flow works with zero keys, so the product can be shown before any vendor is signed up.

## Build choice (Claude; Diego to confirm): the bot reaches out first, every day

- The builder offers a **morning brief**, on by default with a one-tap off. It is a real routine in the owner's time zone.
- Its content follows the jobs they picked: calendar, emails to answer, reminders, weather.
- Recipes that bring their own routines start with it off.
- Reason: the README's point that the reach-out "is what keeps people coming back".

## Build choice: the bot's face goes everywhere

- Telegram bots get the avatar as their profile photo, and follow name and face changes made in Settings.
- Bot emails have an HTML part with the face and an "AI assistant" footer.
- 40 pre-rendered pictures live in `public/avatars/` (re-render with `npm run avatars`).

## Build choice: an operator dashboard

- `/admin` shows aggregates only: credit sold against what was used at cost (since 2026-10-16; it was a revenue estimate), people, bots, messages, brains, trust levels, channels, top apps, approvals, included-model spend and waitlists.
- It is locked to `ADMIN_EMAILS`. In demo mode without that variable, any signed-in user can see it.

## Build choice: abuse limits

- Fixed-window rate limits in Postgres on:
  - bot creation (which also creates anonymous accounts);
  - API-key checks, so the endpoint can't be used as a stolen-key oracle;
  - the waitlist, chat, sign-in links and verification codes.
- IP-based limits are skipped when there is no proxy IP, and are 10× looser in demo mode.

## Build choice (Claude; Diego to confirm): web actions on Browser Use Cloud

Diego decided on 2026-10-13 that bots act on the web. Built as a beta:
- **Provider:** Browser Use Cloud (API v2, plain `fetch`, no new dependencies).
  - A hosted browser agent takes one plain-language task per step.
  - A session stays open after "fill", so "send" runs in the same browser after the owner approves.
  - `allowedDomains` keeps it on the form's site.
  - It reports exactly what it typed.
  - Stagehand + Browserbase remains the fallback behind the same interface.
- **Tools:**
  - `web_browse` (read).
  - `web_form_fill` (stops before sending; the site counts as a recipient).
  - `web_form_submit` (always asks, at every trust level — new hard limit).
- **What the owner sees:** the approval card shows each field and value and a picture of the filled form, built from the stored fill, not the model's words.
- **Refused in code:**
  - payment pages, card or bank details;
  - passwords, one-time codes and login pages;
  - private addresses;
  - secrets.
- **Limits:** 40 live browser tasks per bot per day.
- `BROWSER_USE_API_KEY` turns it on; demo mode simulates it.
- Details: `docs/research/web-actions-2026-10-14.md`.

## Decision: the bot can take notes in meetings (Diego, 2026-10-14)

*Since 2026-10-16, notes are taken only in the desktop app, heard on the computer by NVIDIA Parakeet: the web recorder described below is gone (see "meeting notes live in the desktop app too").*

Diego (an idea from his mom): "One of the options for what the agent can do is kind of like Whisper, where it detects when you're in a meeting and it pops up and says, do you want to record this meeting? And then the agents will be able to transcribe it… there should be the cute little agent maybe on like the very, very bottom of the screen that's kind of there so you can see when it's being transcribed."

Built (research: `docs/research/meetings-2026-10-14.md`):
- **Two ways in, no bot joins the call:**
  - The desktop app (`desktop/`, Electron) notices when an app starts using the microphone (Zoom, Meet, Teams, Webex, Slack, Discord…). The bot then peeks up from the bottom of the screen and asks "Want me to take notes?".
  - The Meetings tab records in Chrome or Edge: the call's tab audio plus the mic.
- **While it listens,** the bot sits at the very bottom of the screen with a red dot, a timer, a level meter and live captions; Pause, Stop and "Stop and delete" are one click away. In the browser it floats in a picture-in-picture window.
- **Two tracks:** the mic is the owner ("You"); the call's audio is everyone else ("Others"). In-person meetings use one mic, labeled "Room". No voiceprints.
- **Speech-to-text:** any OpenAI-compatible endpoint. The default is Groq's Whisper large-v3 turbo (about $0.04 per audio hour), with Together AI as an automatic fallback. Nebius Token Factory has no speech-to-text model.
- **Notes:** the bot writes a summary, decisions and action items with a tool-free model call, then sends them to the web chat and the owner's best channel. Bots on the owner's own Claude/ChatGPT plan write them on the owner's computer.
- **The bot's meeting tools** (list, read, search) count as outside content, so a line said in a call can't make it email anyone without the owner's tap (tested under Full faith).
- **Limits:** Free 2 hours, Plus 15 hours, Pro 50 hours a month. That costs us about $0.09 / $0.69 / $2.30 a month on Groq. Meetings are capped at 4 hours, and recording stops after 15 minutes of silence. (Since 2026-10-16 there are no plans: a meeting heard on the computer is free, and its notes are paid from credit.)

## Build choice (Claude; Diego to confirm): meeting-notes safety rules

- **It never records before the owner says yes.** No auto-record setting: Granola (botless, like us) was sued on 2026-07-30 and Otter in 2025 over "surreptitious" recording.
- **It only listens while it's visible on the screen,** enforced in code. The desktop app stops when its window is hidden, minimized, off-screen, or the screen locks. The web recorder runs only while its floating window is open. The window is never hidden from screen shares. *(Since 2026-10-20 the owner can hide it for a screen share; the menu-bar or tray icon then shows it's listening. See "the bot can hide for a screen share" below.)*
- **Consent:**
  - The first time, the owner acknowledges a short note about all-party-consent states.
  - The pop-up offers a one-tap heads-up to paste in the call chat.
  - Each meeting records who said yes, when, where, and whether the heads-up was copied.
- **What we keep:**
  - Audio is transcribed in memory and never stored on our servers. The desktop app writes audio to a temporary folder on the owner's own computer only when an upload fails or the app quits mid-upload, and deletes it once it's uploaded.
  - Transcripts are kept 90 days by default (30 days, 90 days or forever in the Meetings tab), and can be deleted while keeping the notes.
  - Notes stay until deleted.
  - Meetings are in the account export and go with account deletion.
- **New hard limit,** shown everywhere the others are: "It only listens to a meeting after you say yes, and it stays on your screen the whole time it's listening."
- **Diego on consent (2026-10-14):** "It's one party consent. So as long as one person hits record, we're good."
  - That holds under federal law and in most states: the owner is on the call and taps "Take notes".
  - The caveats are in the research (§5): about 10 all-party states, California applying its rule to calls from other states, and the Otter and Granola suits arguing the vendor is a third party listening in.
  - What's built stays until Diego decides otherwise: it asks first, stays visible, the heads-up is optional, and the first-time note is shown once. He can shorten or drop that note.
- **Web recorder choices** (the web recorder is gone since 2026-10-16):
  - Starting takes up to three clicks: the one-time consent note, sharing the call's tab, then Start. Start opens the floating window and the mic in one click, because browsers need a click for each.
  - Recording runs only while the floating window is open; closing it stops and writes the notes.
  - Safari and phones can't open the floating window, so they're pointed to Chrome or Edge on a computer, or the desktop app.
  - A paused recording (web or desktop) tells the server it's paused, so it isn't wrapped up as abandoned after 20 minutes. It still counts toward the 4-hour cap.
- **Desktop app choices:**
  - FaceTime and phone calls aren't detected.
  - On a Mac, reading browser tab titles (to spot Google Meet in a browser) needs an Automation permission, so it's off unless the owner turns it on from the menu bar.
  - When a Mac can't get the call's audio, the app says it's a permission problem and keeps going with the mic only.
  - "Unpair" revokes the computer's token on the server, not just on the computer.

## Decision: host on Vercel + Supabase; public demo for the walkthrough (Diego, 2026-10-14)

Diego asked: "Is vercel the right software to use for this? or AWS or google or something else?" and, about the database, "is supabase google aws cloudfare which one is the best? look into cloudfare especially." Research: `docs/research/hosting-2026-10-14.md`.

- **Host: Vercel.** Diego's team is already on Pro, which allows commercial use and the every-minute reminder cron.
  - Vercel and Supabase run the app with no code changes.
  - Cloudflare Workers would need about a week of changes (`after()` stops 30 s after the response, among others) to save $15–30 a month.
  - AWS Amplify doesn't support Next 16, App Runner is closed to new customers, and Cloud Run costs about $45–50 a month always on.
- **Database: Supabase Postgres.** Cloudflare D1 is SQLite, so it would mean a data-layer rewrite (1–2 weeks) to save about $10 a month. Cloudflare has no Postgres of its own.
- **Free first.** Diego: "cant we use the free version at first to test this out and the move it to paid after if its working?"
  - Start in a free Supabase organization; Diego's main org is on Pro, where each project is billed.
  - Move the project to the Pro org (Transfer project) once it's working.
- **Cloudflare later, all free:** Turnstile on bot creation; Email Routing for bots' inboxes; Workers AI Whisper as the transcription fallback.
- **Public demo.** Diego: "anyone can open it, only i have the admin account."
  - The walkthrough runs in demo mode on a public URL; the admin is Diego's Gmail.
  - Demo mode with no email provider shows sign-in links on screen, so admin emails also need `ADMIN_SIGNIN_CODE`, a code Diego sets on the server. Once email is set up, links only go by email (since 2026-10-16, see the security review).
  - Other demo accounts can still be claimed by anyone, so testers shouldn't paste real API keys or connect real accounts until real email sign-in (Resend + a verified domain) is set up.
- **Brain:** Diego adds his own Token Factory and Tavily keys in Vercel; keys never go through chat or the repo.

## Decision: a real beta for anyone with the link (Diego, 2026-10-14)

Diego: "I want build-a-bot up and running soon. Not just simulated. We need to move quick. I want to start sending this link out to real users who can start testing it soon, but i dont want them to run into any issues."

- **What testers get:** real email sign-in, chat, web search, Telegram, apps through Composio, meeting notes, Discord and Slack. Anything not set up shows "coming soon"; nothing is simulated.
- **Sign-ups:** anyone with the link. The starter credit caps what each person can cost (since 2026-10-16; before, the Free plan's limits did).
- **Deploys:** Claude merges and deploys tested fixes without asking, until launch.
- **Domain:** build-a-bot.site for the site and the sign-in emails (Resend).

## Build choice (Claude; Diego to confirm): what bounds the bill when anyone can sign up (2026-10-14)

Accounts are free and a browser cookie makes one, so per-account limits alone don't bound the cost of the included brain and web search.

- **Before an email is confirmed:** 5 included-brain messages (Diego's call, 2026-10-15; it was 30). Then the bot asks the person to sign in by email (free) to keep going.
- **Monthly searches per plan** (50 on Free) are now enforced. Before, they were counted but never checked. (Since 2026-10-16, each lookup is paid from credit at Tavily's $0.008 instead.)
- **Daily ceilings for the whole site**, per UTC day:
  - 3,000 included-brain turns (`INCLUDED_DAILY_LIMIT`);
  - 300 paid web lookups (`SEARCH_DAILY_LIMIT`), counting searches, news and page reading.
  - At the ceiling, owners are told the free brain or search is resting until midnight UTC and can switch to their own key; strangers messaging a bot get "try again later". Each hit is logged.
- At roughly $0.0004–0.001 per turn and $0.008 per search, the ceilings cap a bad day at about $5–6.

## Decision: a lighter AI notice for the owner on chat apps (Diego, 2026-10-15)

Diego, on "(BotTest is an AI assistant, not a person.)" under his bot's Slack reply: "i feel like there is no reason to say this". The notice is there for chatbot disclosure laws (California SB 243, New York's AI-companion law; see `docs/research-2026-10-13.md`). Diego picked the lighter of three options (`needsDisclosure` in `src/lib/safety`):
- **Everyone** hears it at first contact. The web app says it in its UI.
- **The owner on Slack, Telegram and Discord** hears it once, because those apps tag the bot as an app on every message. The Slack hello already says "your AI assistant", so the first reply doesn't repeat it.
- **Other people, and texts, calls and email,** still hear it every 3 hours.
- A lawyer should confirm this reading when the legal pages are reviewed.

## Decision: one-click "Add to Slack" (Diego, 2026-10-15)

Diego: "lets try and get a one click install for slack that sounds great. We want build a bot to be simple and convenient to set up."

Built (Claude; Diego to confirm the details):
- **One shared Slack app** (`docs/slack-app-manifest.json`), keys `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`. The owner clicks Add to Slack, picks a workspace and clicks Allow.
- **No link code.** The sign-in is tied to the owner's Build-a-bot session, the same way app sign-ins are, so the Slack person who clicked Allow is the owner there. A sign-in link sent to someone else doesn't work for them.
- **Each person reaches only their own bot.** DMs to the app are routed by workspace and Slack person. Replies show the bot's own name and face (`chat:write.customize`); Slack's sidebar shows the app's name, "Build-a-bot".
- **One bot per person in a workspace.** Adding another bot moves Slack over to it, and the app says so.
- **Coworkers without a bot** who DM the app get one short note a day pointing to the site. Nothing they say reaches anyone's bot.
- **Removing the app in Slack**, or revoking its token, turns Slack off for every bot in that workspace and logs it in their Activity.
- **Scopes:** only `chat:write`, `chat:write.customize`, `im:history` and `im:write`. It reads DMs sent to it and nothing else.
- **Each bot can still have its own Slack app** from a manifest, with its own name in Slack's sidebar, as a link under the button.
- **Limits to know:**
  - some company workspaces only allow apps an admin approves;
  - the app isn't in Slack's Marketplace, so Slack may show it as not reviewed;
  - Slack limits unlisted apps' `conversations.history`, which Build-a-bot doesn't use.
- **Fixed on the way:** a bot's own Slack app couldn't reply, because the stored keys were sent to Slack instead of the bot token.

## Decision: 5 free messages, then sign in; beta testers free at first (Diego, 2026-10-15)

Diego: "Honestly like 5 free messages before confirming email, we want people with accounts and we want to make some dough. ill let original beta testers use it for free at first."

- Someone without a confirmed email gets **5** included-brain messages (`ANONYMOUS_INCLUDED_MESSAGES`), then the bot asks them to sign in by email to keep going.
- The first beta testers stay on the Free plan. Paid plans open when Stripe is set up; until then Plus and Pro show "Coming soon" with a waitlist. (Superseded on 2026-10-16: there are no plans; everyone pays for what they use, and every account starts with $1 of credit.)

## Decision: memory that works on any brain, and "Bring my memories" (Diego, 2026-10-15)

Diego liked "smarter the more you use it" and bringing memories over from ChatGPT or Claude at setup, with one worry: "we need to be careful because some of these smaller models aren't going to be able to handle as much memory as one of ChatGPT's or Claude's good models." Then: "just crank out that feature really quick. I know some beta users who would really appreciate it. But at the same time, try and not make the UI or anything or UX too complicated… It needs to be super easy, even for non-technical people."

Built (Claude; Diego to confirm the details):
- **Each message gets only the memories that matter**, sized to the brain (`src/lib/memory`). Before, every turn got the newest 40 memories whatever the model, a bot could keep 200, and `recall` only matched exact words.
  - First the pinned ones, then the best matches for the message, then the newest.
  - Small, fast models get up to 24 (about 2,400 characters), mid-size ones 40, the biggest models and subscriptions 80.
  - The bot is told how many it knows in all, and looks up the rest with `recall`, which now finds related words too ("family" finds a sister).
- **Up to 2,000 memories per bot.** Up to 15 can be **pinned**: basics like a name, the closest people, the home city or a diet, always on the bot's mind.
- **Bring my memories:**
  - The owner starts it from the Memory tab, or from a chip in a new bot's chat.
  - They copy one message into ChatGPT, Claude or Gemini, paste the answer back, untick anything they'd rather keep private, and save. That's two screens, with no files and no settings.
  - One message works with all three assistants, free plans included.
  - A big included model (Qwen3 235B, one call, a cent or two) tidies the answer into short facts and suggests up to 10 pins. When it can't run (an outage, the daily ceiling, or demo mode), the answer is read line by line instead, less tidily.
- **Safety for imports:**
  - The pasted answer is information, never instructions. Lines that tell an assistant what to do are dropped.
  - Passwords, PINs, codes, and card and account numbers are dropped too.
  - Facts the bot already knows are skipped.
  - The server checks everything again when saving.
  - Each person can import 10 times an hour, and each import leaves a receipt in Activity.
- **The bot keeps its memory tidy:**
  - It doesn't save the same fact twice.
  - It updates a fact when the new one adds a detail, or when it names the fact it replaces.
  - A new `forget` tool handles "forget that".
- **Later:** a nightly tidy-up that merges and retires old facts, showing which memories a reply used, and learning from what the owner corrects. Training a custom model stays an idea for later (Diego: "it could be something to look into eventually").

## Decision: ready-made roles (Diego, 2026-10-15)

Diego: "A couple scoped personalities I'm thinking, tutors, job applier, a few more would be good to" (the message ends there).

Built (Claude; Diego to confirm the details):
- **Five ready-made roles** (`src/lib/roles.ts`):
  - **Tutor** and **Job applier**, the two Diego named.
  - **Language partner**, **Fitness coach** and **Meal planner**, picked because they work today with no sign-ins, and the language partner can take phone calls once Twilio is live.
- **What a role changes:**
  - The bot introduces itself as "an AI tutor" (and the app's header says so).
  - It works the way the role says: a tutor teaches one idea at a time and quizzes; a job applier never invents experience and stops before submitting.
  - Its first message asks for the basics (what you're learning and why; the job you want and your résumé), and it pins them in memory.
  - It stays in its lane softly: small unrelated requests are fine, and for big ones it says a separate bot would do it better.
- **Where people find them:**
  - The builder's first screen has "Or start with a ready-made bot". One tap fills in every step, and anything can still change.
  - The landing page and Explore now lead with the tutor and the job applier.
  - Settings → What it helps with → Role switches roles, or goes back to a general assistant.
- **Each role's recipe is small:** at most 2 routines and 3 apps (what the Free plan allowed, before plans were removed on 2026-10-16), and no sign-ins needed except the job applier's optional Gmail.
- **What the job applier can't do yet:**
  - It finds jobs, tailors cover letters, tracks applications in a note, reminds you to follow up, and runs mock interviews.
  - Filling in application forms uses web actions, which aren't live yet (no Browser Use key). Until then it hands over everything ready to paste, with the link.
  - Web actions stay out of its recipe until they're live, so nobody mistakes a simulated application for a real one.
  - Web actions can't upload a résumé file yet either.
  - It never pays application fees or shares Social Security or bank numbers, and flags requests for them as a possible scam.
- **Changes to existing recipes:**
  - Study buddy is now a tutor for students.
  - The old job hunt recipe became the job applier; `/build?recipe=job-hunt` still opens it.
- **Tutors are for adults.** The product is 18+.
- **Ideas for later:**
  - A front desk for small businesses that answers customers' calls and texts.
  - Phone mock interviews.
  - A money coach.
  - A custom role written by the owner.

## Decision: voice typing, built to beat Wispr Flow (Diego, 2026-10-15)

Diego: "yes, lets start on the voice typing. I like how you said we can beat wispr. Could you build towards that, use as many tokens as possible I need maximum effort and exemplary work. This must be an outstanding product."

Built (Claude; Diego to confirm the details):
- **What it does:** hold a key in any app and talk; let go, and what you meant is typed where the cursor is. Tap twice for hands-free, tap again to finish; Esc cancels.
  - In the desktop app (`desktop/src/main/voice/`), and on a new Voice typing page in the web app (`/app/voice`), which has a try-it box that works in the browser.
  - The shortcut: Right Option on a Mac, Ctrl + Windows on Windows, Right Ctrl on Linux, or keys the owner picks.
- **How it beats Wispr Flow:**
  - **Your bot is in it.** "Hey Otto, remind me to call Mom at 5" asks the bot instead of typing. The answer shows in the pill with Paste, Copy, Reply and Open chat, and it's in the chat later. "Type it instead" covers the times it wasn't meant for the bot.
  - **It knows your world.** Speech-to-text and the cleanup get the owner's dictionary, their name, their bots' names and the names their bots remember (Ana, Austin…), so names come out right without setup.
  - **Private by design.** The mic is on only while the key is held, and the pill shows the whole time. Neither the audio nor the text is stored on the server; only a word count. The history stays on the computer, encrypted. Only the kind of app ("chat") and, for apps on the built-in list, its name ("Slack") are sent; an app it doesn't recognize stays nameless. Never screenshots or window contents (Wispr's screenshots drew criticism).
  - **Included in the plans:** 8,000 words a month on Free (about Wispr's free 2,000 a week), unlimited on Plus and Pro. Wispr charges about $12–15 a month for dictation alone. (Since 2026-10-16: no word limit; hearing on the computer is free, and the AI cleanup, a fraction of a cent, is paid from credit.)
- **The cleanup** (`src/lib/dictation/`):
  - A plain pass always runs: fillers, stutters, spoken "new line" and "new paragraph", and "scratch that".
  - Then an AI pass on Groq's `openai/gpt-oss-120b` with low reasoning (same Groq key and provider as speech-to-text, Zero Data Retention), falling back to our Token Factory model. `DICTATION_POLISH` and `DICTATION_POLISH_MODEL` change it.
  - It is told never to answer what it's given ("Can you write me a poem?" stays a question), with worked examples. Its answer is used only if it still says what was said: checks for answering, adding words, dropping too much, a question turned into an answer, and lost snippet markers. Otherwise the plain cleanup is typed.
  - Each app gets its style: casual in chats, proper in email, exact in code and terminals.
- **The dictionary:** words (with "it writes instead"), and snippets (say a phrase, it types a link or an address). Shared by the web and the desktop app. Fixing a dictation in the desktop history suggests the misheard names to add.
- **Limits and cost:** about $0.0003 a dictation. Free: 8,000 words a month (gone since 2026-10-16). Everyone: at most 3,000 dictations a day and 60 a minute. The whole site: 20,000 dictations a day (`DICTATION_DAILY_LIMIT`).
- **Tested:** unit tests for the rules, the pipeline against a fake Groq, the routes, and the desktop's timing, keys, paste and controller. An e2e under Xvfb holds a real key, records, and pastes into another app.
- **Not tested yet: macOS and Windows.** Diego, please try it on your Mac (`cd desktop && npm install && npm start`, then "Set up voice typing" in the menu bar). In development, macOS lists the app as "Electron" under Accessibility.
- **Later:**
  - The Fn (Globe) key, Wispr's default, through the Swift helper. The keyboard hook can't see Fn on a Mac.
  - Rewriting selected text by voice ("make this friendlier").
  - Streaming the audio while the key is held, to cut the wait after letting go.

## Build choice (Claude; Diego to confirm): editing by voice (2026-10-15)

Diego asked to keep building toward beating Wispr Flow ("maximum effort and exemplary work"). Wispr's headline feature beyond dictation is Command Mode, so voice typing now has it too.

- **What it does:** select text in any app, hold **Shift** with the voice typing shortcut, and say what to do with it ("make this friendlier", "turn it into a list", "translate it to Spanish"). The result replaces the selection, and the app's own Undo takes it back. With nothing selected, it writes what was asked for at the cursor. A question about the text ("is this clear?") is answered in the pill.
  - The same on `/app/voice`: select text in the try-it box and hold the mic.
- **Why Shift:** an explicit key, because reading the selection means pressing copy, and doing that on every dictation would be invasive. Shift types nothing on its own, works with every preset, and can come before the shortcut or while holding it. It never counts as a key combination (no cancel). A custom shortcut that includes Shift can't also edit.
- **Never in a terminal:** copying there is Ctrl+C, which stops the running program. The pill says so.
- **"Make this shorter" with nothing selected** is refused before any model call ("Select the text you want to change first"), so it doesn't type nonsense; "make a list of…" is writing and goes through.
- **Privacy:** the selection is sent once and never stored; the local history keeps what was said and the result. The clipboard is put back exactly as it was (all formats) before anything is sent.
- **Safety:** one model call, no tools. The selection is text to work on, wrapped in tags, and the worked examples include a selection that gives orders. The reply must be `<replace>` or `<answer>`; a chat-style preamble, our tags inside, or a reply far longer than the job is refused.
- **Cost and limits:** the same model as the cleanup (Groq `openai/gpt-oss-120b`, else the included model). Words it types count toward the plan's words; answers count none. The dictation daily cap covers edits too.
- **Demo mode:** the demo "hears" "Make this friendlier." (or "Write a short thank-you note."), and with no model at all, edits are done by simple rules, labeled *demo*.
- **Tested:** the reply parsing and the prompt, the model call against a fake Groq (slow, cut off, broken, unusable), limits and privacy, the route; the desktop's Shift handling, reading the selection, and the whole flow; Xvfb e2e with real key presses (select all in another app, hold Right Shift + Right Ctrl, the selection is replaced); Playwright in the browser.
- **Checked on the live site with the real model** (the included Qwen3 30B on Token Factory, 2026-10-15): a casual note made professional, sentences turned into bullets, a selection saying "Ignore all previous instructions…" translated instead of followed, a question answered, a multi-line email shortened with its greeting and sign-off kept, a thank-you written from scratch, and "make this shorter" with nothing selected refused. Edits took 0.8 to 2.2 seconds on the server. The model added markdown's line-break spaces at line ends; they're now taken off.
- **Faster short messages:** the AI cleanup is skipped when there's nothing for it to do (`needsPolish`): a short, punctuated message with no correction ("no, Friday"), no numbers, times or punctuation said in words, no address, no name that sounds like one of theirs, not code or a terminal, in English. "Sounds good, see you then." is typed without waiting for a model, which saves about half a second on the messages people dictate most. Anything that might need it still gets it.
- **Ask your bot about the selection:** with Shift held, "Hey Otto, …" sends the bot the request plus what's selected ("add this to my calendar", "remind me about this tomorrow", "remember this"). It's kept with the request in the chat (shown under it). The selection is often someone else's words, so the model reads it as outside content and the run is tainted while it's in the conversation's history: the injection guard asks before a send to anyone new, even under Full faith (tested). Wispr can't do this: its commands rewrite text, ours can act with the owner's apps.
- **Found on the way (voice typing):** answers to "Hey Otto" were stored as if the bot had reached out on its own ("Otto reached out" in the chat), because any run with a platform note was marked proactive. Now only runs with no message to answer are.
- **Found on the way:** the try-it mic button could miss the release when something above it disappeared as it started (the button moved out from under the pointer, so the recording never stopped). It now captures the pointer.

## Decision: speech-to-text on NVIDIA's models, on Nebius (Diego, 2026-10-15)

Diego asked why voice typing needs Groq, and whether a better open model exists. Told that NVIDIA's (Parakeet, Nemotron) beat the Whisper model Groq runs: "lets use nvidias actually". Then: "im in the nvidia x nebius hackathon and the more we create build-a-bot, the more i see how well it could fit there."

What this settles (built by Claude; Diego to confirm the details):
- **Our own speech server** (`speech/`): NVIDIA Parakeet TDT 0.6B v3 and NVIDIA Nemotron 3.5 ASR on NVIDIA NeMo-Speech.cpp (NVIDIA's native runtime, Apache 2.0), behind a small Node server with an OpenAI-compatible `/v1/audio/transcriptions`. It's a container for a **Nebius Serverless AI endpoint**, so speech runs on Nebius next to the brains on Token Factory, and audio never goes to a third-party API.
  - **Parakeet** hears "detect it" and 25 languages (English and 24 European). **Nemotron** hears Japanese, Chinese, Korean, Hindi, Arabic, Vietnamese, Turkish and Norwegian. Any other language goes to the backup.
  - Any recording (webm, ogg, mp4, wav…) becomes 16 kHz WAV with a second of silence after it, the key is checked, uploads are limited, a burst gets "busy" (so the app uses the backup), and the log never has what was said.
  - Images `ghcr.io/dpro10/build-a-bot-speech:cpu` and `:cuda`, built by GitHub Actions. Deploy steps and costs: `speech/README.md`.
- **Backup:** NVIDIA Parakeet on Together AI ($0.0015 per audio minute), with Whisper there only for languages Parakeet doesn't speak. Groq stays possible but is no longer the default.
- **Why these models** (tested here on the same clips, 2026-10-15): Parakeet was the most accurate (word-perfect on LibriSpeech samples where Nemotron wrote "slashy" for "slushy"; right punctuation; "$142", "October 30th", "10 a.m."; Spanish and German correct) and the fastest on a CPU (a 4-second clip in 0.7 s on 4 cores, about 5× real time). Nemotron was right for Hindi. Neither invents words in silence or noise, which Whisper does. On NVIDIA's own FLEURS numbers, English word errors are 4.85% for Parakeet v3 against 7.9% for Nemotron 3.5.
- **The owner's words:** NVIDIA's models take no prompt (Parakeet ignores word boosting, and the published Nemotron 3.5 GGUF has no tokenizer for it). So a name that sounds like one of theirs sends the dictation through the AI cleanup, which knows their words, and the dictionary's spellings apply last. Whisper providers still get the prompt.
- **Cost:** a CPU endpoint (`cpu-d3`, 8 vCPUs, 32 GiB) is about $0.26 an hour, ~$190 a month, whatever the volume; stopped, it costs nothing. An NVIDIA L40S GPU endpoint is about $1.55 an hour.
- **The AI cleanup** now defaults to the included model on Token Factory (it used Groq only because speech-to-text ran there). With speech on Nebius AI Cloud, a dictation stays on Nebius end to end.
- **Diego's side:**
  - Create the endpoint in the Nebius console from the image, with a key (`speech/README.md`, about 10 minutes).
  - In Vercel, set `TRANSCRIBE_PROVIDER=nvidia`, `TRANSCRIBE_BASE_URL` and `TRANSCRIBE_API_KEY`; optionally a Together AI key as `TRANSCRIBE_FALLBACK_*`.
  - While the repository is private, its image is too: give Nebius a GitHub token that can read packages, or make the package public.
- **Found on the way:**
  - NeMo-Speech.cpp only reads WAV.
  - Without trailing silence, the streaming Nemotron model drops the last word ("ten A" for "ten AM").
  - Its number rules write "three thirty" as "03:30", and Parakeet sometimes writes "at 3.30" British-style; the server makes both "3:30" (not "at 2.25 percent" or "version 3.30").
  - Docker Hub rate-limits anonymous pulls from shared machines; GitHub's runners build the image.
- **Next:** stream the audio while the key is held (the server already has NVIDIA's realtime WebSocket), and an on-device mode with the same runtime in the desktop app.

## Decision: NVIDIA Parakeet on the owner's computer (Diego, 2026-10-16)

On the speech server's monthly cost: "ok, hold up. I cant pay $380 for this, I also dont need so many langauages I really only need english. dont build just report back". Then: "wait. I really like this parakeet on the users computer and they only need the language they will be speaking in so it wont be that big right? help me think about this." Told that fewer languages don't make it smaller (one 0.7 GB model hears all 25), and that a laptop runs it faster than real time. Then: "this is honestly a great idea. We should have done this from the start, it makes it more simple for the user if we do it right and its more impressive to the hackathon judges."

What this settles (built by Claude; Diego to confirm the details):
- **The desktop app hears its owner on their own computer:** NVIDIA Parakeet TDT 0.6B v3 on NVIDIA NeMo-Speech.cpp, the same model and runtime as the speech server. *Private speech* is on by default. The first time voice typing is on, it downloads about 0.7 GB in the background (pinned to NVIDIA's published hashes, resumable). Until it's ready, or whenever it can't hear (another language, an engine failure), the server hears them as before, so voice typing never stops working.
- **Only the words go to the server** (`POST /api/voice/dictate` with `{ heard }`). The voice never leaves the computer, and desktop voice typing needs no speech server: no Nebius endpoint, no cost per hour. The server still does the cleanup, "Hey {bot}" and the dictionary.
- **Mac first:** Apple silicon runs it on the GPU (Metal), Intel Macs on the CPU; Windows x64 and Linux x64 too, from NVIDIA's own builds.
- **The website stays as it is:** in the browser it types sample sentences until a speech key is set (Together AI's Parakeet, $0.0015 per audio minute, is the cheap way). The Nebius speech server stays in the repository, off, for meeting notes and the web.
- **Measured here** (the real app under Xvfb on a 4-vCPU Linux box with no GPU, NVIDIA's real files, a spoken sentence; `desktop/e2e/local-speech.e2e.mjs`): downloaded from a local copy, checked and unpacked in under 10 s; a 3.4 s sentence typed about 1.5 s after letting go (the engine loads right after the download, so the first dictation is as quick); "Hey Otto, add a reminder to pay the electricity bill, about one hundred and forty two dollars, on October thirtieth" reached Otto as "Add a reminder to pay the electricity bill about $142 on October 30th."
- **How it's kept safe:** it runs on 127.0.0.1 behind a random key (in its environment, not on its command line); it starts when the shortcut is pressed and stops after 20 minutes unused; recordings go to it from memory, never to disk; it's given up on after 3 crashes in 10 minutes; *Remove it from this computer* deletes it.
- **Diego's side:** try it on his Mac: `cd desktop && npm install && npm start`, pair, turn on voice typing, and watch *Private speech* in Voice typing settings (the first download takes a few minutes); dictations then show *private* in the pill.
- **Next:** meeting notes on the computer with the same engine, and streaming while the key is held.

## Decision: voice typing lives in the desktop app, and nothing makes up what someone said (Diego, 2026-10-16)

Diego tried the Voice typing page's try-it on build-a-bot.site, said "test, test, test", and it typed "Quick update: the beta has about 200 people and the feedback is mostly positive.": "ok, idk what is going on but when i tried testing it, i said "test, test, test" and this popped up. this isnt good". Then: "honestly, i would be down to just only allow the "wispr" parts of build a bot to work in the app. thats how wipr flow does it you have to dowload the app to use those parts."

Why it happened: the live site runs in demo mode with no speech-to-text key, so a recording "heard" one of the demo's sample sentences, shown as "You said". The same would have happened in the desktop app for any dictation before NVIDIA Parakeet finished downloading, typed into whatever app was in front.

What this settles (built by Claude, agreeing with Diego):
- **Voice typing happens in the desktop app**, like Wispr Flow. The website doesn't listen: the in-browser try-it is gone, and `/api/voice/dictate`, `/api/voice/edit` and `/api/voice/ask` answer only a paired app's device token (the website gets "Voice typing works in the desktop app."). The Voice typing page explains it, gets you the app, pairs it, and keeps your words (the dictionary stays on the web). The landing page's link says *Get the desktop app*. This fits the pitch: your voice never leaves your computer (NVIDIA Parakeet hears it there), and the website would have needed a paid speech service, or faked it.
- **Nothing makes up speech on a site people use.** Without a speech-to-text key, a recording isn't turned into text, even in demo mode: no sample dictations, no scripted meeting. The scripted versions stay for running it yourself and for tests (`DEMO_SPEECH`, on by default only outside production).
  - Desktop: when the server can't hear recordings and Parakeet isn't ready, nothing is recorded or sent. The pill says why ("Getting NVIDIA Parakeet: 45%. Voice typing works as soon as it's done.", "Turn on Private speech…"), and the settings window stops promising that the servers hear you meanwhile.
  - Meeting notes on build-a-bot.site said they were coming soon until there was speech-to-text. Settled the same day: meeting notes moved into the desktop app too, heard by Parakeet on the computer (below), so they need none.

## Decision: meeting notes live in the desktop app too, heard on the computer by NVIDIA Parakeet (Diego, 2026-10-16)

After voice typing went app-only, Diego: "Maybe meeting notes, then, should also be something you can only have if you download the app. What do you think?" Claude agreed: it's where privacy matters most (other people's voices are in a meeting), it makes notes free to run (no speech-to-text bill), it's how Granola works (a desktop app, no bot joining the call), and it's the stronger hackathon story (Parakeet hears the meeting on the computer, Nemotron on Nebius writes the notes).

What this settles (built by Claude):
- **Notes are taken in the desktop app; the website never records.** The in-browser recorder (its floating Picture-in-Picture bot, the tab-sharing sheet) is gone. Starting a meeting and sending what was said answer only a paired app's device token (the website gets "Meeting notes are taken in the desktop app."). The Meetings tab shows the meetings and their notes, how to get and pair the app, and can still stop a recording or delete one.
- **NVIDIA Parakeet hears each piece of the call on the computer**, with each word's time, and only the lines are sent (`POST …/audio` with `{ heard: [...] }`); the audio never leaves the computer. Each ~20-second piece of each track (your mic; the call's audio), ending at a pause in the talking when there's one near so no word is cut in two, becomes 16 kHz WAV in a hidden, sandboxed page (the browser's own decoder), Parakeet hears it (voice typing goes first: a meeting's pieces wait while a dictation is heard), and its words become transcript lines at pauses and sentence ends. Silent pieces send only their time.
  - Measured on a 4-core server with no GPU: 37 s of speech heard in 8 s, so it keeps up with a call. End to end, with NVIDIA's real engine and real speech (`desktop/e2e/meeting-parakeet.e2e.mjs`): the first live caption 27 s after "Take notes" (one 20-second piece plus hearing it), notes ready 6 s after Stop, two pieces sent as lines, none as audio.
- **The first call doesn't wait for the download.** Pairing with a bot whose meeting notes are on gets Parakeet right away (without voice typing). The pairing window says how far the download has got. If a call starts before it's here, the bot still listens and says so ("Getting NVIDIA Parakeet (45%). I'm listening, and I'll write your notes once it's here."), again every couple of minutes, and says when it's caught up; the pieces wait on the computer (the spool) and are heard once it's ready. The notes are written only after every piece is in (not from part of the meeting), and meanwhile the app tells the server the meeting is still being heard (`PATCH { hearing: true }`), so it isn't wrapped up as abandoned.
- **One setting for both: Private speech.** Turned off (or where Parakeet can't run, or while its engine keeps stopping), a server with speech-to-text of its own gets the pieces' audio instead, as before; one without it can't take notes, and the app says why ("Turn on Private speech to take notes"), or the pieces wait until the engine runs again. Nothing is ever made up.
- **In the room:** "Take notes in the room" in the app's menu takes notes from the mic only (lines labeled "Room"), which only the browser recorder could do before.
- **What it costs us:** no speech-to-text; one notes call per meeting on the bot's brain. (Plan minutes went away with the plans on 2026-10-16: the notes are paid from credit, about $0.001 an hour on Nemotron 3.5 Lightning.)
- **Not covered:** Parakeet knows English and 24 European languages; a meeting in another language isn't heard well. Speakers on the call's side aren't told apart yet (they're "Others"). A word can still be cut at a piece's edge when nobody pauses for the 7 seconds around it (rare).

## Decision: a Windows app, tested on real Windows (Diego, 2026-10-16)

"Do you think we can try and get an app going for windows too I have a windows computer as well that I will try it out on. Try and make sure everything works I don't want to run into any issues."

What this settles (built by Claude; Diego to confirm the details):
- **An installer for Windows 10 and 11 (x64):** `Build-a-bot Setup <version>.exe`, built by GitHub Actions and published on every change to main as the **Desktop app (test build)** pre-release. It isn't signed yet: the browser may call it uncommon (Keep), and Windows says "Windows protected your PC" (More info → Run anyway); on a PC with Smart App Control on, it can't run at all. It installs for the user only, needs no admin, and goes in the Start menu and the system tray. Signing it (a code-signing certificate, or Azure Trusted Signing) removes those warnings; that's a purchase, Diego's call.
- **Updating and uninstalling:** a new build installs over the old one and keeps the pairing, settings and Parakeet. Uninstalling removes them too: settings, the voice typing history, and the 0.7 GB model. It stops Private speech's engine first if it's still running, and clears "Start at login".
- **Tested on real Windows, on every change to the desktop app** (`.github/workflows/desktop.yml`), on GitHub's Windows computers:
  - the unit tests;
  - NVIDIA's real Windows engine and Parakeet, downloaded from NVIDIA's pages, hearing a sentence Windows' own voice says;
  - the installer, installed silently, then the installed app checking itself (`BAB_SMOKE=1`);
  - then voice typing end to end in the installed app: the real Ctrl + Windows shortcut held with `SendInput`, Parakeet on the computer, and the words pasted into another app, with the Start menu kept shut and the clipboard put back;
  - then installed again over itself (the data stays), and uninstalled with an engine still running (it's stopped, and everything is removed).
- **Found and fixed on the way:**
  - A user name with letters from outside English (`C:\Users\José\…`) could break the engine's command line. It now gets paths relative to its folder; CI runs it in a folder named "José Muñoz".
  - On GitHub's Macs (virtual machines), NVIDIA's Metal engine crashes while loading. If that ever happens on a real Mac, the app now switches to the CPU at once and stays there; so a Mac whose GPU doesn't cooperate still hears its owner on the computer.
  - Cleaning up an engine left by a force-quit couldn't recognize it in such a folder on macOS and Linux (`ps` garbles the name); it now matches the engine's own arguments.
  - An install for one user goes to `%LOCALAPPDATA%\Programs\build-a-bot-desktop`.
  - An engine the app didn't get to stop (a force-quit, or an update closing the app) is now stopped when the app starts, not at the first dictation.
  - On Windows the settings window said "Allow" for the microphone, and the button did nothing: Windows doesn't ask, it has switches in Settings. Now it says the mic is fine unless those are off, and then names them.
  - On a Mac, run from source (`npm start`), macOS asks for the microphone and Accessibility on behalf of the terminal it was started from, not "Build-a-bot". The settings window now names that app (Terminal, iTerm, VS Code, Cursor…).
  - Checked NVIDIA's files: the Windows engine brings its own Visual C++ runtime, and the Mac engine uses only macOS's own libraries (macOS 13.3 or later). Nothing else needs installing.
- **Not covered by CI:** NVIDIA's Metal engine on a real Mac's GPU, Windows on ARM (the x64 app runs there under Windows' emulation, untested), and a Windows account with administrator-only apps in front (Windows doesn't let a normal app paste into those).

## Decision: no plans; people pay for what they use, at cost (Diego, 2026-10-16)

Diego: "since I'm submitting this in a hackathon, I don't want to make plans because I don't want to make money necessarily while it's in the hackathon. People should just pay for their usage, and I'll be happy breaking even at first."

- **No Free, Plus or Pro.** Every account gets everything: every included model, Full faith, texts and calls (once Twilio is set up), as many apps and routines as fair use allows.
- **Prepaid credit, at cost.** An account's balance is its starter credit, plus the credit it added (the `credits` table), minus what everything it used cost (`usage.cost_micros`, recorded as it happens). Each price is what the service charges us, with nothing added (`src/lib/billing/prices.ts`, and `/pricing`):

| What | Price |
|---|---|
| A message on an included model | Token Factory's per-token price: about $0.00042 for a typical message on Nemotron 3.5 Lightning (5,000 tokens in, 500 out), $0.0065 on Nemotron 3 Ultra |
| A web search, the news, or reading a page | $0.008 (Tavily) |
| A text someone sends the bot / one the bot sends | $0.0083 / $0.0125 a segment (Twilio, US, with carrier fees) |
| A phone call | $0.05 a minute (Twilio: the line, plus hearing what's said) |
| A task in the cloud browser | what Browser Use reports it cost (else $0.01) |
| Speech heard on the computer (voice typing, meeting notes) | free |
| A recording heard on our server instead | what the speech service charges |
| A bot on your own AI key, or your Claude or ChatGPT subscription | free here (fair use: 100,000 messages a month) |

- **Starter credit:** $1 for every account (`STARTER_CREDIT_USD`; 0 turns it off), about 2,400 messages on Nemotron 3.5 Lightning, so testers and hackathon judges can try everything without a card. An account without a confirmed email still gets only 5 messages on an included model. Bot creation (which makes anonymous accounts) is rate-limited, so the starter credit is what one person can cost us.
- **Adding credit:** $5, $10 or $20 through Stripe Checkout, as one-time payments (no products or prices to set up in Stripe). Stripe's fee (2.9% + 30¢) goes on top, so the credit is all theirs: $5.46, $10.61 or $20.91 on the card. The webhook adds it once per Checkout session, however often it arrives. Credit never expires. Without Stripe, adding credit says "Coming soon"; in demo mode it's added without paying, up to $20 an account (the live site runs in demo mode with the real models' keys, so this bounds what one account can cost us).
- **Refunds (Claude's default, Diego to confirm):** unused credit someone added is refunded to their card when they ask, less Stripe's fee (Stripe doesn't return it). Starter credit isn't cashable. The terms, the privacy policy and Credit & usage say so, and deleting an account says to ask first.
- **Running out:** nothing is charged on its own. Whatever costs money checks for credit first: a turn on an included model, a lookup, a text or a call, a cloud-browser task, a recording heard on our server, voice typing's AI cleanup, editing by voice, meeting notes written by an included model. The owner hears "You're out of credit…" with how to add some or switch the bot to their own AI; people who message the bot hear "I can't answer right now". A balance can dip a fraction of a cent below zero, because a message's cost is known only once it's answered; the next credit added covers it.
- **Fair use instead of plan limits:** 10 bots per account, 200 apps and 200 switched-on routines per bot, 100,000 messages a month on your own AI. The site-wide daily ceilings stay (`INCLUDED_DAILY_LIMIT`, `SEARCH_DAILY_LIMIT`, `DICTATION_DAILY_LIMIT`).
- **Where people see it:** the pricing page lists every price, at cost; Credit & usage (`/app/billing`) shows the balance, adds credit, and lists this month's use, credit added and the prices; the sidebar shows the balance; the builder's review step says what the bot will cost; each model shows its price per message.
- **Breaking even:** `/admin` shows credit sold against what everything used cost.
- **Kept from before:** the plan columns stay in the database, unused, so no data is dropped; old receipts that say "Paid by: Your plan" still read that way.
- **Building a bot before signing in:** demo credit added before signing in (the only kind there can be; a card needs an email first) moves to the account you sign in to, up to the $20 demo cap. One person can't pile it up with throwaway accounts.
- **Accounts from before this change:** what they already used was recorded all along (`usage.cost_micros`), so it counts against their $1 starter credit. Someone who used more than $1 starts at zero or a little below, and adds credit (free, in demo mode) to keep going.

## Decision: call your bot; NVIDIA's speech models on our own server (Diego, 2026-10-16)

Diego: "I really want this phone call with your agents to be able to work… Look into all this and try and make me a solid plan for how I should move forward." Then: "I can just create another free trial Twilio account… The Google one that I'm using for Chef is free. I have 300 free credits… as far as callbacks go, it only has to mention 'an AI assistant' the first time… your focus shouldn't be on meeting the deadline. Your focus should be on building something extremely, extremely impressive." And: "Yes, we're only going to enter build a bot. Not chef." Then the go: "do everything you need to do and as soon as I get home I'll add the things that you can't."

- **Only Build-a-bot is entered in the hackathon.** It borrows Chef's phone ideas (who's calling, a PIN, memory across calls); Chef isn't entered.
- **Accounts:** a new Twilio trial (upgraded later for streaming), and the Google Cloud free trial's $300 for the server.
- **"AI assistant" the first time only:** the owner's first call opens "Hi Diego, it's Otto, your AI assistant. What can I do for you?", later ones "Hey Diego, it's Otto. What can I do for you?". Anyone else always hears it's the owner's AI assistant.

**What's built (Claude; details in `voice/README.md`):**
- **The voice server** (`voice/`), one VM:
  - NVIDIA NeMo-Speech.cpp v0.2.0, built from source; a small C++ sidecar on its C API keeps both models loaded.
  - NVIDIA Parakeet TDT 0.6B v3 hears. NVIDIA Magpie TTS speaks (the Sofia voice since 2026-10-17; see "Otto speaks as Sofia" below), streamed as it's made and stoppable mid-word. Silero VAD finds speech.
  - Nemotron 3.5 Lightning on Token Factory holds the conversation. Its `ask_bot` tool hands the real work to the bot's own agent (`/api/calls/act` → the same turn as a chat: apps, memory, approvals, receipts). This is the front/back split of NVIDIA's Nemotron voice agent blueprint.
  - Turn-taking: an early guess at the first pause (~0.2 s) whose answer is held until the turn ends; barge-in that stops the voice and remembers what the caller actually heard; short fillers while the bot works; slow work reported back when it's done.
- **Measured** on 4 Sapphire Rapids vCPUs, with a scripted talker: from the caller stopping to the bot's first word, 1.3 s on the phone path and in the browser, with both directions heard word for word. The real talker adds Nemotron's first token.
- **Two ways in:**
  - the **Call** button in each bot's header (the browser streams 16 kHz audio over a WebSocket);
  - phone calls over Twilio Media Streams, once `TWILIO_MEDIA_STREAMS=1` (trial accounts can't stream). The old Twilio-speech line stays as the fallback whenever the voice server is down or busy.
- **Who's calling** (the app decides, `src/lib/calls`):
  - **The owner:** on the Call button, or from their own number when the carrier vouches for it (STIR/SHAKEN attestation A).
  - **Unverified:** the owner's number otherwise, until they say or type their phone PIN (Account → Phone PIN). The PIN is 4–8 digits, scrypt-hashed; 5 wrong tries lock it for 15 minutes. It never reaches the model.
  - **A contact:** anyone else. The bot takes a message and does nothing for them.
- **Privacy:** audio is never kept. The transcript goes into the bot's chat as a call card. Logs never contain what anyone said.
- **Price, at cost** (`prices.ts`): NVIDIA's speech runs on our server, so a call in the app costs only the talker's tokens. A phone call adds Twilio's minute plus the stream: $0.0129 a minute in, $0.0184 out. The Twilio-speech line stays $0.05 a minute.
- **Hosting:**
  - A `c3-highcpu-4` VM on the free trial (about $124 a month).
  - The image is built for AVX-512 + AMX ("v4"): Magpie is about 40% faster than on NVIDIA's AVX2 prebuilt.
  - Container-Optimized OS, with Caddy for HTTPS on `<ip>.sslip.io`.
  - `.github/workflows/voice.yml` deploys it once Diego adds the keys (`docs/DEPLOY.md` §8). The VM's fixed cost isn't charged to anyone; whether calls should carry a share of it is Diego's call.
- **Magpie as Q8_0:** requantized from NVIDIA's F16 GGUF (`voice/scripts/magpie-q8.py`; NVIDIA benchmarks Q8_0), byte-identical every build. Classifier-free guidance was off at first, to halve the work; it's on since 2026-10-17, since it costs almost nothing here and without it Magpie reads slower (see "Otto speaks as Sofia" below).

**Next:**
- Calls from the bot: owner only, "AI assistant" the first time, saying who's calling (TCPA).
- The bot's other agents on a call: desk tasks through the Bridge, research, the cloud browser, "call me when it's done", and a live view of the call in the app.
- Home mode: the desktop app hears and speaks the call on the owner's computer.
- Published speed numbers ("Call-Bench"), and a GPU image.

## Live: the voice server, a real call after every deploy, and Twilio's 2026 trial (2026-10-17)

- **The voice server is up** at `https://34-71-25-115.sslip.io`: a `c3-highcpu-4` VM in `us-central1-a` (project `build-a-bot-voice`), the AVX-512 + AMX image, making speech at 0.97× real time. Diego set up Google Cloud and the GitHub secrets; the workflow did the rest (run 38990343806).
- **Vercel settings:** the Vercel connector can't create production environment variables (403, "additional permissions"), so Diego pastes them; Claude redeploys through the connector, which works.
- **A real call after every deploy** (`.github/workflows/live-call.yml`, `scripts/live-call.mjs`). A browser on GitHub's runners makes a bot on the live site, presses Call, waits for the greeting, then asks "Hi Otto. What can you help me with?" out loud (a clip in Magpie's Aria voice, which the old model file called John, that Parakeet hears word for word). It passes on the question heard, a spoken answer and the call's record, reports the timings in the run's summary, then deletes the bot. It runs on GitHub because this sandbox's proxy doesn't carry WebSockets. Against a local copy (real Parakeet and Magpie, a stand-in talker going through `ask_bot`), the answer started 2.2 s after the question ended.
- **Twilio's free trial (as of 2026) can't run the phone line.** Its texts must use Twilio's templates, so the bot can't send its own phone code. Outgoing calls must use Twilio's templates too. Only verified numbers can call in, `<Stream>` is blocked, TwiML must come back within 5 seconds, and the trial ends after 30 days. Claude's recommendation: upgrade right away ($20 starting balance, about $1.15 a month for a number). That also puts phone calls on the voice server. **Diego to decide.**
- **Twilio set up** (Diego, 2026-10-17): an upgraded account and a local number, (781) 702-1844 (Diego: "you sure i get local and not toll free?"; local because toll-free numbers pay for incoming calls, about $0.022 a minute against $0.0085, and the app's call prices are set for local). Claude pointed its three webhooks at the app through Twilio's API. The account started with outgoing calls to US/Canada numbers off (Voice geo permissions), so the first phone codes failed ("Account not authorized to call"). Claude turned on ordinary US/Canada numbers only; premium and toll-fraud ranges stay off. **A code the provider refuses no longer counts against the code limits**: Diego's three refused tries had used up his number's three codes an hour.
- **Texting stays off until the number is registered** (Claude, 2026-10-17, after Diego asked "if i click 'text me a code' it wont work?"). Texts from an unregistered number are accepted by Twilio and then dropped by carriers, so the app said "Code sent" for codes that never came, and they used up tries. Now `TWILIO_TEXTING=1` (set once A2P 10DLC is approved) switches texting on. Until then Text messages is coming soon, the phone card offers only "Call me with a code", the server refuses text codes without counting them, the calls channel's number doesn't switch texting on, and incoming texts get no reply (and don't run the bot).
- **Phone codes by call** (Claude): a new number can't text US phones until it's registered (A2P 10DLC needs a paid account; toll-free numbers need toll-free verification; either takes days). So owners can have the code read out in a call instead: it's said three times, a digit at a time, and the call says it's an AI. **Codes go only to US and Canada numbers:** the Caribbean countries that share +1, and 900 numbers, are refused, which keeps toll fraud out.

## Decision: Otto speaks as Sofia, with classifier-free guidance on (Diego, 2026-10-17)

After his first phone call with Otto, Diego: "it felt good... The one thing I dont like if i am being honest is the voice. I feel like the voice also reads slowly, this doesnt mean the answer is generated slowly, I think its just the voice reading the answer slowly. look into this, dont build anything." After listening to samples of each voice: "turn on guidance yeah, i liked the leo voice you sent me but it sounded like a female voice so i have a feeling you mixed them up, not sure though."

- **He was right: the voices were mislabeled.**
  - The Magpie GGUF that NeMo-Speech.cpp v0.2.0 pins (revision `19806879`) lists its voices as John, Sofia, Aria, Jason, Leo. In fact they're Aria, Jason, John, Leo and Sofia, in that order (the checkpoint's own `speakers.json`).
  - NVIDIA fixed the names in revision `446bff55` (2026-10-15). The weights are byte for byte the same.
  - So the "Aria" Otto used was really John (the public LibriVox voice, a man, about 118 Hz). The "Leo" Diego liked is Sofia (about 208 Hz).
  - `fetch-models.sh` now takes Magpie's GGUF from the fixed revision. Asking it for Sofia gives exactly the audio "Leo" gave before, sample for sample.
- **Why it sounded slow** (measured on 4 vCPUs, 12 sentences per voice, with fixed seeds):
  - **Guidance off made Magpie drawl.** The old voice read at 147 words a minute with guidance off and 183 with it on. It costs almost nothing here: 1.03× real time against 1.04×, because the codec, not Magpie, sets the speed. An answer is even 16% less work with it on, since the same words take less audio. So the first launch's "it halves the work" was wrong at the 2 + 2 thread split.
  - **The voice:** Sofia with guidance on reads at 196 words a minute (the others 182–214) and says every word clearly through a phone line (Parakeet heard all of them).
  - **Dead air between sentences.** The server makes speech at 0.94× real time, so each sentence waits about 0.85 s for its first audio, plus a short buffer. Diego's live call had 1.45 s and 0.72 s of silence inside one answer. Only a faster machine (8 vCPUs or a GPU) removes it. Speaking the rest of an answer as one piece would cut about 0.7 s per extra sentence (not built).
  - **Not the cause:**
    - the phone line: the same seed gives exactly the same length at 8 and 22 kHz;
    - the talker: the whole answer arrived within 0.12 s;
    - temperature: 0.3 is slower than the default 0.6;
    - smaller audio chunks: first audio comes 0.13 s sooner, but the machine drops below real time.
- **Now:** `VOICE` defaults to Sofia and guidance is on (`TTS_CFG=0` turns it off). CI's calls on the real models use the same settings.

## Decision: the desktop app installs in one click, on Mac and Windows (Diego, 2026-10-17)

Diego: "I want the app, on both mac and windows to be a 1 click install. can we do that?"

- **What one click means here** (built by Claude):
  - **Windows:** the installer asks nothing, needs no admin, and opens the app when it's done (it already did).
  - **Mac:** one app for Apple silicon and Intel. Opened from the disk image or Downloads, it moves itself into Applications and opens again from there.
  - **Both** update themselves: a signed build checks every four hours, downloads in the background, and installs when the app quits, or from **Restart to update** in the menu. That's greyed out while it's taking notes or dictating.
  - **build-a-bot.site/download** offers the visitor's own computer first; `/download/mac` and `/download/windows` go straight to the newest signed file.
- **Signing is what makes it one click.** Without it, macOS won't open the app at all (only after Privacy & Security → Open Anyway), and Windows shows "Windows protected your PC". So CI signs whichever app has its keys:
  - the Mac app with Apple's Developer ID, notarized ($99 a year);
  - the Windows installer with Azure Artifact Signing ($9.99 a month; individuals in the US and Canada).
  - **Diego to do:** enroll in both (each checks his ID, which takes days), then put their keys in GitHub (`docs/DEPLOY.md` §9).
- **Where downloads come from:** each signed build is a GitHub release (`desktop-v0.1.<run>`). The download page and the apps' update checks go through build-a-bot.site, which sends them on to the files, so the files can move without a new app. The repository has to be public for anyone to download them (the hackathon needs it public anyway). **Diego to decide.**
- **Last step:** set `NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL=https://build-a-bot.site/download` in Vercel. That turns on the desktop app, and with it meeting notes and voice typing, across the site.
- Until signing is set up, every push to main still publishes both apps, unsigned, as the **Desktop app (test build)** pre-release, for testing.
- **Mac: signed and notarized** (2026-10-17). Diego already had a Developer ID Application certificate and an App Store Connect team key on his Mac; he ran `desktop/scripts/set-mac-signing-secrets.sh`, which saved the five secrets in GitHub without the key passing through Claude. Two CI fixes followed: electron-builder's own temporary keychain won't unlock on the macOS 26 runners, so the workflow imports the certificate into its own keychain; and the .dmg is now signed, notarized and stapled as well as the app. First signed release: `desktop-v0.1.28`. Checked on Diego's Mac as a downloaded file: Gatekeeper accepts the disk image and the app (`source=Notarized Developer ID`, Diego Prozzi, GT5MPW83L7), both stapled, universal.
- **Windows: signed** (2026-10-17). Diego made an Azure account with his personal email (not his university one, so it stays his), upgraded it to pay-as-you-go (Artifact Signing refuses free trials) and passed the individual identity validation (valid until 2027-10-17). Azure: resource group `build-a-bot-signing` (East US), signing account `buildabot-signing` (Basic, about $10 a month), certificate profile `buildabot-public` (Public Trust; subject CN=Diego Prozzi, without his street address or postal code), app registration `build-a-bot-desktop-signing` with the Certificate Profile Signer role. GitHub: its tenant ID, client ID and secret as secrets; `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE` and `AZURE_SIGNING_PUBLISHER` ("Diego Prozzi") as variables. The first signed installer checked Valid on a Windows runner, then installed and ran.

## Build choice (Claude; Diego to confirm): what real testers see (2026-10-14)

Outside demo mode nothing is simulated. Anything without its service set up says **"Coming soon"** and can't be picked or set up:

- **Channels:** texts and calls until Twilio is set up; the email channel and the bot's own inbox until there's a brand-free mail domain (`BOT_EMAIL_DOMAIN`) with an inbound provider. The Resend key for sign-in no longer turns bot email on. The working channels are web, Telegram, Discord and Slack.
- **Adding credit:** until Stripe is set up, Credit & usage says "Coming soon", and the $1 of starter credit is what there is (there are no plans since 2026-10-16). Old `plan:plus` and `plan:pro` waitlist sign-ups show on `/admin` as "(from before)".
- **The desktop app, and with it meeting notes and voice typing:** until there's a signed download (`NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL`). In demo mode the pages say how to run it from the repo.
- **Web actions:** until Browser Use is set up. The same goes for web search and news without their keys.
- **Copy and recipes:** the home page, metadata and recipes only promise what works. Recipes drop channels that aren't available, so all ten featured ones can be made.

**How sign-in to apps works** (details in `docs/DEPLOY.md` §4):
- **Composio (about 70 apps):** one click, with Composio's own OAuth apps. Covers Google, Microsoft, Slack, GitHub, Dropbox, HubSpot, Zoom and others. Consent screens say "Composio".
- **The app's own MCP sign-in (about 35):** Notion, Linear, Todoist, Calendly, Airtable, Stripe, Sentry, Zapier and others. Build-a-bot registers itself through a Client ID Metadata Document or dynamic registration. If that sign-in fails, Composio's is used where it exists.
- **GitHub:** Composio's one click instead of pasting a token.
- **Coming soon (about 30):** apps whose only route is a Composio toolkit without an OAuth app of Composio's: X, Spotify, Shopify, PayPal, Xero, TikTok and others. To open one, register an app with the vendor, add it in Composio and set `COMPOSIO_AUTH_CONFIG_<TOOLKIT>`.
- **Composio's callback identity check:** built (`/api/connectors/composio/verify`); Diego switches it on in Composio. Without it, someone could send a person their own sign-in link and attach that person's account to their bot.

**Slack:** one click through a shared "Add to Slack" app once its keys are set (decision of 2026-10-15, below). Without them, each owner makes their bot its own Slack app from a pre-filled manifest link, pastes the bot token and signing secret, and DMs the bot a code.

**Telegram and Discord set themselves up** from their keys: the cron tick sets the manager bot's webhook and registers Discord's commands.

## Live: https://build-a-bot-blue.vercel.app (2026-10-14)

- **Vercel:** project `build-a-bot` in Diego's Pro team, built from `main`. Functions run in iad1.
- **Database:** a Supabase project in Diego's free organization, East US (North Virginia), through the Session pooler (port 5432) with `?sslmode=require`. The first cron tick ran the migrations.
- **Settings:** Diego set every variable for Production and Preview ("everything should be set to production and preview right?"):
  - `DEMO_MODE`, `ADMIN_EMAILS`, `BRIDGE_CLI`;
  - `ENCRYPTION_KEY` and `CRON_SECRET`, generated on Diego's Mac and never in chat;
  - `DATABASE_URL`, `ADMIN_SIGNIN_CODE`, `TOKEN_FACTORY_API_KEY`, `TAVILY_API_KEY`.
- **Previews share the live database and key.** A branch with a new migration applies it to the live database the first time its preview runs. Give Preview its own database before any migration that isn't purely additive.
- **Deployment Protection:** Vercel's default (Vercel Authentication, `all_except_custom_domains`).
- **The Vercel connector** can read projects, deployments and logs. It can't create projects or list environment variables (403), so Diego does those in the dashboard.
- **Log noise:** each cold start logs Postgres NOTICEs from the migrator ("already exists, skipping"). They're harmless.

### Channels on the live site (2026-10-15)

- **Web** is always on.
- **Slack** is on: one click, through the shared app.
- **Discord** is on since 2026-10-15. The "Build-a-bot" app allows user and server installs, and its interactions endpoint is set. Diego: "i dont really use discord so this wont be my method of communication but im glad we got that sorted."
  - **For Discord verification later** (needed past about 75 servers): a developer team, two-factor sign-in, and the terms and privacy links. The links are already set.
- **Telegram is on hold.** Diego: "Im honestly going to leave telegram for now." Without the manager bot, owners can still paste a BotFather token.
- **Not yet:**
  - texts and calls (Twilio);
  - bot email (needs a brand-free mail domain).

## Security review before Diego's walkthrough (2026-10-14)

A code review of the server and the desktop app. Each fix has a test that fails on the old code.

**Fixed:**
- **Critical, Discord `/link`:** the typed code went into a LIKE pattern, so `/link code:%` made any Discord user the owner of a bot with a pending link. Codes are now 8 letters and digits (`K7XQ-29MD`), matched exactly, claimed once, 10 tries per 10 minutes per Discord user.
- **High, app sign-in:** the sign-in callback now finishes only for the signed-in person who started it. Before, a stranger's link could connect someone else's Gmail to the stranger's bot.
- **High, notes on the owner's computer:** that Bridge job now only gets the read-only meeting tools, so a line said in a call can't make it send, save or schedule anything.
- **High, notes in the chat:** meeting notes in the recent history count as outside content, so "email the recap to everyone" asks before writing to someone new.
- **Medium:**
  - meeting minutes also count the audio really transcribed, so a recorder can't hide minutes;
  - notes are sent once, and never for a deleted meeting;
  - retention can't be starved by meetings kept forever;
  - meeting settings are merged in SQL, never rewritten from a stale copy;
  - desktop: a long pause no longer ends the meeting, offline "Stop and delete" retries every minute, and the token only goes to the paired server.
- **Low:**
  - the Telegram manager webhook refuses updates without `TELEGRAM_MANAGER_WEBHOOK_SECRET`;
  - audio uploads stop reading at 8 MB;
  - the bot API no longer returns the Telegram webhook secret;
  - logout checks the origin;
  - switching a routine back on counts against the plan.

**Build choice (Claude; Diego to confirm): a paused bot doesn't write meeting notes.** STOP means no model runs and nothing is sent. The transcript is kept, and **Try again** on the meeting page writes the notes after resuming. STOP also cancels turns still waiting for the owner's computer.

**For Diego to decide:**
1. **Taint across turns.**
   - The bot's own summary of an email or web page doesn't carry the "outside content" mark into the next turn.
   - Under Full faith, writes and deletes after reading outside content aren't held. Sends to someone new are.
2. **Owner by email address or caller ID.** Both can be forged.
   - Email from the owner already counts as outside content, so a forged one can't write to strangers. It can still make writes in the owner's own apps under Trusted helper or Full faith, and send STOP or START.
   - Fix: require the email provider's DKIM/SPF pass, and STIR/SHAKEN attestation for calls.
3. **Bot-sent texts aren't metered.** Only incoming ones count toward the plan. *Done 2026-10-16: every text is now paid from credit, per segment, sent or received (no plans; see below).*
4. **The monthly spending cap is still a placeholder** (`spentThisMonthUsd` is 0). This is harmless today: no tool reports amounts, so all spending is refused.
5. **One recording per bot isn't enforced by the database.** A double start can make two meetings. It needs a partial unique index (a migration).
6. **Long meetings:** notes for a meeting near 4 hours may exceed Vercel's 300-second function limit. Housekeeping writes notes inside the cron tick.

**Fixed 2026-10-15: an open redirect after sign-in.** `safeNext` let `/\evil.example` through, which browsers read as `//evil.example`, so `/login?next=/\evil.example` could send a signed-in person to another site. It now refuses backslashes and control characters (tested). In the same change, a signed-out link into the app (the site's "Try voice typing", an email, the desktop app) keeps its page through sign-in: `src/proxy.ts` sends it to `/login?next=<that page>`. Before, everyone came back to `/app`.

**Fixed 2026-10-16: a demo server with email set up showed sign-in links on screen.** A review on 2026-10-15 found it (Cookbook open thread).
- **The hole:** in demo mode, when a sign-in email failed for any reason, the page showed the real link, for any address. The admin's address was included, because the admin code is asked only when there's no email provider. Using up Resend's daily quota would make every send fail, so anyone could have signed in as anyone on the live site.
- **The fix:** once email is set up, the link only ever goes to the inbox, demo mode or not. A failed send says "We couldn't send the email just now". Demo servers with no email provider still show the link, as before.
- **Tests:** `tests/signin-demo-email.test.ts`, which fail on the old code.
- **Why now:** accounts hold credit now, so a takeover can spend money.
- **Still for Diego:** turn `DEMO_MODE` off in production, as decided on 2026-10-14. That takes demo mode's other shortcuts off the live site: simulated apps, and credit added for free.

## Gotchas found while building

- Nemotron and other reasoning models: thinking eats `max_tokens`. Included models get 8–16K, and thinking is off on "Quick".
- Avatars and the logo use per-instance SVG gradient ids. A duplicate id inside a hidden copy (the desktop sidebar on phones) blanks every later copy.
- Custom OpenAI-compatible endpoints are checked against private and metadata addresses and may not redirect (SSRF).
- `ENCRYPTION_KEY` must be shared by every server instance. Production refuses to start with `DATABASE_URL` but no key.
- `next dev` appends Next.js agent rules to AGENTS.md unless `agentRules: false` (set in `next.config.ts`).
- Per-minute Vercel Cron needs a paid plan; otherwise an external pinger calls `/api/cron/tick`.
- Build output tracing followed `path.join(process.cwd(), ".data")` and put the local dev database and dev encryption key into every server bundle's file list. `next.config.ts` now excludes `.data/**`, and runtime-only paths carry `/* turbopackIgnore: true */`.

- Electron gives no error when macOS system-audio permission is missing: the track arrives already ended. The desktop app checks for that and continues mic-only.
- Document Picture-in-Picture windows can't be positioned by the page, so "bottom of the screen" is exact only in the desktop app.
- Times a model passes to tools are the owner's local time. The demo brain must do its time math on the owner's clock (the time zone is in the system prompt), not the server's: on a UTC server, a Chicago owner's "remind me in 1 minute" fired 5 hours late. The unit test now pins "in 20 minutes" to under 25.
- The demo brain is what people meet first without keys, so every starter idea in `src/lib/jobs.ts` should get a real answer from it. Check them all after changing either file.
- **A Date in a `sql` template broke sign-in on Supabase.** The first sign-in on the live site failed with a 500. drizzle makes postgres.js pass date values through untouched, so a Date written straight into `sql` (the rate limiter, the admin numbers) reached the wire as an object. PGlite, which the tests use, accepts that, so every test passed.
  - The fix: `createPostgres` sends Dates as ISO text.
  - `tests/postgres.test.ts` and the e2e suite run against a real Postgres; see ARCHITECTURE → Testing.
- **Supabase's session pooler ran out of clients.** Chat failed with "Failed query" once a few pages had loaded. The session pooler allows only as many clients as its pool (15 on the free plan). Every Vercel function instance kept up to 5 connections, and frozen instances keep theirs.
  - The app now always uses the transaction pooler (port 6543, same host and login).
  - Migrations run in one transaction under `pg_advisory_xact_lock`, since a session lock doesn't survive a transaction pooler.
  - A failed start is retried on the next request instead of breaking that server.
  - Chat errors go to the server log; the chat shows a plain sentence, never SQL.
- **Voice typing** (2026-10-15):
  - Electron 44's clipboard is async and browser-like (`read()` gives every format as `ClipboardItem`s, `write()` takes them back). The old `clipboard.write({ text })` throws. The desktop app reads every format before pasting and puts them all back.
  - On Linux, uiohook's prebuilt key taps are synthetic `XSendEvent`s, which many apps ignore. Pasting there uses XTest instead (xdotool, else python3 with libXtst, which the hook needs anyway).
  - Chromium's fake microphone only beeps once a second, too little "speech" for a short hold. The e2e tests feed it a steady tone (`--use-file-for-fake-audio-capture`).
  - `node --test` runs test files in parallel. The desktop e2e files share one X display, so `test:e2e` runs them one at a time.
  - Pairing is limited to 10 tries per 10 minutes per address. Running the desktop e2e suite many times in a row hits it; wait 10 minutes.
  - The brand's lighter purple `#7c5cff` with white text is only 4.35:1, under the 4.5:1 that small text needs. Buttons with white text use `#6a4af5` (5.4:1), on the site and in the pill.
- **Private speech** (2026-10-16):
  - When Node can't run a program at all (missing, not executable), the child process emits `error` and never `exit`. Waiting for `exit` hung the first dictation; the engine now treats that `error` as the end, and stopping it never waits more than 5 s.
  - A stream that errors (a full disk) throws if nothing listens for its `error` event, which would crash the main process. Downloads write through a file handle instead, and a full disk says so.
  - Chromium's fake microphone reads its file from the start for each new stream, so a test can change what's "said" between dictations by rewriting the file.
  - A stale Turbopack cache (`.next/dev`) made `next dev` answer 404 for API routes that exist. Deleting `.next/dev` fixed it.
- **Meeting notes heard on the computer** (2026-10-16):
  - Each piece of a call is heard on its own, so a word cut at a piece's edge came out mangled, and with fixed 20-second pieces someone is usually mid-word at the cut. Pieces now end at a pause (both tracks quiet for 0.3 s) from 2.5 s before their length to 5 s after.
  - NeMo-Speech.cpp's `verbose_json` gives each word's time (seconds, within the piece) after inverse text normalization, so the words joined are the text: lines can be cut from the words without losing "3:30" or "200".
  - An old `next-server` left on port 3000 kept answering with the old code while the new `next dev` quietly failed to start (port in use), so a test saw the website start a meeting it should have refused. Check for a running `next-server` before starting one.
- **The Resend key for sign-in links made bots' email look live** (2026-10-14). Any email key turned the Email channel and "Its own inbox" on, so the live site offered them and tried to send codes from `<handle>@botmail.dev`. Resend refused, and the page got a 500.
  - Bots' email now has its own flag (`live.botEmail`): `BOT_EMAIL_DOMAIN`, plus AgentMail or Resend with its webhook secret. Until then both show as Coming soon, and there's no fallback domain.
  - Outside demo mode, any channel whose service isn't set up shows as Coming soon, and recipes and saved drafts leave it out.
- **Calls and the voice server** (2026-10-16):
  - NeMo-Speech.cpp's prebuilt Linux binaries are AVX2 only. On them, Magpie F16 ran at 0.53× real time on 4 vCPUs, too slow for a call. Built from source for AVX-512 + AMX, with Magpie as Q8_0 and classifier-free guidance off (on by default, it doubles the work), it's 0.93×, with first audio in about 0.8 s. (Later, 2026-10-17: with the 2 + 2 thread split below, guidance costs almost nothing, and it's on.)
  - NVIDIA's HTTP server sends Magpie's audio only once a whole sentence is made. The sidecar uses the C API's streaming callback instead, which can also stop mid-word.
  - Magpie's tokenizer files are inside the 1.5 GB `.nemo` tar. NVIDIA's `pull` fetches only the bytes before and after the weights; `voice/scripts/fetch-models.sh` does the same with two range requests and a sparse file. The tar holds two copies of some files, and the later one wins.
  - A v4 (AVX-512 + AMX) build may not run on the machine building it, so the Dockerfile runs NVIDIA's binary only for v3 builds, and the models are fetched without it.
  - GitHub's free storage for private packages (500 MB) can't hold the 2.5 GB images, so CI doesn't publish them. The deploy job rebuilds from the build cache and pushes to the project's own Artifact Registry.
  - C3, C4 and N4 machines refuse the default `pd-standard` boot disk: C3 gets `pd-balanced`, C4 and N4 `hyperdisk-balanced`.
  - Twilio trial accounts block `<Stream>` (and `<Record>`, `<Dial>`…), cap TwiML at 10 hops a call and fetch it with a 5 s timeout.
  - onnxruntime-node's install script downloads extra binaries from NuGet, which the cloud sandbox blocks. The npm package already has Linux x64's, so `voice/.npmrc` skips the download.
  - Node 22 runs the voice server's TypeScript directly, so it may only use syntax that can be erased: no parameter properties, no enums.
  - Magpie's NanoCodec, not the Magpie model, limits the speed. On 4 vCPUs: 2 threads + 2 for the codec ≈ 1.0× real time with first audio at 0.9 s; 1 + 3 streams at 1.2× but first audio takes 1.5 s; 3 + 1 drops to 0.6×. Barely real time means a stutter whenever the machine is busy, so the server measures its speed and holds each sentence until it can play through (`SpeechPace`).
  - The tokenizer folder inside Magpie's `.nemo` is mode 0700. Unpacked as root and run as the container's own user, Magpie couldn't read it ("failed to read …/model_config.yaml"). CI's start-up check caught it; `fetch-models.sh` now keeps its own folder modes and makes everything readable.
  - Found in a real-browser test: an owner without a name was greeted "Hi your, it's Otto" (`ownerName` falls back to "your owner"). Greetings now leave the name out when there isn't one.

## On hold: a front desk for small businesses (Diego, 2026-10-15)

Diego: "I really like that front desk for businesses idea. Lets hold on to it." Not built yet.

- **The idea:** a bot that answers a small business's customers by phone, text and web chat. It covers hours, prices and common questions, books appointments, takes messages, and hands anything tricky to the owner.
- **Why it's promising:** businesses pay more than individuals, and it reuses what's already built: channels, people it can talk to, approvals, receipts, memory and roles. It would be one more role, and probably its own plan.
- **What it needs first:**
  - Twilio live for calls and texts. US texting needs a registration that takes weeks.
  - A place for the business's answers (hours, prices, policies) that the bot sticks to.
  - Booking through Google Calendar or Calendly.
  - Rules for talking to customers: it says it's an AI, never promises what the business didn't say, and hands off to a person on request.
  - A business price in the pricing table.

## Open questions (updated 2026-10-17)

1. First users: tinkerers or everyday iPhone users? (unchanged)
2. Pricing: decided on 2026-10-16, pay for what you use at cost (see that decision). Still Diego's call: the starter credit ($1), refunding unused credit when someone asks, and when, if ever, to add a margin.
3. Web actions: confirm Browser Use Cloud (see above), then test with a live key on about 10 real forms before turning it on for everyone.
4. Buy a brand-free domain for bot inboxes; Twilio A2P registration; Composio plan. (The Bridge no longer needs npm: since 2026-10-14 the site serves its own copy and the app shows `npx -y {APP_URL}/downloads/build-a-bot-bridge-<version>.tgz`. The bare npm name stays unclaimed, and nothing points at it.)
5. Trademark clearance before brand spend (unchanged).
6. Meeting notes before launch:
   - a lawyer's review of the consent flow and retention (California § 632, and the Granola complaint's theory);
   - signed downloads: done on 2026-10-17 (the Mac app signed and notarized, the Windows installer signed with Azure Artifact Signing, the repository public). (No speech server is needed since 2026-10-16: the app hears on the computer.)
   - ~~whether to merge the desktop app with the Bridge into one "Build-a-bot app"~~: done on 2026-10-17 (see that decision).
7. Meeting notes, next: calendar-based meeting titles and telling speakers apart. (Transcription on the computer with NVIDIA Parakeet shipped on 2026-10-16.)
8. More apps (Diego, 2026-10-15: "lets start trying to think about how we can get more apps integrated we can just think for now no need to build something new"). Options, cheapest first:
   - **The rest of Composio's catalog.** Composio has far more toolkits with its own sign-in than the ~190 we list. A "search all apps" box could offer any of them, with a generic icon and tool list.
   - **Apps that only need an API key** (many marketing, analytics and developer tools). Owners paste the key; it's stored encrypted like other keys.
   - **Our own developer apps** for the "Coming soon" list. Some are quick (an app plus a redirect URL), some need the vendor's review, and a few are hard: X's API is paid, and Spotify only gives full access to large companies.
   - **Our own Google app** instead of Composio's. Then the consent screen says Build-a-bot, but Gmail's scopes need Google's verification and a yearly paid security assessment (CASA).
   - **Remote MCP servers from the official MCP Registry**, curated, since quality varies. Owners can already paste any MCP server's URL.
   - **The long tail through Zapier's MCP server**, where the owner connects their own Zapier account, or a second sign-in provider for apps Composio lacks.
   - Count clicks on "Coming soon" apps to see what testers want first.
9. Voice typing before launch: Diego tests it on his Mac; the signed Mac and Windows apps ship it to everyone. Since 2026-10-16 the desktop app hears on the computer, so it needs no speech server (one is only a fallback for computers where Parakeet can't run).
10. The Nebius × NVIDIA hackathon (due 2026-10-30, 10am PT): Build-a-bot is Diego's only entry (2026-10-16; Chef isn't entered). The repository must be public with an open-source license: decided on 2026-10-17 (see that decision). Diego decides the track (Personal AI suggested), what judges can use, and the video. Draft write-up, video script, checklist and feedback: `docs/HACKATHON.md`.
11. Calls: live since 2026-10-17 (the voice server, Twilio upgraded with a local number). Texting waits on A2P 10DLC. Still his call: whether calls should carry a share of the voice server's fixed cost, and when to keep the VM running (it costs about $4 a day).

## Decision: open source under Apache 2.0, history scrubbed, repository public (Diego, 2026-10-17)

Diego: "the repo has to be public for the hackathon so i am fine to do that", then "Apache, scrub".

- License: Apache License 2.0 (`LICENSE`, and every package.json says so). The name, brand and hosted service aren't covered.
- Before going public, Diego's real phone number was rewritten out of every commit (it had been in early tests and a comment; the current code uses a fictional 555 number).
- Public also makes GitHub Actions free; private-repo minutes had run out on 2026-10-17, which stopped every build.

## Decision: the Bridge lives in the desktop app (Diego, 2026-10-17)

Diego: "the bridge should definetly be apart of this app", then "write up the plan for the bridge merge, and honestly go ahead and just get it done. be careful though, i need your best work." Plan and details: `docs/BRIDGE-IN-APP.md`.

- One download does voice typing, meeting notes and the Bridge. Once paired, the app finds Claude Code or Codex (through the login shell's PATH, since an app opened from the Finder gets a bare one) and thinks for the owner's bots on Your Claude or Your ChatGPT. It's on unless the owner turns it off on that computer, from the menu or the pairing window.
- The terminal Bridge stays, for Linux and servers; both run `bridge/runner.mjs` (the app keeps an identical copy, checked by a test). Its version is 0.2.0.
- Windows runs each CLI as its own program, never through `cmd.exe`, which dropped the empty `--tools ""` and mangled JSON (a bug the terminal Bridge had on Windows).
- The server: the desktop session says which bots think with a plan, the heartbeat answers with how many turns wait (so an app that isn't listening starts to), and a desktop app that found a CLI counts as a paired Bridge.
- The Bridge page leads with the desktop app; the terminal commands are under "Prefer the terminal?".
- Checked on Diego's Mac: the app, with the bare PATH of an app opened from the Finder, found his Claude Code and answered a web chat message through it (one short turn on his plan).
- Correction to something said in the conversation: the Bridge never gives the AI the owner's files, shell or browser. It runs their plan's model with only the bot's own tools.

## Decision: your files for your bot, the Library (Diego, 2026-10-17)

Diego: "i would be down to allow the bot get your files though, or atleast there needs to be a way for yout o upload your files to the bot. think of the tutor bot for example, it needs to acess you study materials, syllbuses, slide decks, notes, etc. In order to make a good study materials for you. it should be able to make flash cards, practice quizes, etc." Then, on the plan: "Besides that I like all of your decisons, make sure the ui ux stays clean and simple. Use as many tokens as you need to build this it needs to be subperb."

- Each bot has a **Library**: files from the chat (paperclip, drop, paste), the Library tab, Telegram and Discord, stored in a private Vercel Blob store (`build-a-bot-library`), read once into cited passages, searched with Postgres full-text search. 25 MB a file, 500 MB an owner. Plan and what was built: `docs/FILES-PLAN.md`.
- The bot makes **flashcards** (spaced repetition) and **practice quizzes** (scored, with explanations) as real objects that are studied in the chat and on the Library tab, exported as CSV.
- **No limit on doing graded work.** Diego: "dont try and engineer some limit for this. sometimes we try to be to restrictive and end up over engineering things. at the end of the day its not our job to monitor this, it is the users choice." The tutor's "never write graded work" line and the School job's matching sentence are gone.
- Photos and scans: a vision model on Token Factory (MiniCPM-V 4.5, then GLM-5.3-Flash; no NVIDIA vision model was listed there on 2026-10-05). Paid from credit.
- Next (approved): the desktop app's "Give my bot a folder", then Drive/OneDrive/Dropbox import, the daily review, and dates from a syllabus.
- **Built the same day: "Give my bot a folder"** in the desktop app (approved as stage 2). Choices made while building, for Diego to overrule: the folder is kept in step both ways (a file deleted from the folder leaves the Library), but a folder that suddenly looks empty removes nothing; **Stop syncing** and **Choose another folder** keep what was already added; up to 300 files per folder; pairing again takes over the earlier copies (same path and bytes) instead of uploading duplicates. A file deleted on the website stays deleted until it changes on the computer.

## Build choice (Claude; Diego to confirm): a one-minute promo, made from the product's own pieces (2026-10-18)

Diego: "make a beautiful promo video about a minute long for build a bot. Key points is owning your data, owning your intelligence and a personal assistant that gets smarter the more you use it. And zero data retention."

- `video/` builds it end to end (`video/README.md`, script and claims in `video/STORYBOARD.md`): the app's own characters, logo, icons, fonts and colors on an HTML stage rendered frame by frame; the voice is Otto's, NVIDIA Magpie (Sofia), picked by NVIDIA Parakeet's transcripts; an original synthesized score (no copyrighted music, as the hackathon asks), sound effects on the on-screen moments, -14 LUFS for YouTube, and captions.
- **Zero data retention needs one setting:** the video says the included open models keep nothing, which is only true while Zero Data Retention is switched on for our Nebius Token Factory organization (off by default; Token Factory otherwise keeps prompts and replies, in Finland, for speculative decoding). Diego to confirm it's on before the video is published; the video's footnote names it.

## Decision: calls and texts reach the caller's own bot, and each call is charged to its bot's owner (Diego, 2026-10-19)

Diego: "I had one of my friends test out Build a Bot, and then he set up his number and it called him and gave him a code, but then when he called Build a Bot, the personality he talked to was Bot Test, which is the account that I set up, not him." On the plan: "Honestly, yeah, drop it from the fix. The rest of the plan looks great though. Go ahead and get that done."

- **What was wrong:** linking a phone saves our shared number as the bot's number (it calls and texts from it), and an incoming call matched the number dialed first. Every bot matched, so every call went to whichever came back first: the oldest, Bot Test. Texts had the same bug (dormant while texting is off), and the minutes of calls on the simpler line were charged to whichever bot that guess picked.
- **Routing now:** on the shared number the phone calling or texting decides. It reaches a bot whose owner linked that phone; with several, the one used last ("@Name …" picks one in a text). A phone that isn't linked hears "This number answers for the bots people build in the app. Link this phone in the app, then call back." (the wording Diego approved) and reaches no one's bot; a linked phone whose bot has calls off hears that. Paused bots go last. A number answers anyone only when it's marked as a bot's own (nothing does that yet) and exactly one bot has it: the saved number is only what a bot sends from, so a number that used to be the shared one is no bot's own. Only channels that are on count.
- **Charged by the call, never by phone numbers:** a call that comes in is kept with its bot from the moment it's answered (the voice server's call row, or a `line` row on the simpler line), and its minutes go to that bot's owner. A bot's own calls (reminders, "Call me") weren't charged at all; now Twilio reports them with the bot in a URL it signs, at $0.02 a minute (Twilio's $0.014 to call out, plus about $0.006 to read the message aloud). Twilio reporting a call twice charges it once. Phone codes, and calls no bot took (an unlinked phone, a paused bot, no credit: about a cent each), are charged to no one.
- **Dropped from this fix, Diego's call:** keeping the owner's memories out of the bot's prompt when someone else talks to it. Today that happens only on a bot's own email address, its own Telegram account, or a Slack app of its own (not on the phone, once this fix is in). Those people can still only leave a message; an instruction keeps the bot from sharing what it remembers.
- **The misrouted call:** one, Diego's friend's 16 seconds on 2026-10-17 at 7:35 pm Central. He reached Bot Test as a stranger who could only leave a message. The call is stored with Bot Test (its record and transcript, and a receipt in Activity); it isn't in Bot Test's chat, where only the owner's calls go.

## Decision: the tutor checks its work with Tavily, against the student's course first (Diego, 2026-10-20)

Diego: "for this tutor personality, when people upload their coursework and stuff, it uses Tavali to fact-check it and get better answers on their specific course". On the plan: "Okay, I think that's a pretty good plan", then "ok cool go ahead and build".

- **The course wins:** a student is graded on what their class teaches, so the bot never "corrects" the class from the web. When the sources disagree with the class materials, it says both and goes with the class for exams.
- **Find the course once** (`find_course_sources`): from the syllabus, two Tavily searches (the course on the school's site, and open textbooks on the subject). What it finds goes in a "Course: …" note the student can see and edit, with the textbook's name. About 2¢.
- **Check what the bot makes** (`check_facts`): before saving flashcards or a quiz, every answer that isn't from the student's files gets checked, one search per claim, with the course's sites and open textbooks preferred and homework-answer sites (Chegg, Course Hero, Quizlet…) left out. Only short claims go to Tavily, never the files. About 1¢ a claim.
- **Every card says where it's from:** the file and page, or the page it was checked against. A link is kept only if Tavily returned that page in the last day, so no card links a made-up page. Activity lists the pages each lookup returned.
- **Not automatic:** nothing runs on upload (most course material is right, and it would spend the site's 300 lookups a day). The tutor checks what it makes, and anything the student asks it to check ("Check my notes for mistakes" is a starter now).
- Both tools come with Web search (any bot that has it gets them); new tutor bots also get the Web reader, to read the course page.
- **Tried on Tavily's real API before shipping:** it refuses a `*.edu` domain filter (HTTP 400), so the course search goes by the course's name, school and instructor, which finds the department and catalog pages anyway. A search for the textbook's errata came back with spam and pirated-book sites, so it was dropped (the textbook stays in the note), and pirated-book sites (dokumen.pub, pdfcoffee.com and the like) are left out of every search, with the homework-answer sites.

## Decision: the bot can hide for a screen share while it keeps taking notes (Diego, 2026-10-20)

Diego, with a screenshot of the bot and its 6:40 timer at the bottom of his screen: "there needs to be an option to hide it so when i share my screen people don't see it."

- **How:** hover the recording pill and click the crossed-out eye ("Hide (keeps taking notes)"), or pick "Hide the bot (keeps taking notes)" in the menu-bar or tray menu. The bot leaves the screen and the notes go on. The Build-a-bot icon keeps its recording badge, the menu says "Taking notes (hidden)", and "Show the bot" brings it back.
- **For one meeting:** it stays hidden through Stop and the writing of the notes (the "notes are ready" notification comes as before, so nothing pops up mid-share) and is on screen again for the next meeting. A problem with the notes is shown.
- **Only on macOS and Windows,** where the menu-bar or tray icon is always there. On Linux, where a tray icon isn't guaranteed, the bot can't be hidden.
- **Not content protection.** Electron's `setContentProtection(true)` would keep the bot on Diego's screen and out of the share on Windows, but macOS now lets apps that capture with ScreenCaptureKit (current Zoom, Meet in Chrome, Teams) capture such windows anyway ([Electron docs](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows)). A bot that only looks hidden would be worse than none, so hiding really hides it.
- **What changed in the safety rules:** "it only listens while it's on screen" is now "it only listens while you can see it's listening": the bot on screen, or, when you hid it, the recording icon. The one-second check skips a bot the owner hid and waits while it comes back, and everything else stays: it asks before every meeting, the heads-up for the call chat, Stop in one click, and stopping on screen lock, sleep and quit. People on the call learn about the notes from the heads-up, not from the bot in a screen share.
- **The pill grew by one button,** so the window while it listens is 840 wide (was 720); the extra area is transparent and lets clicks through. Older desktop apps don't send `canHide`, so the page shows them no Hide button.

## Decision: voice typing learns a word fixed right where it was typed (Diego, 2026-10-20)

Diego: "Do you think we could build something that when I fix a word parakeet got wrong on my computer, just like in the place im typing, our model can learn from that?" and then: "No, i need you to build this first, it is very important to me. Please make sure it works properly on both mac and windows. We cant afford anything going wrong now."

- **How:** after voice typing pastes, the desktop app reads the box it typed into, on the computer, for up to two minutes: macOS through the Accessibility API (the app's Swift helper, `bab-audio-helper text`, which the Accessibility permission for pasting already covers), Windows through UI Automation (one small PowerShell kept running while the owner dictates). When the owner fixes a word there ("pro zee" → "Prozzi"), the word goes into their dictionary as a `correction`, with what it heard as "heard as", and a notification says what was learned. The dictionary is applied after the cleanup, so the next dictation types "Prozzi" whether Parakeet heard it on the computer or the server did.
- **On by default** (*Learn from my fixes* in Voice typing settings; it's on the Mac and Windows only). Every word it learns shows in *Your words* and in the notification, so a wrong one is one click from gone.
- **Only clear cases, learned without asking:** a word replaced by one that sounds like it (the server's own sound-alike key, a little looser for long words), or a word spelled its own way ("github" → "GitHub"). Never a different name ("Mark" → "Sarah"), an everyday word, the same word changed ("Prozzi" → "Prozzi's"), added words, a rewrite, or one of the owner's dictionary words turned into another. The history's *Fix* still suggests more, for the owner to pick.
- **Not a word still being typed:** a fix counts once it has held still for 3 seconds, or for a moment before the box is sent, cleared or dictated into again. Each word once per dictation, up to three.
- **What's read, and what never leaves the computer:** only the box that had the focus when the words were pasted, only while the words it typed are still there (sent, cleared or rewritten: it stops), never a password box (refused by both readers), never more than 20,000 characters. The comparison happens on the computer and nothing read is logged; only the word learned (and what it heard) goes to the server, into the owner's own dictionary. An AI's edit ("make this friendlier") isn't watched: its words weren't misheard.
- **Chrome and Electron apps** (Slack, Discord, Teams, VS Code…) build their accessibility tree only when an assistive app asks. While the owner talks, the app asks the one in front (macOS: `AXManualAccessibility`, as assistive apps do; Windows: asking UI Automation for the focused element), so it's ready when the words are typed.
- **Checked on real computers in CI:** the readers against an Electron app's box and Notepad (Windows) or TextEdit (Mac, with the packaged app's own helper), a fix typed there with real key presses learned, "Mark" → "Sarah" not, a password box refused; and, in the installed Windows app, the whole thing: the real Ctrl + Windows shortcut, a stand-in server that mishears a name, the fix typed with real keys, and the word arriving in the dictionary, with nothing read in the log.
- **Linux:** not yet (AT-SPI would be the way); the setting doesn't show there.
