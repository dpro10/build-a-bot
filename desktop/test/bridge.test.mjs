import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  childEnv,
  claudeArgs,
  codexArgs,
  prepareWorkdir,
  readClaude,
  readCodex,
  reportable,
  resolveCommand,
  runTurn,
  shimTarget,
} from "../src/main/bridge/runner.mjs";
import { installDirs, loginShellPath, mergePath, parseShellPath, registryPath } from "../src/main/bridge/program-path.mjs";
import { Bridge } from "../src/main/bridge/index.mjs";
import { trayItems } from "../src/main/tray-menu.mjs";
import { Settings } from "../src/main/store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("bridge: the app's runner is the terminal Bridge's, byte for byte", () => {
  const app = fs.readFileSync(path.join(HERE, "..", "src", "main", "bridge", "runner.mjs"), "utf8");
  const cli = fs.readFileSync(path.join(HERE, "..", "..", "bridge", "runner.mjs"), "utf8");
  assert.equal(app, cli, "copy bridge/runner.mjs to desktop/src/main/bridge/runner.mjs");
});

// ---------------------------------------------------------------------------
// The runner

test("bridge: Claude Code runs with every built-in tool off, only the bot's MCP server, and its settings in a file", () => {
  const args = claudeArgs({ dir: "/w/bot_1", model: "sonnet" });
  const at = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(at("--tools"), "", "an empty --tools: no built-in tools");
  assert.equal(at("--allowedTools"), "mcp__bab__*");
  assert.ok(args.includes("--strict-mcp-config"));
  assert.equal(at("--mcp-config"), path.join("/w/bot_1", ".bab-mcp.json"));
  assert.equal(at("--settings"), path.join("/w/bot_1", ".bab-settings.json"), "a file, not JSON on the command line");
  assert.ok(!args.some((a) => a.includes("{")), "no JSON anywhere on the command line");
  assert.equal(at("--permission-mode"), "dontAsk");
  assert.equal(at("--permission-prompts"), "none");
  assert.equal(at("--model"), "sonnet");
  assert.ok(args.includes("--no-session-persistence") && args.includes("--disable-slash-commands"));
  assert.ok(!claudeArgs({ dir: "/w", permissionPrompts: false }).includes("--permission-prompts"), "older Claude Code: without the newer flag");
  assert.ok(!claudeArgs({ dir: "/w", model: "default" }).includes("--model"));
});

test("bridge: a Claude Code turn that shows a built-in tool is refused, whatever it answered", () => {
  const out = [
    JSON.stringify({ type: "system", subtype: "init", model: "claude-x", tools: ["mcp__bab__send_email", "Bash"] }),
    JSON.stringify({ type: "result", result: "Done, I ran it.", total_cost_usd: 0.01 }),
  ].join("\n");
  const r = readClaude(out, "");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "refused");
  assert.match(r.error ?? "", /Bash/);
  assert.equal(r.text, undefined, "the answer isn't passed on");
});

test("bridge: Claude Code's answer, sign-in and usage-limit errors are read from its stream", () => {
  const ok = readClaude(
    [JSON.stringify({ type: "system", subtype: "init", model: "claude-x", tools: ["mcp__bab__web_search"] }), JSON.stringify({ type: "result", result: "Hi Dana!", total_cost_usd: 0.002 })].join("\n"),
    "",
  );
  assert.deepEqual(ok, { ok: true, text: "Hi Dana!", error: undefined, costUsd: 0.002, model: "claude-x" });
  const signin = readClaude(JSON.stringify({ type: "assistant", error: "authentication_failed" }), "");
  assert.equal(signin.reason, "signin");
  assert.match(signin.error ?? "", /isn't signed in/);
  assert.equal(readClaude(JSON.stringify({ type: "assistant", error: "rate_limit" }), "").reason, "limit");
  const nothing = readClaude("", "boom");
  assert.equal(nothing.ok, false);
  assert.equal(nothing.error, "boom");
});

test("bridge: a Codex turn that runs a shell command is refused; its answer and sign-in errors are read", () => {
  const refused = readCodex(
    [JSON.stringify({ type: "item.completed", item: { type: "command_execution" } }), JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "ok" } })].join("\n"),
    "",
    null,
  );
  assert.equal(refused.reason, "refused");
  assert.equal(refused.ok, false);
  assert.deepEqual(readCodex(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Hello" } }), "", null), {
    ok: true,
    text: "Hello",
    error: undefined,
    model: "codex",
  });
  assert.equal(readCodex("", "", "From the file").text, "From the file");
  assert.equal(readCodex(JSON.stringify({ type: "error", message: "Not logged in" }), "", null).reason, "signin");
});

