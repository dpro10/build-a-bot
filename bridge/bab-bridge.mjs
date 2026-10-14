#!/usr/bin/env node
/**
 * Build-a-bot Bridge — run your bot on your own Claude / ChatGPT subscription.
 *
 * What it does: pairs this computer with your Build-a-bot account, waits for turns
 * meant for your subscription-powered bots, and answers each one by running YOUR
 * own, unmodified `claude` (Claude Code) or `codex` CLI here, signed in by you.
 *
 * What it never does:
 *  - read, copy or upload your Claude/ChatGPT login (no keychain, no ~/.claude*, no ~/.codex/auth.json)
 *  - run anyone else's messages on your plan (only your own bots, for you)
 *  - give the CLI shell, file or web access: every built-in tool is disabled; the bot only
 *    gets its own tools over MCP, and our server enforces your trust settings on each call.
 *
 * Usage:
 *   npx build-a-bot-bridge pair ABCD-1234 [--server https://build-a-bot.site] [--name "My laptop"]
 *   npx build-a-bot-bridge            # start (keep running; Ctrl+C to stop)
 *   npx build-a-bot-bridge status | doctor | unpair
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VERSION = "0.1.0";
const HOME = path.join(os.homedir(), ".buildabot");
const CONFIG = path.join(HOME, "bridge.json");
const WORK = path.join(HOME, "work");
const MAX_TURNS = 12;
const TURN_TIMEOUT_MS = 8 * 60 * 1000;
/** How to run this again, as the person did: from npm, or this file from a checkout. */
const SELF = (() => {
  const script = process.argv[1] ?? "";
  if (!/bab-bridge\.mjs$/.test(script) || /[\\/](_npx|node_modules)[\\/]/.test(script)) return "npx build-a-bot-bridge";
  const rel = path.relative(process.cwd(), script);
  return `node ${rel.startsWith("..") || path.isAbsolute(rel) ? script : rel}`;
})();

// ---------------------------------------------------------------------------
// helpers

function log(...args) {
  console.log(`[bridge ${new Date().toLocaleTimeString()}]`, ...args);
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    return null;
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function cliVersion(bin) {
  try {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 15000, shell: process.platform === "win32" });
    if (r.status === 0) return (r.stdout || r.stderr).trim().split("\n")[0].slice(0, 80);
  } catch {
    /* not installed */
  }
  return null;
}

function detectClis() {
  return { claude: cliVersion("claude"), codex: cliVersion("codex") };
}

async function api(cfg, method, route, body) {
  const res = await fetch(`${cfg.server}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
      "user-agent": `build-a-bot-bridge/${VERSION}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Child env: never pass API keys that would silently switch billing away from the user's plan. */
function childEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]) delete env[k];
  return env;
}

function prepareWorkdir(botId) {
  const dir = path.join(WORK, botId.replace(/[^a-z0-9_]/gi, ""));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // An empty, dedicated folder: no project hooks, .mcp.json, CLAUDE.md or AGENTS.md can load.
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  return dir;
}

function turnInput(input) {
  const parts = [];
  if (input.transcript) parts.push(`Conversation so far:\n${input.transcript}`);
  if (input.directive) parts.push(`Platform instruction (not from a person): ${input.directive}`);
  parts.push("Reply to the owner's latest message now. Use your tools when they help.");
  return parts.join("\n\n");
}

function runProcess(bin, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: opts.cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGINT"), TURN_TIMEOUT_MS);
    child.stdout.on("data", (d) => {
      stdout += d;
      opts.onStdout?.(d.toString());
    });
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(err) });
    });
    child.stdin.end(opts.stdin ?? "");
  });
}

// ---------------------------------------------------------------------------
// Claude Code

