# The Bridge, inside the desktop app (plan, 2026-10-17)

Diego: "the bridge should definetly be apart of this app". Then: "write up the plan for the bridge merge, and honestly go ahead and just get it done."

## What the Bridge is (and isn't)

A bot whose brain is **Your Claude** or **Your ChatGPT** thinks on its owner's computer: Build-a-bot queues the turn, the Bridge runs the owner's own `claude -p` or `codex exec` (signed in by them) with every built-in tool off, and the bot's tools come back from Build-a-bot over MCP, where each call still goes through the policy engine. The Bridge never gives the AI the owner's files, shell or browser, and never touches their login.

Until now it was a separate terminal program (`npx -y https://build-a-bot.site/downloads/build-a-bot-bridge-0.1.0.tgz`). Most people won't open a terminal, so the desktop app does it instead.

## The result

One download (the desktop app) does voice typing, meeting notes and the Bridge:

1. Pair the app once (the same code as before).
2. Point a bot at Your Claude or Your ChatGPT on the website.
3. The app notices and starts thinking for that bot on this computer, with Claude Code or Codex if it's installed and signed in. The menu bar says so, with a switch to turn it off on this computer.

The terminal Bridge stays for Linux servers and people who prefer it. Both run the same code (`bridge/runner.mjs`).

## How it works

**Desktop app (`desktop/src/main/bridge/`)**

- `runner.mjs`: the turn itself: build the CLI's arguments, run it, read its answer, refuse a turn whose CLI shows any built-in tool. It's a copy of `bridge/runner.mjs`, and a test fails if the two drift apart.
- `program-path.mjs`: apps opened from the Finder don't get the terminal's PATH, so `claude` in `/opt/homebrew/bin` or `~/.local/bin` wouldn't be found. It asks the owner's login shell for its PATH once (with a timeout), and adds the usual install folders.
- `index.mjs`: the `Bridge` in the app: on when this computer should think (an owner's bot uses their plan, and they haven't turned it off here), off otherwise. While on, it long-polls `/api/bridge/jobs` with the device token, runs one turn at a time, reports each result, and says it's alive every 30 seconds with which CLIs it found. Off (or quitting) tells the server it has none, so bots never wait on a computer that isn't listening.
- The tray gets a short section (status, the switch, and "Get Claude Code…" when it's missing), and the pairing window a card.
- Work folders live in the app's own data folder (`<userData>/bridge/work/<bot>`), emptied after every turn and removed on uninstall.

**Windows, done properly.** The terminal Bridge ran CLIs through `cmd.exe` (`shell: true`), which drops the empty `--tools ""` (turning every built-in tool back on until the refusal check caught it) and mangles JSON and multi-line arguments. The runner resolves the real program instead: a `.exe` runs directly; an npm `.cmd` shim is read to find the `.exe` or script it points at, which runs without a shell; the hooks setting goes in a file, not the command line; and every window stays hidden (`windowsHide`).

**Never.** The same promises as the terminal Bridge, plus the app's own: no API keys passed to the CLI (it uses the plan), nothing from a turn (prompt, transcript, answer, MCP token) logged or kept after it, the device token never given to the CLI or a page. Claude Code's own session markers from the environment are dropped too, so a nested session can't confuse it.

**Server**

- `/api/desktop/session` says which of the owner's bots think with their plan (`subscription: "claude" | "codex" | null`), so the app knows when to turn the Bridge on.
- A desktop app that has found Claude Code or Codex counts as a paired Bridge (`bridgePaired`), so a bot whose computer is asleep says so instead of "pair your computer".
- The Bridge page leads with the desktop app (download, pair, done) and keeps the terminal commands under "Prefer the terminal?". Device rows show what each computer does: meeting notes, voice typing, thinking with Claude Code or Codex.

## Tests

- Runner: the exact arguments (no shell on any platform, the empty `--tools`, the settings file), refusing built-in tools and shell commands, sign-in and usage-limit errors, the npm shim on Windows, PATH from the login shell.
- A pretend `claude` (a script that records what it was given and answers in Claude Code's stream format) run by the real runner on macOS, Linux and Windows in CI, including through an npm-style `.cmd` shim.
- The Bridge in the app with a pretend server: claims a turn, reports it, heartbeats its CLIs, goes quiet when turned off or when no bot needs it, reports a turn cut off by quitting, never logs a turn's words.
- Site: the session's `subscription` field; a desktop app with Claude Code is a paired, online Bridge.
- End to end (`desktop/e2e/bridge.e2e.mjs`): the app, started with the bare PATH of an app opened from the Finder, pairs with a dev server, finds Claude Code through the login shell, and answers a web chat message. Run on Diego's Mac with a stand-in `claude` and with his real, signed-in Claude Code.

## Later

- The server's long-poll checks the database every second per listening computer. Fine for now (only owners with a plan bot listen); a push channel would be kinder at scale.
- A quick-chat box from a shortcut, and the dashboard in an app window (see the 2026-10-17 conversation).