test("bridge: Codex's instructions go on its command line, except on Windows when they wouldn't fit", () => {
  const short = codexArgs({ dir: "/w", system: "Be kind.", mcpUrl: "https://x/api/mcp/bot_1", platform: "win32" });
  assert.equal(short.inPrompt, false);
  assert.ok(short.args.includes(`developer_instructions=${JSON.stringify("Be kind.")}`));
  assert.equal(short.args.at(-1), "-", "the prompt comes on stdin");
  const long = "x".repeat(40_000);
  assert.equal(codexArgs({ dir: "C:\\w", system: long, mcpUrl: "https://x", platform: "win32" }).inPrompt, true);
  assert.ok(!codexArgs({ dir: "C:\\w", system: long, mcpUrl: "https://x", platform: "win32" }).args.some((a) => a.startsWith("developer_instructions=")));
  assert.equal(codexArgs({ dir: "/w", system: long, mcpUrl: "https://x", platform: "darwin" }).inPrompt, false, "macOS takes long command lines");
  const sandbox = short.args[short.args.indexOf("--sandbox") + 1];
  assert.equal(sandbox, "read-only");
  for (const f of ["shell_tool", "unified_exec", "plugins", "hooks"]) assert.ok(short.args.join(" ").includes(`--disable ${f}`));
});

test("bridge: the CLI gets no API keys (so it uses the plan) and no other Claude Code session's markers", () => {
  const env = childEnv(
    {
      PATH: "/usr/bin",
      HOME: "/Users/dana",
      ANTHROPIC_API_KEY: "sk-ant",
      OPENAI_API_KEY: "sk",
      CLAUDE_CODE_OAUTH_TOKEN: "t",
      CLAUDECODE: "1",
      CLAUDE_CODE_SESSION_ID: "s",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      ELECTRON_RUN_AS_NODE: "1",
      CLAUDE_CODE_USE_BEDROCK: "1",
    },
    { BAB_MCP_TOKEN: "m" },
  );
  assert.deepEqual(Object.keys(env).sort(), ["BAB_MCP_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "HOME", "PATH"]);
});

test("bridge: reported results carry only the server's fields", () => {
  assert.deepEqual(reportable({ ok: false, error: "x".repeat(3000), reason: "signin" }), { ok: false, error: "x".repeat(2000) });
  assert.deepEqual(reportable({ ok: true, text: "hi", costUsd: 0.1, model: "m" }), { ok: true, text: "hi", costUsd: 0.1, model: "m" });
});

// ---------------------------------------------------------------------------
// Finding the CLI (Windows, without a shell)

/** A pretend file system: path → contents. */
function fakeFs(files) {
  const norm = (p) => p.toLowerCase();
  const map = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]));
  return {
    statSync(p) {
      if (!map.has(norm(p))) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { isFile: () => true };
    },
    accessSync(p) {
      if (!map.has(norm(p))) throw new Error("ENOENT");
    },
    readFileSync(p) {
      if (!map.has(norm(p))) throw new Error("ENOENT");
      return map.get(norm(p));
    },
  };
}

const NPM_EXE_SHIM = `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n`;
const NPM_JS_SHIM = `@ECHO off\r\nSETLOCAL\r\nCALL :find_dp0\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n)\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n`;
const PNPM_SHIM = `@SETLOCAL\r\n@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\..\\pnpm\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n) ELSE (\r\n  node  "%~dp0\\..\\pnpm\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n)\r\n`;