async function runClaude(job, dir) {
  const { input } = job;
  fs.writeFileSync(path.join(dir, "persona.md"), input.system, { mode: 0o600 });
  const mcpConfigPath = path.join(dir, ".bab-mcp.json");
  fs.writeFileSync(
    mcpConfigPath,
    JSON.stringify({
      mcpServers: {
        bab: { type: "http", url: input.mcpUrl, headers: { Authorization: `Bearer ${job.mcpToken}` }, alwaysLoad: true, timeout: 60000 },
      },
    }),
    { mode: 0o600 },
  );
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--system-prompt-file", path.join(dir, "persona.md"),
    "--tools", "",
    "--strict-mcp-config",
    "--mcp-config", mcpConfigPath,
    "--allowedTools", "mcp__bab__*",
    "--permission-mode", "dontAsk",
    "--permission-prompts", "none",
    "--disable-slash-commands",
    "--settings", JSON.stringify({ disableAllHooks: true }),
    "--no-session-persistence",
    "--max-turns", String(MAX_TURNS),
  ];
  if (input.model && input.model !== "default") args.push("--model", input.model);

  const exec = (a) =>
    runProcess("claude", a, { cwd: dir, env: childEnv({ ENABLE_TOOL_SEARCH: "false" }), stdin: turnInput(input) });
  let res = await exec(args);
  if (res.code !== 0 && /unknown option.*permission-prompts/i.test(res.stderr)) {
    // Older Claude Code: drop the newer flag and rely on dontAsk.
    const i = args.indexOf("--permission-prompts");
    args.splice(i, 2);
    res = await exec(args);
  }
  fs.rmSync(mcpConfigPath, { force: true });

  let text = "";
  let cost;
  let model;
  let error = null;
  for (const line of res.stdout.split("\n")) {
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
        error = `Refusing to run: Claude Code exposed built-in tools (${extra.join(", ")}). Update the Bridge.`;
      }
    } else if (ev.type === "assistant" && ev.error) {
      error =
        ev.error === "authentication_failed"
          ? "Claude Code isn't signed in. Run `claude` once on this computer and sign in with your Claude account."
          : ev.error === "rate_limit"
            ? "You've hit your Claude plan's usage limit for now."
            : `Claude Code error: ${ev.error}`;
    } else if (ev.type === "result") {
      if (typeof ev.result === "string") text = ev.result;
      cost = typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : undefined;
      if (ev.is_error && !error) error = (ev.errors && ev.errors.join("; ")) || `Claude Code stopped: ${ev.subtype}`;
    }
  }
  if (!text && !error) error = (res.stderr || "Claude Code produced no answer").slice(0, 500);
  return { ok: !error, text: text || undefined, error: error || undefined, costUsd: cost, model };
}

// ---------------------------------------------------------------------------
// Codex

async function runCodex(job, dir) {
  const { input } = job;
  const lastPath = path.join(dir, "last.txt");
  const disable = ["shell_tool", "unified_exec", "view_image", "sleep_tool", "multi_agent", "apps", "plugins", "hooks"];
  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "--sandbox", "read-only",
    "-C", dir,
    ...disable.flatMap((f) => ["--disable", f]),
    "-c", 'web_search="disabled"',
    "-c", `mcp_servers.bab.url=${JSON.stringify(input.mcpUrl)}`,
    "-c", 'mcp_servers.bab.bearer_token_env_var="BAB_MCP_TOKEN"',
    "-c", "mcp_servers.bab.required=true",
    "-c", 'mcp_servers.bab.default_tools_approval_mode="approve"',
    "-c", `developer_instructions=${JSON.stringify(input.system)}`,
    "-o", lastPath,
  ];
  if (input.model && input.model !== "default") args.push("-m", input.model);
  args.push("-");
  const res = await runProcess("codex", args, { cwd: dir, env: childEnv({ BAB_MCP_TOKEN: job.mcpToken }), stdin: turnInput(input) });

  let text = "";
  let error = null;
  for (const line of res.stdout.split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === "item.completed" && ev.item?.type === "agent_message") text = ev.item.text || text;
    if (ev.type === "item.completed" && ev.item?.type === "command_execution") {
      error = "Refusing: Codex tried to run a shell command. Update the Bridge.";
    }
    if (ev.type === "turn.failed") error = ev.error?.message || "Codex turn failed";
    if (ev.type === "error") error = ev.message || "Codex error";
  }
  if (!text) {
    try {
      text = fs.readFileSync(lastPath, "utf8").trim();
    } catch {
      /* none */
    }
  }
  if (!text && !error) error = (res.stderr || "Codex produced no answer").slice(0, 500);
  if (/not logged in|login/i.test(error || "")) error = "Codex isn't signed in. Run `codex login` on this computer.";
  return { ok: !error, text: text || undefined, error: error || undefined, model: "codex" };
}

// ---------------------------------------------------------------------------
// commands

