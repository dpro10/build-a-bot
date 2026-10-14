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