test("bridge: an npm or pnpm .cmd shim is read for the program it runs", () => {
  const npm = "C:\\Users\\Dana\\AppData\\Roaming\\npm";
  assert.equal(shimTarget(NPM_EXE_SHIM, npm), `${npm}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`);
  assert.equal(shimTarget(NPM_JS_SHIM, npm), `${npm}\\node_modules\\@openai\\codex\\bin\\codex.js`);
  assert.equal(shimTarget(PNPM_SHIM, "C:\\Users\\Dana\\AppData\\Local\\pnpm"), "C:\\Users\\Dana\\AppData\\Local\\pnpm\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js");
  assert.equal(shimTarget("@echo off\r\nnode cli.js %*", npm), null);
});

test("bridge: on Windows, a .exe runs directly and a shim's program runs without cmd.exe", () => {
  const npm = "C:\\Users\\Dana\\AppData\\Roaming\\npm";
  const local = "C:\\Users\\Dana\\.local\\bin";
  const env = { Path: `C:\\Windows\\system32;${npm};${local}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  const claudeExe = `${npm}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
  const codexJs = `${npm}\\node_modules\\@openai\\codex\\bin\\codex.js`;

  // The native installer's claude.exe (later on PATH) loses to npm's shim (earlier): PATH order wins.
  let files = fakeFs({ [`${npm}\\claude.cmd`]: NPM_EXE_SHIM, [claudeExe]: "", [`${local}\\claude.exe`]: "" });
  assert.deepEqual(resolveCommand("claude", { env, platform: "win32", fs: files }), { file: claudeExe, args: [] });
  files = fakeFs({ [`${local}\\claude.exe`]: "" });
  assert.deepEqual(resolveCommand("claude", { env, platform: "win32", fs: files }), { file: `${local}\\claude.exe`, args: [] });

  // A Node script: Node from the shim's folder, then from PATH, then the app's own (Electron as Node).
  files = fakeFs({ [`${npm}\\codex.cmd`]: NPM_JS_SHIM, [codexJs]: "", [`${npm}\\node.exe`]: "" });
  assert.deepEqual(resolveCommand("codex", { env, platform: "win32", fs: files }), { file: `${npm}\\node.exe`, args: [codexJs] });
  files = fakeFs({ [`${npm}\\codex.cmd`]: NPM_JS_SHIM, [codexJs]: "", "C:\\Windows\\system32\\node.exe": "" });
  assert.deepEqual(resolveCommand("codex", { env, platform: "win32", fs: files }), { file: "C:\\Windows\\system32\\node.exe", args: [codexJs] });
  files = fakeFs({ [`${npm}\\codex.cmd`]: NPM_JS_SHIM, [codexJs]: "" });
  const electron = { file: "C:\\Program Files\\Build-a-bot\\Build-a-bot.exe", args: [], env: { ELECTRON_RUN_AS_NODE: "1" } };
  assert.deepEqual(resolveCommand("codex", { env, platform: "win32", fs: files, node: electron }), { file: electron.file, args: [codexJs], env: { ELECTRON_RUN_AS_NODE: "1" } });
  assert.equal(resolveCommand("codex", { env, platform: "win32", fs: files }), null, "no way to run a Node script: not found");

  // A shim pointing at something missing, or nothing at all.
  assert.equal(resolveCommand("claude", { env, platform: "win32", fs: fakeFs({ [`${npm}\\claude.cmd`]: NPM_EXE_SHIM }) }), null);
  assert.equal(resolveCommand("claude", { env, platform: "win32", fs: fakeFs({}) }), null);
});

test("bridge: on macOS and Linux, the first executable on PATH", { skip: process.platform === "win32" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bab-path-"));
  const a = path.join(dir, "a");
  const b = path.join(dir, "b");
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  fs.writeFileSync(path.join(a, "claude"), "not executable");
  fs.writeFileSync(path.join(b, "claude"), "#!/bin/sh\n", { mode: 0o755 });
  assert.deepEqual(resolveCommand("claude", { env: { PATH: `${a}:${b}` }, platform: process.platform }), { file: path.join(b, "claude"), args: [] });
  assert.equal(resolveCommand("codex", { env: { PATH: `${a}:${b}` }, platform: process.platform }), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Where the owner's programs are

test("bridge: the login shell's PATH is read between markers, whatever the profile prints", async () => {
  assert.equal(parseShellPath("Welcome back!\n__BAB_PATH__/opt/homebrew/bin:/usr/bin__BAB_PATH__"), "/opt/homebrew/bin:/usr/bin");
  assert.equal(parseShellPath("no markers"), null);
  /** @type {any[]} */
  const calls = [];
  const run = (file, args, opts, cb) => {
    calls.push({ file, args, opts });
    cb(null, "motd\n__BAB_PATH__/Users/dana/.local/bin:/usr/bin__BAB_PATH__");
  };
  assert.equal(await loginShellPath({ env: { SHELL: "/bin/zsh" }, platform: "darwin", run }), "/Users/dana/.local/bin:/usr/bin");
  assert.equal(calls[0].file, "/bin/zsh");
  assert.equal(calls[0].args[0], "-ilc", "a login, interactive shell (where nvm and Homebrew are set up)");
  assert.equal(calls[0].opts.timeout, 5000);
  assert.equal(calls[0].opts.env.DISABLE_AUTO_UPDATE, "true");
  await loginShellPath({ env: { SHELL: "/opt/homebrew/bin/fish" }, platform: "darwin", run });
  assert.match(calls[1].args[1], /string join : \$PATH/, "fish keeps PATH as a list");
  const failed = (file, args, opts, cb) => cb(new Error("timed out"), "");
  assert.equal(await loginShellPath({ env: {}, platform: "linux", run: failed }), null);
});

test("bridge: Windows reads PATH again from the registry, with %VARIABLES% filled in", async () => {
  const run = (file, args, opts, cb) => {
    assert.equal(file, "reg.exe");
    if (args[1].startsWith("HKLM")) cb(null, "\r\nHKEY_LOCAL_MACHINE\\...\r\n    Path    REG_EXPAND_SZ    %SystemRoot%\\system32;C:\\Program Files\\nodejs\\\r\n");
    else cb(null, "\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\.local\\bin;%APPDATA%\\npm\r\n");
  };
  const env = { SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\Dana", APPDATA: "C:\\Users\\Dana\\AppData\\Roaming" };
  assert.equal(await registryPath({ env, run }), "C:\\Windows\\system32;C:\\Program Files\\nodejs\\;C:\\Users\\Dana\\.local\\bin;C:\\Users\\Dana\\AppData\\Roaming\\npm");
});

test("bridge: PATH parts are merged in order without repeats, plus the usual install folders", () => {
  assert.equal(mergePath(["/a:/b", "/b:/c", null, "/a"], "darwin"), "/a:/b:/c");
  assert.equal(mergePath(["C:\\A;c:\\a", "C:\\B"], "win32"), "C:\\A;C:\\B");
  const mac = installDirs("/Users/dana", "darwin", {});
  assert.ok(mac.includes("/Users/dana/.local/bin") && mac.includes("/opt/homebrew/bin") && mac.includes("/usr/local/bin"));
  const win = installDirs("C:\\Users\\Dana", "win32", { APPDATA: "C:\\Users\\Dana\\AppData\\Roaming" });
  assert.ok(win.includes("C:\\Users\\Dana\\.local\\bin") && win.includes("C:\\Users\\Dana\\AppData\\Roaming\\npm"));
});

// ---------------------------------------------------------------------------
// A real turn, run by the real runner, against a pretend `claude`

/** A pretend Claude Code: records what it was given, then answers like Claude Code's stream-json. */
const FAKE_CLAUDE = `
const fs = require("node:fs");
const path = require("node:path");
const out = process.env.BAB_FAKE_OUT;
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (stdin += d));
process.stdin.on("end", () => {
  const args = process.argv.slice(2);
  if (args[0] === "--version") { process.stdout.write("9.9.9 (Claude Code)\\n"); return; }
  const at = (f) => args[args.indexOf(f) + 1];
  const record = {
    args,
    stdin,
    cwd: process.cwd(),
    settings: JSON.parse(fs.readFileSync(at("--settings"), "utf8")),
    mcp: JSON.parse(fs.readFileSync(at("--mcp-config"), "utf8")),
    persona: fs.readFileSync(at("--system-prompt-file"), "utf8"),
    env: { apiKey: "ANTHROPIC_API_KEY" in process.env, claudecode: "CLAUDECODE" in process.env, path: Boolean(process.env.PATH || process.env.Path) },
  };
  fs.writeFileSync(out, JSON.stringify(record));
  if (process.env.BAB_FAKE_SLOW) { setTimeout(() => {}, 60000); return; }
  process.stdout.write(JSON.stringify({ type: "system", subtype: "init", model: "fake-claude", tools: ["mcp__bab__send_email"] }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "result", result: "Lunch is at noon.", total_cost_usd: 0.0123 }) + "\\n");
});
`;

/** Installs the pretend claude in a folder whose name has a space and accents (like a real user folder). */
function installFakeClaude() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bab-fake-"));
  const bin = path.join(root, "José Muñoz", "bin");
  fs.mkdirSync(bin, { recursive: true });
  const script = path.join(bin, "node_modules", "fake-claude", "cli.js");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, FAKE_CLAUDE);
  if (process.platform === "win32") {
    // npm's shim, as `npm install -g` writes it: the runner reads it and runs the script with Node, no cmd.exe.
    fs.writeFileSync(path.join(bin, "claude.cmd"), NPM_JS_SHIM.replace("@openai\\codex\\bin\\codex.js", "fake-claude\\cli.js"));
  } else {
    fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  }
  return { root, bin };
}

const job = (over = {}) => ({
  id: "job_1",
  botId: "bot_1",
  mcpToken: "mcp-token-for-this-turn",
  input: { cli: "claude", model: "default", system: "You are Inky, Dana's bot.", transcript: "Owner: when is lunch?", directive: null, mcpUrl: "https://build-a-bot.site/api/mcp/bot_1", ...over },
});

test("bridge: a real run: the CLI gets the empty --tools, the files, the prompt on stdin, and no API key", async () => {
  const { root, bin } = installFakeClaude();
  const out = path.join(root, "seen.json");
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const env = { ...process.env, [pathKey]: `${bin}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ""}`, BAB_FAKE_OUT: out, ANTHROPIC_API_KEY: "sk-ant-should-not-pass", CLAUDECODE: "1" };
  const claude = resolveCommand("claude", { env, platform: process.platform });
  assert.ok(claude, "found the pretend claude");
  const dir = prepareWorkdir(path.join(root, "work"), "bot_1");
  fs.writeFileSync(path.join(dir, "leftover.txt"), "from before");
  const r = await runTurn(job(), { dir: prepareWorkdir(path.join(root, "work"), "bot_1"), commands: { claude, codex: null }, env });
  assert.deepEqual(r, { ok: true, text: "Lunch is at noon.", error: undefined, costUsd: 0.0123, model: "fake-claude" });
  const seen = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(seen.args[seen.args.indexOf("--tools") + 1], "", "the empty --tools arrived as an empty argument");
  assert.deepEqual(seen.settings, { disableAllHooks: true });
  assert.equal(seen.mcp.mcpServers.bab.headers.Authorization, "Bearer mcp-token-for-this-turn");
  assert.equal(seen.persona, "You are Inky, Dana's bot.");
  assert.match(seen.stdin, /Owner: when is lunch\?/);
  assert.deepEqual(seen.env, { apiKey: false, claudecode: false, path: true });
  assert.equal(fs.realpathSync(seen.cwd), fs.realpathSync(dir), "it ran in the bot's own empty folder");
  assert.deepEqual(fs.readdirSync(dir), [], "nothing from the turn is left behind (persona, MCP token, settings)");
  fs.rmSync(root, { recursive: true, force: true });
});

test("bridge: a turn stopped midway (quitting) ends the CLI and says why", async () => {
  const { root, bin } = installFakeClaude();
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const env = { ...process.env, [pathKey]: `${bin}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ""}`, BAB_FAKE_OUT: path.join(root, "seen.json"), BAB_FAKE_SLOW: "1" };
  const claude = resolveCommand("claude", { env, platform: process.platform });
  const ac = new AbortController();
  const t0 = Date.now();
  setTimeout(() => ac.abort(), 1500);
  const r = await runTurn(job(), { dir: prepareWorkdir(path.join(root, "work"), "bot_1"), commands: { claude, codex: null }, env, signal: ac.signal });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "stopped");
  assert.ok(Date.now() - t0 < 15_000, "it didn't wait for the CLI to finish on its own");
  fs.rmSync(root, { recursive: true, force: true });
});

test("bridge: a missing CLI says so", async () => {
  const r = await runTurn(job({ cli: "codex" }), { dir: fs.mkdtempSync(path.join(os.tmpdir(), "bab-w-")), commands: { claude: null, codex: null }, env: {} });
  assert.deepEqual(r, { ok: false, error: "Codex isn't installed on this computer.", reason: "missing" });
});

// ---------------------------------------------------------------------------
// The Bridge in the app

/** Real timers, but the 30 s heartbeat and 5 min recheck never fire during a test. */
const timers = { setTimeout, clearTimeout, setInterval: () => ({ unref() {} }), clearInterval: () => {} };

function harness({ bots = [{ id: "bot_1", name: "Inky", subscription: "claude" }], clis = { claude: "2.1.302 (Claude Code)", codex: null }, jobs = [], run, queued = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bab-bridge-"));
  const settings = new Settings(path.join(dir, "settings.json"));
  const calls = { heartbeats: [], results: [], refreshes: 0, polls: 0, logs: [], notes: [] };
  const pending = [...jobs];
  const api = {
    async bridgeHeartbeat(c) {
      calls.heartbeats.push(c);
      return { ok: true, queued };
    },
    bridgeJob({ signal } = {}) {
      calls.polls += 1;
      const next = pending.shift();
      if (next) return Promise.resolve(next);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(null), 20);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(Object.assign(new Error("aborted"), { status: 0 }));
        });
      });
    },
    async bridgeResult(id, body) {
      calls.results.push({ id, body });
      return { ok: true };
    },
  };
  const account = {
    device: { token: "bab_dev_secret" },
    bots: () => bots,
    refresh: async () => {
      calls.refreshes += 1;
    },
  };
  const found = { commands: { claude: clis.claude ? { file: "/bin/claude", args: [] } : null, codex: clis.codex ? { file: "/bin/codex", args: [] } : null }, clis, env: { PATH: "/bin" } };
  const bridge = new Bridge({
    api: /** @type {any} */ (api),
    account: /** @type {any} */ (account),
    settings,
    workRoot: path.join(dir, "work"),
    find: async () => found,
    run: run ?? (async () => ({ ok: true, text: "Lunch is at noon." })),
    notify: (n) => calls.notes.push(n),
    timers: /** @type {any} */ (timers),
    log: (m) => calls.logs.push(m),
    platform: "darwin",
  });
  return { bridge, calls, settings, account, pending, dir };
}

