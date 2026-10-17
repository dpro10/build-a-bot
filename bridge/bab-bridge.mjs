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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cliVersion, prepareWorkdir, reportable, resolveCommand, runTurn } from "./runner.mjs";

const VERSION = "0.2.0";
const HOME = path.join(os.homedir(), ".buildabot");
const CONFIG = path.join(HOME, "bridge.json");
const WORK = path.join(HOME, "work");
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

/** How to start each CLI from this terminal's PATH (no shell), or null. */
function findClis() {
  return { claude: resolveCommand("claude"), codex: resolveCommand("codex") };
}

/** @param {ReturnType<typeof findClis>} commands */
async function versions(commands) {
  const env = /** @type {Record<string, string>} */ (process.env);
  const [claude, codex] = await Promise.all([cliVersion(commands.claude, env), cliVersion(commands.codex, env)]);
  return { claude, codex };
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
  const clis = await versions(findClis());
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
  const commands = findClis();
  const clis = await versions(commands);
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
    const dir = prepareWorkdir(WORK, job.botId);
    const result = await runTurn(job, { dir, commands, env: /** @type {Record<string, string>} */ (process.env) });
    try {
      await api(cfg, "POST", `/api/bridge/jobs/${job.id}/result`, reportable(result));
      log(result.ok ? `Answered (${(result.text || "").length} chars${result.costUsd ? `, ~$${result.costUsd.toFixed(4)} of your plan` : ""})` : `Failed: ${result.error}`);
    } catch (e) {
      log(`Couldn't report the result: ${e.message}`);
    }
  }
  process.exit(0);
}

async function status() {
  const cfg = readConfig();
  const clis = await versions(findClis());
  console.log(JSON.stringify({ version: VERSION, paired: Boolean(cfg), server: cfg?.server, name: cfg?.name, clis }, null, 2));
}

function unpair() {
  fs.rmSync(CONFIG, { force: true });
  log("Unpaired this computer. (Also revoke it in the app: Bridge (your computer) → Revoke.)");
}

async function doctor() {
  const clis = await versions(findClis());
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