async function pair() {
  const code = process.argv[3];
  if (!code) {
    console.error(`Usage: ${SELF} pair ABCD-1234 [--server URL] [--name NAME]`);
    process.exit(1);
  }
  const server = (arg("server", process.env.BAB_SERVER || "https://build-a-bot.site") || "").replace(/\/$/, "");
  const name = arg("name", `${os.userInfo().username}'s ${os.platform() === "darwin" ? "Mac" : os.platform() === "win32" ? "PC" : "computer"}`);
  const clis = detectClis();
  if (!clis.claude && !clis.codex) {
    console.error("Neither `claude` (Claude Code) nor `codex` was found. Install one and sign in first:\n  Claude Code: https://code.claude.com\n  Codex: https://developers.openai.com/codex");
    process.exit(1);
  }
  const data = await api({ server }, "POST", "/api/bridge/pair", { code: code.toUpperCase(), name, platform: `${os.platform()}-${os.arch()}`, clis });
  writeConfig({ server, deviceId: data.deviceId, token: data.token, name });
  log(`Paired as "${name}". Found: ${[clis.claude && `Claude Code ${clis.claude}`, clis.codex && `Codex ${clis.codex}`].filter(Boolean).join(", ")}`);
  log(`Now run: ${SELF}   (leave it running while you want your bot to think on this computer)`);
}

async function start() {
  const cfg = readConfig();
  if (!cfg) {
    console.error(`Not paired yet. In the app, open Bridge (your computer) and get a pairing code, then run \`${SELF} pair CODE\`.`);
    process.exit(1);
  }
  const clis = detectClis();
  log(`Bridge ${VERSION} connected to ${cfg.server} as "${cfg.name}".`);
  log(`Claude Code: ${clis.claude ?? "not found"} · Codex: ${clis.codex ?? "not found"}`);
  await api(cfg, "POST", "/api/bridge/heartbeat", { clis }).catch((e) => {
    if (e.status === 401) {
      console.error("This computer was unpaired. Pair again from the app.");
      process.exit(1);
    }
  });
  setInterval(() => api(cfg, "POST", "/api/bridge/heartbeat", { clis }).catch(() => {}), 30_000).unref();

  let stopping = false;
  process.on("SIGINT", () => {
    if (stopping) process.exit(130);
    stopping = true;
    log("Stopping after the current turn… (Ctrl+C again to quit now)");
  });

  while (!stopping) {
    let data;
    try {
      data = await api(cfg, "GET", "/api/bridge/jobs?wait=25");
    } catch (e) {
      if (e.status === 401) {
        console.error("This computer was unpaired. Pair again from the app.");
        process.exit(1);
      }
      log(`Can't reach ${cfg.server} (${e.message}). Retrying in 10s…`);
      await new Promise((r) => setTimeout(r, 10_000));
      continue;
    }
    if (!data?.job) continue;
    const job = data.job;
    const cli = job.input.cli === "codex" ? "codex" : "claude";
    log(`Turn ${job.id} for bot ${job.botId} → ${cli}`);
    const dir = prepareWorkdir(job.botId);
    let result;
    if (cli === "claude" && !clis.claude) result = { ok: false, error: "Claude Code isn't installed on this computer." };
    else if (cli === "codex" && !clis.codex) result = { ok: false, error: "Codex isn't installed on this computer." };
    else {
      try {
        result = cli === "claude" ? await runClaude(job, dir) : await runCodex(job, dir);
      } catch (err) {
        result = { ok: false, error: String(err?.message || err).slice(0, 500) };
      }
    }
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
    try {
      await api(cfg, "POST", `/api/bridge/jobs/${job.id}/result`, result);
      log(result.ok ? `Answered (${(result.text || "").length} chars${result.costUsd ? `, ~$${result.costUsd.toFixed(4)} of your plan` : ""})` : `Failed: ${result.error}`);
    } catch (e) {
      log(`Couldn't report the result: ${e.message}`);
    }
  }
  process.exit(0);
}

function status() {
  const cfg = readConfig();
  const clis = detectClis();
  console.log(JSON.stringify({ version: VERSION, paired: Boolean(cfg), server: cfg?.server, name: cfg?.name, clis }, null, 2));
}

function unpair() {
  fs.rmSync(CONFIG, { force: true });
  log("Unpaired this computer. (Also revoke it in the app: Bridge (your computer) → Revoke.)");
}

function doctor() {
  const clis = detectClis();
  console.log(`Node ${process.version}`);
  console.log(`Claude Code: ${clis.claude ?? "not installed"}${clis.claude ? "" : "  → https://code.claude.com"}`);
  console.log(`Codex: ${clis.codex ?? "not installed"}`);
  console.log(`Config: ${fs.existsSync(CONFIG) ? CONFIG : "not paired"}`);
  console.log("Tip: sign in to Claude Code by running `claude` once; to Codex with `codex login`.");
}

const cmd = process.argv[2] ?? "start";
const commands = { pair, start, status, unpair, doctor, "--version": () => console.log(VERSION) };
if (!commands[cmd]) {
  console.log("Commands: pair CODE | start | status | doctor | unpair");
  process.exit(1);
}
Promise.resolve(commands[cmd]()).catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