const until = async (fn, ms = 3000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
};

test("bridge app: with a bot on the owner's plan and Claude Code found, it says so, takes a turn, answers it", async () => {
  const seen = [];
  const h = harness({
    jobs: [job()],
    run: async (j, o) => {
      seen.push({ j, o });
      return { ok: true, text: "Lunch is at noon.", costUsd: 0.01, model: "claude-x", reason: undefined };
    },
  });
  h.bridge.start();
  await until(() => h.calls.results.length === 1);
  assert.deepEqual(h.calls.heartbeats[0], { claude: "2.1.302 (Claude Code)", codex: null }, "the first heartbeat already names Claude Code");
  assert.equal(h.bridge.mode, "listening");
  assert.deepEqual(h.calls.results[0], { id: "job_1", body: { ok: true, text: "Lunch is at noon.", costUsd: 0.01, model: "claude-x" } });
  assert.equal(seen[0].o.commands.claude.file, "/bin/claude");
  assert.ok(seen[0].o.dir.startsWith(path.join(h.dir, "work")), "turns run in the app's own folder");
  assert.equal(h.bridge.answered, 1);
  // Never the words: not the prompt, the transcript, the answer or the turn's token.
  const logs = h.calls.logs.join("\n");
  for (const words of ["Inky, Dana's bot", "when is lunch", "Lunch is at noon", "mcp-token-for-this-turn", "bab_dev_secret"]) assert.ok(!logs.includes(words), `logged: ${words}`);
  await h.bridge.shutdown(1000);
  assert.deepEqual(h.calls.heartbeats.at(-1), { claude: null, codex: null }, "quitting tells the server it has none");
});

