/**
 * The Bridge's turn runner: one turn of a bot that thinks with its owner's own Claude Code or
 * Codex, on their computer. Shared by the terminal Bridge (bridge/bab-bridge.mjs) and the desktop
 * app (desktop/src/main/bridge/runner.mjs is a copy of this file; a test keeps them identical).
 *
 * The CLI runs with every built-in tool off, in an empty folder, with only the bot's MCP server
 * (whose every call Build-a-bot's policy engine checks); a turn whose CLI shows any built-in tool
 * or runs a shell command is refused. API keys are kept from the CLI, so it uses the owner's plan.
 * Nothing here logs or keeps what a turn says.
 *
 * No shell, on any platform: on Windows the real program is found (a .exe, or the program an npm
 * .cmd shim points at), because cmd.exe drops empty arguments and mangles JSON and line breaks.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const MAX_TURNS = 12;
export const TURN_TIMEOUT_MS = 8 * 60 * 1000;
/** Enough for any answer; a CLI that prints more is cut off rather than filling memory. */
const MAX_OUTPUT = 16 * 1024 * 1024;

/** Keys that would quietly bill the turn to an API account instead of the owner's plan. */
const API_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"];
/** Another Claude Code session's markers (the Bridge started from one), and Electron's own switches. */
const FOREIGN_ENV = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(ENTRYPOINT|EXECPATH|SESSION_.*|CHILD_SESSION|MESSAGING_.*)|ELECTRON_.*)$/;

/**
 * The CLI's environment: ours, minus API keys and foreign session markers, plus `extra`.
 * @param {Record<string, string | undefined>} base @param {Record<string, string>} [extra]
 */
export function childEnv(base, extra = {}) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || API_KEYS.includes(k) || FOREIGN_ENV.test(k)) continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

// ---------------------------------------------------------------------------
// Finding the CLI

/**
 * @typedef {{ file: string, args: string[], env?: Record<string, string> }} Command
 *   how to start a CLI without a shell: `file` with `args` before the CLI's own.
 */

/** The PATH entry's name, whatever its case (Windows says "Path"). @param {Record<string, string | undefined>} env */
export function pathKey(env) {
  return Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
}

/**
 * What an npm or pnpm .cmd shim runs: the last quoted path after %dp0% / %~dp0 that isn't node.exe.
 * @param {string} text @param {string} dir  the shim's folder
 * @returns {string | null}
 */
export function shimTarget(text, dir) {
  let found = null;
  for (const m of text.matchAll(/"%~?dp0%?\\([^"%]+)"/gi)) {
    if (/(^|\\)node\.exe$/i.test(m[1])) continue;
    found = m[1];
  }
  return found ? path.win32.resolve(dir, found) : null;
}

/**
 * How to start `name` (claude or codex) from this PATH, without a shell, or null if it isn't there.
 * @param {string} name
 * @param {object} [o]
 * @param {Record<string, string | undefined>} [o.env]
 * @param {NodeJS.Platform} [o.platform]
 * @param {Command | null} [o.node]  how to run a .js file when there's no node.exe (Electron as Node)
 * @param {Pick<typeof fs, 'statSync' | 'accessSync' | 'readFileSync'>} [o.fs]  (tests)
 * @returns {Command | null}
 */
