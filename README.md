# Build-a-bot

Anyone makes their own AI agent in about a minute: pick a face, give it a name, choose a brain (or connect the AI subscription they already pay for), and it lives in their texts.

- **Site:** build-a-bot.site. The domain is owned (registered 2026-10-13 at Name.com, DNS on Vercel); nothing is deployed yet.
- **Status (2026-10-13):** idea and research. Nothing built. Start building from `BUILD.md`.

## Decided (Diego, 2026-10-13)

- **Separate from Cookbook at first:** its own brand and site. When people want their bots to talk to each other, that happens in Cookbook.
- **Reuse the hackathon stack:** Nebius Token Factory for open-weight models, Tavily for web search.
- **Bots act on the web:** they need to fill things out online. Pick an approach from open-source browser agents.
- **Dead-simple setup:** choose an avatar from a small set, a name, and a model, or connect a subscription you already pay for. It must look clean and modern and be easy enough for anyone.
- **Keep the name** Build-a-bot.
- **The user picks the model.** Don't apply for Sign in with ChatGPT yet. Subscriptions should run the way Cookbook's Bridge does: the user's own CLI, signed in by them. See `docs/DECISIONS.md`.

## Proposed (Claude; not decided yet)

**Separate on the outside, Cookbook on the inside.**
- Every bot is a Cookbook agent under the hood: its own identity in a private workspace, with its memory and activity log in Cookbook.
- Letting bots talk later then means adding them to one shared room, not moving data between products.
- Build a new, small app that uses Cookbook as its backend, the way Chef's app (cookbook-dispatch) works. Don't build inside the Cookbook codebase.

**Setup flow, four screens:**
1. **Pick a face and a name.** Each avatar comes with a default personality. Use original characters, no bears.
2. **What should it help with?** Inbox, Reminders, Research, Errands, School, or Something else. This step is what keeps people coming back.
3. **Where do you want to talk?** Telegram creates their own named bot in one tap. Web chat is always there; iMessage comes later.
4. **Brain:** Free (an open model on Token Factory), a subscription they already pay for, or their own API key.

Then the bot messages them first, within a minute.

**Web actions:**
- Try Stagehand (TypeScript, MIT) first, driving a cloud browser (Browserbase, Browser Use Cloud or Steel).
- Show a preview before anything is submitted. No payments in v1.
- First test whether Nemotron can reliably fill about 10 real forms.

**Safety and timing:**
- Enforce safety rules in code from day one. See "Minimum to ship" in the research.
- Design now; build after the hackathon (Oct 30).

## What's real right now

**Connecting a subscription** (details in `docs/DECISIONS.md`):
- **ChatGPT:** allowed on the user's own computer (locally hosted). From our cloud it needs OpenAI's approval via Sign in with ChatGPT, which we are not applying for yet. Never put a Codex login on our servers.
- **Claude:** allowed on the user's own computer through their own Claude Code. In the cloud, only as the unmodified Claude Code in a per-user sandbox, signed in on Anthropic's own page; we never store the token. Max plans include $100–200/mo of API credit usable through an API key.
- **Gemini:** API keys only.

**Channels:**
- Open today: Telegram, Discord DMs, and an email address the bot owns.
- iMessage: only through gateways Apple hasn't sanctioned.
- WhatsApp: bans general-purpose assistants in the US.
- Reading someone's Gmail: needs Google's yearly CASA security audit.

**Costs:**
- **Model:** Nemotron 3.5 Lightning on Token Factory cost $0.06 per million input tokens and $0.24 per million output (checked for the hackathon). That's about $4 to $5 a month per active bot.
- **Search:** Tavily includes 1,000 free credits a month, then $0.008 per credit; it's free for students.
- **Reachability:** Token Factory, Tavily and the cloud-browser hosts all work on Diego's network. Kimi, DeepSeek and Together AI are blocked there.

**Name:**
- Build-A-Bear defeated a BUILD A BOT trademark application in 2004 (for toys).
- Keep the bots' email addresses and handles free of the brand name, so a forced rename doesn't break contacts.
- No bears or "Workshop", and nothing aimed at kids.
- Get a clearance check before spending on the brand. The Texas A&M Law Trademark Clinic (tmc-info@law.tamu.edu) is in the USPTO's free clinic program.

**Law:** say it's an AI, publish a crisis protocol, and launch 18+ only.

## Open questions

1. First users: tinkerers, or everyday iPhone users? A 3-week hand-built test with 5 people could decide.
2. Pricing: who pays for the free brain, what the free tier's limits are, and what the paid plan costs.
3. Which browser agent, and which model drives it.
4. Claude subscriptions in the cloud (a sandbox per user) in v1, or later?
5. When the user's computer is asleep, does a subscription bot wait, or fall back to Free (opt-in)?

## Files

- `BUILD.md`: what to build first, and how.
- `docs/DECISIONS.md`: the workspace's memory notes (decisions, gotchas, open threads), copied from Cookbook.
- `docs/research-2026-10-13.md`: market, channels, models and costs, safety, law, name, and sources.

Prior work lives in the Cookbook (dev) workspace:
- the same research file;
- the "Text your agents" doc (2026-10-01);
- Chef / cookbook-dispatch, from the hackathon;
- the DP jr. setup notes.