test("bridge app: turned off here, it stops listening and tells the server it has no CLIs", async () => {
  const h = harness();
  h.bridge.start();
  await until(() => h.bridge.mode === "listening");
  h.bridge.setEnabled(false);
  await until(() => h.bridge.mode === "off");
  await until(() => h.calls.heartbeats.some((c) => c.claude === null));
  assert.equal(h.settings.get().bridge.enabled, false, "remembered");
  const info = h.bridge.info();
  assert.equal(info.enabled, false);
  assert.match(info.status, /off on this computer/);
  const polls = h.calls.polls;
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(h.calls.polls, polls, "no more polling");
  await h.bridge.shutdown(500);
});

test("bridge app: no bot on a plan: ready (heartbeats, no polling) until turns wait", async () => {
  const h = harness({ bots: [{ id: "bot_1", name: "Inky", subscription: null }], queued: 0 });
  h.bridge.start();
  await until(() => h.bridge.mode === "ready");
  assert.equal(h.calls.polls, 0);
  assert.deepEqual(h.calls.heartbeats[0], { claude: "2.1.302 (Claude Code)", codex: null }, "so a bot's Brain settings can say Claude Code was found");
  assert.match(h.bridge.info().status, /Ready to think with Claude Code/);
  // A heartbeat says turns are waiting (a bot was just switched to the owner's plan): it listens.
  h.bridge.queued = false;
  h.bridge.api = { ...h.bridge.api, bridgeHeartbeat: async () => ({ ok: true, queued: 2 }) };
  await h.bridge.heartbeat();
  assert.equal(h.bridge.mode, "listening");
  assert.equal(h.calls.refreshes, 1, "and asks which bot");
  await h.bridge.shutdown(500);
});

