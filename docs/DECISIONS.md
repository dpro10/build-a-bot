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
- **Slack:** a per-bot app from a manifest.
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

## Gotchas found while building

- Nemotron and other reasoning models: thinking eats `max_tokens`. Included models get 8–16K, and thinking is off on "Quick".
- Avatars and the logo use per-instance SVG gradient ids. A duplicate id inside a hidden copy (the desktop sidebar on phones) blanks every later copy.
- Custom OpenAI-compatible endpoints are checked against private and metadata addresses and may not redirect (SSRF).
- `ENCRYPTION_KEY` must be shared by every server instance. Production refuses to start with `DATABASE_URL` but no key.
- `next dev` appends Next.js agent rules to AGENTS.md unless `agentRules: false` (set in `next.config.ts`).
- Per-minute Vercel Cron needs a paid plan; otherwise an external pinger calls `/api/cron/tick`.

## Open questions (updated 2026-10-14)

1. First users: tinkerers or everyday iPhone users? (unchanged)
2. Pricing: confirm or change the table above. Is Full faith a paid feature?
3. Web actions: confirm Browser Use Cloud (see above), then test with a live key on about 10 real forms before turning it on for everyone.
4. Buy a brand-free domain for bot inboxes; Twilio A2P registration; Composio plan.
5. Trademark clearance before brand spend (unchanged).