export function resolveCommand(name, o = {}) {
  const files = o.fs ?? fs;
  const env = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  const win = platform === "win32";
  const p = win ? path.win32 : path.posix;
  const dirs = String(env[pathKey(env)] ?? "")
    .split(win ? ";" : ":")
    .map((d) => d.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
  const isFile = (f) => {
    try {
      return files.statSync(f).isFile();
    } catch {
      return false;
    }
  };
  if (!win) {
    for (const dir of dirs) {
      const f = p.join(dir, name);
      if (!isFile(f)) continue;
      try {
        files.accessSync(f, fs.constants.X_OK);
        return { file: f, args: [] };
      } catch {
        /* not executable: keep looking */
      }
    }
    return null;
  }
  for (const dir of dirs) {
    const exe = p.join(dir, `${name}.exe`);
    if (isFile(exe)) return { file: exe, args: [] };
    for (const ext of [".cmd", ".bat"]) {
      const shim = p.join(dir, `${name}${ext}`);
      if (!isFile(shim)) continue;
      let target = null;
      try {
        target = shimTarget(String(files.readFileSync(shim, "utf8")), dir);
      } catch {
        /* unreadable */
      }
      if (!target || !isFile(target)) continue;
      if (/\.exe$/i.test(target)) return { file: target, args: [] };
      if (/\.[cm]?js$/i.test(target)) {
        const local = p.join(dir, "node.exe");
        const node = isFile(local) ? { file: local, args: [] } : resolveCommand("node", { env, platform, fs: files });
        const runner = node ?? o.node ?? null;
        if (runner) return { file: runner.file, args: [...runner.args, target], ...(runner.env ? { env: runner.env } : {}) };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Running it

/**
 * @param {Command} cmd @param {string[]} args
 * @param {{ cwd: string, env: Record<string, string>, stdin?: string, timeoutMs?: number, signal?: AbortSignal }} o
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string, error?: string }>}
 */
export function runProcess(cmd, args, o) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd.file, [...cmd.args, ...args], {
        cwd: o.cwd,
        env: { ...o.env, ...(cmd.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      });
    } catch (err) {
      resolve({ code: -1, stdout: "", stderr: "", error: String(/** @type {any} */ (err)?.code ?? err) });
      return;
    }
    let stdout = "";
    let stderr = "";
    let done = false;
    const stop = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGINT");
      setTimeout(() => child.exitCode === null && child.signalCode === null && child.kill("SIGKILL"), 5000).unref?.();
    };
    const timer = setTimeout(stop, o.timeoutMs ?? TURN_TIMEOUT_MS);
    o.signal?.addEventListener("abort", stop, { once: true });
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", stop);
      resolve(r);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      if (stdout.length < MAX_OUTPUT) stdout += d;
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < 64 * 1024) stderr += d;
    });
    child.on("close", (code) => finish({ code, stdout, stderr }));
    child.on("error", (err) => finish({ code: -1, stdout, stderr, error: String(/** @type {any} */ (err)?.code ?? err.message) }));
    child.stdin.on("error", () => {});
    child.stdin.end(o.stdin ?? "");
  });
}

/**
 * The CLI's version line ("2.1.3 (Claude Code)"), or null if it can't be run.
 * @param {Command | null} cmd @param {Record<string, string>} env
 */
export async function cliVersion(cmd, env) {
  if (!cmd) return null;
  const r = await runProcess(cmd, ["--version"], { cwd: process.cwd(), env, timeoutMs: 15_000 });
  if (r.code !== 0) return null;
  return ((r.stdout || r.stderr).trim().split("\n")[0] ?? "").slice(0, 80) || null;
}

// ---------------------------------------------------------------------------
// A turn

/**
 * @typedef {{ cli?: string, model?: string, system: string, transcript?: string, directive?: string | null, mcpUrl: string }} TurnInput
 * @typedef {{ id: string, botId: string, input: TurnInput, mcpToken: string }} Job
 * @typedef {{ ok: boolean, text?: string, error?: string, costUsd?: number, model?: string, reason?: 'signin'|'limit'|'missing'|'refused'|'stopped'|'error' }} TurnResult
 */

/** What the CLI is asked: the conversation, any platform instruction, then "reply now". @param {TurnInput} input */
export function turnInput(input) {
  const parts = [];
  if (input.transcript) parts.push(`Conversation so far:\n${input.transcript}`);
  if (input.directive) parts.push(`Platform instruction (not from a person): ${input.directive}`);
  parts.push("Reply to the owner's latest message now. Use your tools when they help.");
  return parts.join("\n\n");
}

/** An empty folder for this bot's turn: no project hooks, .mcp.json, CLAUDE.md or AGENTS.md can load. */
export function prepareWorkdir(root, botId) {
  const dir = path.join(root, String(botId).replace(/[^a-z0-9_]/gi, "") || "bot");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  clearDir(dir);
  return dir;
}

export function clearDir(dir) {
  try {
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  } catch {
    /* already gone */
  }
}

/**
 * Claude Code's arguments. The settings go in a file: JSON on a command line doesn't survive every shell.
 * @param {{ dir: string, model?: string, permissionPrompts?: boolean }} o
 */
export function claudeArgs(o) {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--system-prompt-file", path.join(o.dir, "persona.md"),
    "--tools", "",
    "--strict-mcp-config",
    "--mcp-config", path.join(o.dir, ".bab-mcp.json"),
    "--allowedTools", "mcp__bab__*",
    "--permission-mode", "dontAsk",
    ...(o.permissionPrompts === false ? [] : ["--permission-prompts", "none"]),
    "--disable-slash-commands",
    "--settings", path.join(o.dir, ".bab-settings.json"),
    "--no-session-persistence",
    "--max-turns", String(MAX_TURNS),
  ];
  if (o.model && o.model !== "default") args.push("--model", o.model);
  return args;
}

/**
 * Claude Code's stream-json output → the answer, or why there's none.
 * @param {string} stdout @param {string} stderr
 * @returns {TurnResult}
 */