test("bridge app: without Claude Code or Codex it stays off, says what's missing, and offers to get it", async () => {
  const h = harness({ clis: { claude: null, codex: null } });
  h.bridge.start();
  await until(() => h.calls.heartbeats.length === 1);
  assert.equal(h.bridge.mode, "off");
  assert.deepEqual(h.calls.heartbeats[0], { claude: null, codex: null });
  const info = h.bridge.info();
  assert.equal(info.show, true, "a bot needs it");
  assert.equal(info.status, "Claude Code isn't on this computer");
  assert.deepEqual(info.getCli, { id: "claude", name: "Claude Code" });
  await h.bridge.apply();
  assert.equal(h.calls.heartbeats.length, 1, "it doesn't say the same thing twice");
  await h.bridge.shutdown(500);
});

test("bridge app: Claude Code not signed in: the bot hears why, the owner gets one notification, the menu says how to fix it", async () => {
  const h = harness({ jobs: [job(), { ...job(), id: "job_2" }], run: async () => ({ ok: false, error: "Claude Code isn't signed in. Run `claude` once…", reason: "signin" }) });
  h.bridge.start();
  await until(() => h.calls.results.length === 2);
  assert.equal(h.calls.results[0].body.ok, false);
  assert.equal(h.calls.notes.length, 1, "one notification, not one per turn");
  assert.match(h.calls.notes[0].body, /type claude and sign in/);
  assert.equal(h.bridge.info().status, "Claude Code isn't signed in: run claude in Terminal");
  await h.bridge.shutdown(500);
});

