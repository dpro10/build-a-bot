> **Historical.** The brief for the first build slice, from the start of the project; the slice was built long ago, and what's current is in `README.md` and `docs/DECISIONS.md`. Its "Rules from day one" still apply.

# Build brief: first slice

For whoever picks this up (a cloud session, a teammate, another agent). Read `README.md` and `docs/DECISIONS.md` first. Where this brief guesses at something Diego hasn't decided, it says so; ask him before going far down that path.

## Goal of the first slice

A person lands on build-a-bot.site, makes a bot in four taps, and is chatting with it on the web within a minute. The bot sends the first message.

## Scope

**In:**
1. **Setup flow, four screens** (see README): face and name → what it helps with → where to talk (web chat works; Telegram shows "coming soon") → brain.
2. **Brain step:** "Free" works (Token Factory). "Use my own key" works for an OpenAI-compatible or Anthropic key. "Use my Claude / ChatGPT subscription" is shown but marked "coming soon".
3. **Web chat** with the bot, streaming, which opens with the bot's own first message based on the job they picked.
4. **One tool:** web search through Tavily.
5. **Persona:** each avatar has a default personality; the job chips shape the system prompt.

**Out (later):** Telegram, subscriptions, browser actions, accounts beyond a minimal sign-in, payments, Cookbook backend wiring.

## Stack (Claude's proposal; adjust if Diego says otherwise)

- Next.js (App Router) + TypeScript + Tailwind, deployed on Vercel (the domain's DNS is already there).
- Vercel AI SDK for streaming chat and tool calls. Token Factory is OpenAI-compatible, so use the OpenAI-compatible provider pointed at `https://api.tokenfactory.nebius.com/v1/`. Check the exact model ids in Token Factory's model list; Nemotron 3.5 Lightning is the default.
- Storage for the prototype: keep it minimal (e.g. a bot record in a small DB). Long term each bot becomes a Cookbook agent; don't design against that.

## Rules from day one

- Never reuse a subscription login on our servers (see `docs/DECISIONS.md`).
- Users' own API keys: encrypt at rest, never log them, never send them to the browser after entry.
- Say it's an AI. 18+ only. Nothing that looks like a bear, a toy or a "Workshop".
- Keep "build-a-bot" out of anything a bot owns (handles, email addresses).
- Nemotron is a reasoning model: give it a generous `max_tokens` or replies come back empty.

## UI

Extremely simple, clean and modern; anyone can do it. One question per screen, big tap targets, works on a phone first. Original avatars (a small set, 4 to 6). Build-a-bot has its own look, not Cookbook's.

## Environment variables

- `TOKEN_FACTORY_API_KEY`: Nebius Token Factory.
- `TAVILY_API_KEY`: Tavily.
- Set them in the cloud environment's settings (claude.ai/code → environment) and in Vercel. Never commit them.

## Definition of done for this slice

- Deployed to a Vercel preview URL.
- On a phone: pick an avatar, a name, a job, Free brain → the bot greets you → ask it something current → it searches and answers.
- A short note in README.md on what was built and what's next.