export function readClaude(stdout, stderr) {
  let text = "";
  let cost;
  let model;
  /** @type {string | null} */
  let error = null;
  /** @type {TurnResult['reason']} */
  let reason;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === "system" && ev.subtype === "init") {
      model = ev.model;
      const extra = (ev.tools || []).filter((t) => !String(t).startsWith("mcp__bab__") && t !== "EndConversation");
      if (extra.length) {
        error = `Refusing to run: Claude Code exposed built-in tools (${extra.join(", ")}). Update Build-a-bot.`;
        reason = "refused";
      }
    } else if (ev.type === "assistant" && ev.error && reason !== "refused") {
      if (ev.error === "authentication_failed") {
        error = "Claude Code isn't signed in. Run `claude` once on this computer and sign in with your Claude account.";
        reason = "signin";
      } else if (ev.error === "rate_limit") {
        error = "You've hit your Claude plan's usage limit for now.";
        reason = "limit";
      } else {
        error = `Claude Code error: ${ev.error}`;
      }
    } else if (ev.type === "result") {
      if (typeof ev.result === "string") text = ev.result;
      cost = typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : undefined;
      if (ev.is_error && !error) error = (ev.errors && ev.errors.join("; ")) || `Claude Code stopped: ${ev.subtype}`;
    }
  }
  if (reason === "refused") return { ok: false, error: error ?? undefined, reason, model };
  if (!text && !error) error = (stderr || "Claude Code produced no answer").slice(0, 500);
  return { ok: !error, text: text || undefined, error: error || undefined, costUsd: cost, model, ...(error ? { reason: reason ?? "error" } : {}) };
}

/** Windows starts programs with one command line of at most 32,767 characters. */
const WINDOWS_COMMAND_LINE = 30_000;

/**
 * Codex's arguments. Its instructions go on the command line (`developer_instructions`); on
 * Windows, ones too long for a command line go at the top of the prompt instead (`inPrompt`).
 * @param {{ dir: string, system: string, mcpUrl: string, model?: string, platform?: NodeJS.Platform }} o
 * @returns {{ args: string[], inPrompt: boolean }}
 */
export function codexArgs(o) {
  const disable = ["shell_tool", "unified_exec", "view_image", "sleep_tool", "multi_agent", "apps", "plugins", "hooks"];
  const base = [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "--sandbox", "read-only",
    "-C", o.dir,
    ...disable.flatMap((f) => ["--disable", f]),
    "-c", 'web_search="disabled"',
    "-c", `mcp_servers.bab.url=${JSON.stringify(o.mcpUrl)}`,
    "-c", 'mcp_servers.bab.bearer_token_env_var="BAB_MCP_TOKEN"',
    "-c", "mcp_servers.bab.required=true",
    "-c", 'mcp_servers.bab.default_tools_approval_mode="approve"',
  ];
  const tail = ["-o", path.join(o.dir, "last.txt"), ...(o.model && o.model !== "default" ? ["-m", o.model] : []), "-"];
  const instructions = ["-c", `developer_instructions=${JSON.stringify(o.system)}`];
  const inPrompt = (o.platform ?? process.platform) === "win32" && JSON.stringify([...base, ...instructions, ...tail]).length > WINDOWS_COMMAND_LINE;
  return { args: inPrompt ? [...base, ...tail] : [...base, ...instructions, ...tail], inPrompt };
}

/**
 * Codex's --json output → the answer, or why there's none.
 * @param {string} stdout @param {string} stderr @param {string | null} last  its -o file, if written
 * @returns {TurnResult}
 */
export function readCodex(stdout, stderr, last) {
  let text = "";
  /** @type {string | null} */
  let error = null;
  /** @type {TurnResult['reason']} */
  let reason;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === "item.completed" && ev.item?.type === "agent_message") text = ev.item.text || text;
    if (ev.type === "item.completed" && ev.item?.type === "command_execution") {
      error = "Refusing: Codex tried to run a shell command. Update Build-a-bot.";
      reason = "refused";
    }
    if (reason !== "refused" && ev.type === "turn.failed") error = ev.error?.message || "Codex turn failed";
    if (reason !== "refused" && ev.type === "error") error = ev.message || "Codex error";
  }
  if (reason === "refused") return { ok: false, error: error ?? undefined, reason, model: "codex" };
  if (!text && last) text = last.trim();
  if (!text && !error) error = (stderr || "Codex produced no answer").slice(0, 500);
  if (/not logged in|login/i.test(error || "")) {
    error = "Codex isn't signed in. Run `codex login` on this computer.";
    reason = "signin";
  } else if (/usage limit|rate limit/i.test(error || "")) {
    reason = "limit";
  }
  return { ok: !error, text: text || undefined, error: error || undefined, model: "codex", ...(error ? { reason: reason ?? "error" } : {}) };
}

