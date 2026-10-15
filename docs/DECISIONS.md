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

## Build choice (Claude; Diego to confirm): pricing

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

- `/admin` shows aggregates only: revenue estimate, people, bots, messages, brains, trust levels, channels, top apps, approvals, included-model spend and waitlists.
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
- **Limits:** Free 2 hours, Plus 15 hours, Pro 50 hours a month. That costs us about $0.09 / $0.69 / $2.30 a month on Groq. Meetings are capped at 4 hours, and recording stops after 15 minutes of silence.

## Build choice (Claude; Diego to confirm): meeting-notes safety rules

- **It never records before the owner says yes.** No auto-record setting: Granola (botless, like us) was sued on 2026-07-30 and Otter in 2025 over "surreptitious" recording.
- **It only listens while it's visible on the screen,** enforced in code. The desktop app stops when its window is hidden, minimized, off-screen, or the screen locks. The web recorder runs only while its floating window is open. The window is never hidden from screen shares.
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
- **Web recorder choices:**
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
  - Demo mode shows sign-in links on screen, so admin emails also need `ADMIN_SIGNIN_CODE`, a code Diego sets on the server.
  - Other demo accounts can still be claimed by anyone, so testers shouldn't paste real API keys or connect real accounts until real email sign-in (Resend + a verified domain) is set up.
- **Brain:** Diego adds his own Token Factory and Tavily keys in Vercel; keys never go through chat or the repo.

## Decision: a real beta for anyone with the link (Diego, 2026-10-14)

Diego: "I want build-a-bot up and running soon. Not just simulated. We need to move quick. I want to start sending this link out to real users who can start testing it soon, but i dont want them to run into any issues."

- **What testers get:** real email sign-in, chat, web search, Telegram, apps through Composio, meeting notes, Discord and Slack. Anything not set up shows "coming soon"; nothing is simulated.
- **Sign-ups:** anyone with the link. Free-plan limits cap what each person can cost.
- **Deploys:** Claude merges and deploys tested fixes without asking, until launch.
- **Domain:** build-a-bot.site for the site and the sign-in emails (Resend).

## Build choice (Claude; Diego to confirm): what bounds the bill when anyone can sign up (2026-10-14)

Accounts are free and a browser cookie makes one, so per-account limits alone don't bound the cost of the included brain and web search.

- **Before an email is confirmed:** 5 included-brain messages (Diego's call, 2026-10-15; it was 30). Then the bot asks the person to sign in by email (free) to keep going.
- **Monthly searches per plan** (50 on Free) are now enforced. Before, they were counted but never checked.
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
- The first beta testers stay on the Free plan. Paid plans open when Stripe is set up; until then Plus and Pro show "Coming soon" with a waitlist.

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
- **Each role's recipe fits the Free plan:** at most 2 routines and 3 apps, and no sign-ins needed except the job applier's optional Gmail.
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

## Build choice (Claude; Diego to confirm): what real testers see (2026-10-14)

Outside demo mode nothing is simulated. Anything without its service set up says **"Coming soon"** and can't be picked or set up:

- **Channels:** texts and calls until Twilio is set up; the email channel and the bot's own inbox until there's a brand-free mail domain (`BOT_EMAIL_DOMAIN`) with an inbound provider. The Resend key for sign-in no longer turns bot email on. The working channels are web, Telegram, Discord and Slack.
- **Paid plans:** until Stripe is set up. Plus and Pro show "Coming soon" with a waitlist, `plan:plus` and `plan:pro` on `/admin`. At the Free bot limit, the builder says so before step 1.
- **Desktop meeting-notes app:** until there's a signed download (`NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL`). The browser recorder takes notes meanwhile.
- **Web actions:** until Browser Use is set up. The same goes for web search, news and meeting notes without their keys.
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
3. **Bot-sent texts aren't metered.** Only incoming ones count toward the plan.
4. **The monthly spending cap is still a placeholder** (`spentThisMonthUsd` is 0). This is harmless today: no tool reports amounts, so all spending is refused.
5. **One recording per bot isn't enforced by the database.** A double start can make two meetings. It needs a partial unique index (a migration).
6. **Long meetings:** notes for a meeting near 4 hours may exceed Vercel's 300-second function limit. Housekeeping writes notes inside the cron tick.

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
- **The Resend key for sign-in links made bots' email look live** (2026-10-14). Any email key turned the Email channel and "Its own inbox" on, so the live site offered them and tried to send codes from `<handle>@botmail.dev`. Resend refused, and the page got a 500.
  - Bots' email now has its own flag (`live.botEmail`): `BOT_EMAIL_DOMAIN`, plus AgentMail or Resend with its webhook secret. Until then both show as Coming soon, and there's no fallback domain.
  - Outside demo mode, any channel whose service isn't set up shows as Coming soon, and recipes and saved drafts leave it out.

## Open questions (updated 2026-10-14)

1. First users: tinkerers or everyday iPhone users? (unchanged)
2. Pricing: confirm or change the table above. Is Full faith a paid feature?
3. Web actions: confirm Browser Use Cloud (see above), then test with a live key on about 10 real forms before turning it on for everyone.
4. Buy a brand-free domain for bot inboxes; Twilio A2P registration; Composio plan. (The Bridge no longer needs npm: since 2026-10-14 the site serves its own copy and the app shows `npx -y {APP_URL}/downloads/build-a-bot-bridge-<version>.tgz`. The bare npm name stays unclaimed, and nothing points at it.)
5. Trademark clearance before brand spend (unchanged).
6. Meeting notes before launch:
   - a lawyer's review of the consent flow and retention (California § 632, and the Granola complaint's theory);
   - Groq's paid tier (the free tier allows 7,200 audio-seconds an hour per organization);
   - sign and notarize the Mac app. Diego already has an Apple Developer account (2026-10-14); what's needed is a Developer ID Application certificate and notarization credentials in CI secrets, and a Mac or macOS runner to build;
   - whether to merge the desktop app with the Bridge into one "Build-a-bot app".
7. Meeting notes, next: transcription on the owner's own key or on-device (sherpa-onnx with Parakeet), and calendar-based meeting titles.
8. More apps (Diego, 2026-10-15: "lets start trying to think about how we can get more apps integrated we can just think for now no need to build something new"). Options, cheapest first:
   - **The rest of Composio's catalog.** Composio has far more toolkits with its own sign-in than the ~190 we list. A "search all apps" box could offer any of them, with a generic icon and tool list.
   - **Apps that only need an API key** (many marketing, analytics and developer tools). Owners paste the key; it's stored encrypted like other keys.
   - **Our own developer apps** for the "Coming soon" list. Some are quick (an app plus a redirect URL), some need the vendor's review, and a few are hard: X's API is paid, and Spotify only gives full access to large companies.
   - **Our own Google app** instead of Composio's. Then the consent screen says Build-a-bot, but Gmail's scopes need Google's verification and a yearly paid security assessment (CASA).
   - **Remote MCP servers from the official MCP Registry**, curated, since quality varies. Owners can already paste any MCP server's URL.
   - **The long tail through Zapier's MCP server**, where the owner connects their own Zapier account, or a second sign-in provider for apps Composio lacks.
   - Count clicks on "Coming soon" apps to see what testers want first.