test("bridge app: quitting mid-turn stops the CLI, tells the bot, then goes quiet", async () => {
  let aborted = false;
  const h = harness({
    jobs: [job()],
    run: (j, o) =>
      new Promise((resolve) => {
        o.signal.addEventListener("abort", () => {
          aborted = true;
          resolve({ ok: false, error: "Your computer stopped thinking before the answer was done (Build-a-bot was closed).", reason: "stopped" });
        });
      }),
  });
  h.bridge.start();
  await until(() => h.bridge.turn !== null);
  assert.match(h.bridge.info().status, /Thinking for Inky with Claude Code/);
  await h.bridge.shutdown(2000);
  assert.ok(aborted, "the CLI was stopped");
  assert.equal(h.calls.results[0].body.ok, false);
  assert.match(h.calls.results[0].body.error, /Build-a-bot was closed/);
  assert.deepEqual(h.calls.heartbeats.at(-1), { claude: null, codex: null });
});

test("bridge app: unpaired from the website (401), it stops and lets the account notice", async () => {
  const h = harness();
  h.bridge.api = {
    ...h.bridge.api,
    bridgeJob: async () => {
      throw Object.assign(new Error("Unknown or revoked device"), { status: 401 });
    },
  };
  h.bridge.start();
  await until(() => h.calls.refreshes === 1);
  await until(() => h.bridge.loop === null);
  await h.bridge.shutdown(500);
});