const CLI_NAME = { claude: "Claude Code", codex: "Codex" };

/**
 * Run one turn in `dir` (prepareWorkdir) and return what to report. Never throws.
 * @param {Job} job
 * @param {{ dir: string, commands: { claude: Command | null, codex: Command | null }, env: Record<string, string>, signal?: AbortSignal, platform?: NodeJS.Platform }} o
 * @returns {Promise<TurnResult>}
 */
export async function runTurn(job, o) {
  const cli = job.input.cli === "codex" ? "codex" : "claude";
  const cmd = o.commands[cli];
  if (!cmd) return { ok: false, error: `${CLI_NAME[cli]} isn't installed on this computer.`, reason: "missing" };
  try {
    const r = cli === "claude" ? await runClaude(job, cmd, o) : await runCodex(job, cmd, o);
    if (o.signal?.aborted) return { ok: false, error: "Your computer stopped thinking before the answer was done (Build-a-bot was closed).", reason: "stopped" };
    return r;
  } catch (err) {
    return { ok: false, error: String(/** @type {any} */ (err)?.message ?? err).slice(0, 500), reason: "error" };
  } finally {
    clearDir(o.dir);
  }
}

/** @param {Job} job @param {Command} cmd @param {Parameters<typeof runTurn>[1]} o */
async function runClaude(job, cmd, o) {
  const { input } = job;
  const write = (name, data) => fs.writeFileSync(path.join(o.dir, name), data, { mode: 0o600 });
  write("persona.md", input.system);
  write(
    ".bab-mcp.json",
    JSON.stringify({
      mcpServers: { bab: { type: "http", url: input.mcpUrl, headers: { Authorization: `Bearer ${job.mcpToken}` }, alwaysLoad: true, timeout: 60000 } },
    }),
  );
  write(".bab-settings.json", JSON.stringify({ disableAllHooks: true }));
  const env = childEnv(o.env, { ENABLE_TOOL_SEARCH: "false" });
  const run = (permissionPrompts) =>
    runProcess(cmd, claudeArgs({ dir: o.dir, model: input.model, permissionPrompts }), { cwd: o.dir, env, stdin: turnInput(input), signal: o.signal });
  let res = await run(true);
  // Older Claude Code: without the newer flag, dontAsk alone keeps prompts away.
  if (res.code !== 0 && /unknown option.*permission-prompts/i.test(res.stderr)) res = await run(false);
  if (res.error === "ENOENT") return { ok: false, error: "Claude Code isn't installed on this computer.", reason: "missing" };
  if (res.error) return { ok: false, error: `Couldn't start Claude Code (${res.error}).`, reason: "error" };
  return readClaude(res.stdout, res.stderr);
}

/** @param {Job} job @param {Command} cmd @param {Parameters<typeof runTurn>[1]} o */
async function runCodex(job, cmd, o) {
  const { input } = job;
  const { args, inPrompt } = codexArgs({ dir: o.dir, system: input.system, mcpUrl: input.mcpUrl, model: input.model, platform: o.platform });
  const prompt = inPrompt ? `Your instructions (from Build-a-bot, not from a person):\n${input.system}\n\n---\n\n${turnInput(input)}` : turnInput(input);
  const res = await runProcess(cmd, args, { cwd: o.dir, env: childEnv(o.env, { BAB_MCP_TOKEN: job.mcpToken }), stdin: prompt, signal: o.signal });
  if (res.error === "ENOENT") return { ok: false, error: "Codex isn't installed on this computer.", reason: "missing" };
  if (res.error) return { ok: false, error: `Couldn't start Codex (${res.error}).`, reason: "error" };
  let last = null;
  try {
    last = fs.readFileSync(path.join(o.dir, "last.txt"), "utf8");
  } catch {
    /* none */
  }
  return readCodex(res.stdout, res.stderr, last);
}

/**
 * What to send the server for a result: only its fields (`reason` stays here).
 * @param {TurnResult} r
 */
export function reportable(r) {
  return {
    ok: r.ok,
    ...(r.text !== undefined ? { text: r.text.slice(0, 20000) } : {}),
    ...(r.error !== undefined ? { error: r.error.slice(0, 2000) } : {}),
    ...(typeof r.costUsd === "number" ? { costUsd: r.costUsd } : {}),
    ...(r.model ? { model: String(r.model).slice(0, 120) } : {}),
  };
}
