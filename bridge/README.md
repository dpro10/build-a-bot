# Build-a-bot Bridge

Run your Build-a-bot on the AI subscription you already pay for — **Claude Pro/Max** (through Claude Code) or **ChatGPT Plus/Pro** (through Codex) — by letting your own computer do the thinking.

Your login never leaves your machine. The Bridge drives your own, unmodified `claude` or `codex` CLI, signed in by you; Build-a-bot never sees, stores or relays your credentials.

## Requirements

- Node.js 18.17+ (22+ recommended)
- Claude Code (`claude`) signed in with your Claude account, or Codex (`codex`) signed in with your ChatGPT account
- A bot whose brain is set to "Your Claude or ChatGPT plan"

## Set up

1. In the app, open **Bridge (your computer)** and tap **Get a pairing code**.
2. On your computer:

   ```bash
   npx -y https://build-a-bot.site/downloads/build-a-bot-bridge-0.1.0.tgz pair ABCD-1234
   npx -y https://build-a-bot.site/downloads/build-a-bot-bridge-0.1.0.tgz   # keep this running (Ctrl+C to stop)
   ```

   The app shows these commands with the right address and version; copy them from there. The site serves its own copy of the Bridge, so nothing comes from npm. Self-hosting? Add `--server https://your-domain` to `pair`.

3. Message your bot anywhere — web, texts, Telegram, email. Turns for subscription bots are answered on this computer.

Other commands: `status` (am I paired and online?), `doctor` (checks your CLIs and sign-in), `unpair` (forget this computer; revoke it in the app too).

## What it does, exactly

1. Long-polls your Build-a-bot account for turns meant for your subscription bots.
2. For each turn, runs your CLI in an empty folder under `~/.buildabot/work`:
   - **Claude Code:** `claude -p` with built-in tools turned off (`--tools ""`), hooks and slash commands off, no saved sessions, and only your bot's MCP server allowed (`--strict-mcp-config`, `--allowedTools mcp__bab__*`).
   - **Codex:** `codex exec` with a read-only sandbox, shell/exec/web search/plugins turned off, your user config ignored, and only your bot's MCP server.
3. Your bot's tools (email, calendar, GitHub…) come from Build-a-bot over MCP, using a short-lived token that only works for that one turn. **Every tool call is checked by Build-a-bot's policy engine**: your trust level, approvals, hard limits and receipts all apply exactly as they do in the cloud.
4. Sends the answer back; your bot delivers it on the right channel.

If the CLI reports any built-in tool or tries to run a shell command, the Bridge refuses the turn.

## What it never does

- Read, copy or upload your Claude/ChatGPT login (no keychain access, no `~/.claude*`, no `~/.codex/auth.json`).
- Run other people's requests on your plan. Only your own bots, for you; people who message your bot get disclosed-AI replies that can't use your tools.
- Give the CLI access to your files, shell or browser.
- Read API keys from your environment: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and similar are removed for the child process, so it uses your subscription login.

## When your computer is off

Your bot waits and answers when the Bridge is back, or, if you opted in for that bot (Settings → Brain), answers with Build-a-bot's included model in the meantime.

## Files

`~/.buildabot/bridge.json` (this device's token, mode 600) and `~/.buildabot/work/` (temporary per-turn folders).