test("bridge app: signed out, it stops without a word to the server", async () => {
  const h = harness();
  h.bridge.start();
  await until(() => h.bridge.mode === "listening");
  const beats = h.calls.heartbeats.length;
  h.account.device = null;
  h.bridge.forget();
  assert.equal(h.bridge.mode, "off");
  await h.bridge.shutdown(500);
  assert.equal(h.calls.heartbeats.length, beats);
});

test("bridge: the tray shows its status, the switch, and Get Claude Code when a bot needs it", () => {
  const base = { status: "Watching for calls", icon: "watching", signedIn: true, phase: "idle", canTake: true, detectionPaused: false, captions: true, openAtLogin: false, macTabs: false, platform: "darwin", bots: [], botId: null, neverApps: [] };
  const items = trayItems({ ...base, bridge: { show: true, enabled: true, status: "Claude Code isn't on this computer", toggleLabel: "Think with my Claude plan here", getCli: { id: "claude", name: "Claude Code" } } });
  const ids = items.map((i) => i.id);
  assert.ok(ids.includes("bridge-status") && ids.includes("bridge-get:claude") && ids.includes("bridge-toggle"));
  assert.equal(items.find((i) => i.id === "bridge-toggle").checked, true);
  assert.ok(!trayItems({ ...base, bridge: { show: false, enabled: true, status: "", toggleLabel: "", getCli: null } }).some((i) => i.id === "bridge-toggle"));
  assert.ok(!trayItems({ ...base, signedIn: false, bridge: { show: true, enabled: true, status: "x", toggleLabel: "x", getCli: null } }).some((i) => i.id === "bridge-toggle"));
});

test("bridge: the setting starts undecided (on), and is remembered", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bab-set-"));
  const file = path.join(dir, "settings.json");
  assert.deepEqual(new Settings(file).get().bridge, { enabled: null });
  new Settings(file).update({ bridge: { enabled: false } });
  assert.deepEqual(new Settings(file).get().bridge, { enabled: false });
  fs.rmSync(dir, { recursive: true, force: true });
});
