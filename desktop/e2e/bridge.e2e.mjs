/**
 * The Bridge in the app, end to end, against a running Build-a-bot dev server in demo mode
 * (default http://localhost:3000; BAB_E2E_SERVER to change it):
 *
 *   node --test --test-timeout=300000 e2e/bridge.e2e.mjs
 *
 * It makes a demo account with a bot on "Your Claude", pairs the app through its pairing window,
 * sends the bot a message in the web chat, and waits for the answer the app thought up on this
 * computer. Then it quits the app and checks the server no longer counts on this computer.
 *
 * The app starts with the bare PATH an app opened from the Finder gets, so it has to find Claude
 * Code the way it would for an owner: from their login shell's PATH (with the pretend claude, a
 * pretend shell names its folder). macOS gets Chromium's mock keychain, so no keychain is touched.
 *
 * By default a pretend `claude` answers (in its stream format), so no plan is used. With
 * BAB_E2E_REAL_CLAUDE=1 it's the real Claude Code on this computer, signed in: one short turn on
 * the owner's plan. Linux runs it under Xvfb (xvfb-run -a).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, request } from "playwright";

const APP_DIR = fileURLToPath(new URL("../", import.meta.url));
const SERVER = process.env.BAB_E2E_SERVER ?? "http://localhost:3000";
const REAL = process.env.BAB_E2E_REAL_CLAUDE === "1";
const ELECTRON = path.join(APP_DIR, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, timeoutMs = 30_000, everyMs = 300) {
  const t0 = Date.now();
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() - t0 > timeoutMs) throw new Error(`Timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
    await sleep(everyMs);
  }
}

/**
 * A pretend Claude Code in a folder only the owner's login shell knows about, and that pretend
 * shell (it prints its PATH the way the app asks for it). Returns the shell.
 */
function fakeClaude(root) {
  const bin = path.join(root, "only-my-shell-knows", "bin");
  fs.mkdirSync(bin, { recursive: true });
  const script = path.join(root, "fake-claude.cjs");
  fs.writeFileSync(
    script,
    `let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const a=process.argv.slice(2);
if(a[0]==="--version"){console.log("9.9.9 (Claude Code)");return;}
if(a[a.indexOf("--tools")+1]!==""){console.log(JSON.stringify({type:"system",subtype:"init",tools:["Bash"]}));return;}
console.log(JSON.stringify({type:"system",subtype:"init",model:"fake-claude",tools:[]}));
console.log(JSON.stringify({type:"result",result:"The bridge works (pretend Claude).",total_cost_usd:0}));});`,
  );
  fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  const shell = path.join(root, "pretend-shell");
  fs.writeFileSync(shell, `#!/bin/sh\nprintf '%s' "Welcome!\n__BAB_PATH__${bin}:/usr/bin:/bin__BAB_PATH__"\n`, { mode: 0o755 });
  return shell;
}

let app = null;
after(async () => {
  if (app) await app.close().catch(() => {});
});

test("a bot on Your Claude thinks on this computer, through the app", { timeout: 300_000, skip: process.platform === "win32" ? "macOS and Linux (Windows runs the runner's own tests)" : false }, async () => {
  const web = await request.newContext({ baseURL: SERVER, extraHTTPHeaders: { origin: SERVER } });
  const created = await web.post("/api/bots", {
    data: {
      avatar: "otto",
      color: "grape",
      name: "Inky",
      jobs: [],
      brain: { kind: "subscription", subscription: "claude", whenOffline: "wait" },
      connectors: [],
      trust: "trusted",
      channels: [],
      contact: { email: "me@example.com" },
      ageConfirmed: true,
      timezone: "America/Chicago",
      ownerName: "Dana",
    },
  });
  assert.ok(created.ok(), `create bot: ${created.status()} ${await created.text()}`);
  const botId = (await created.json()).id;
  const { code } = await (await web.post("/api/bridge/pairing-code")).json();

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bab-bridge-e2e-"));
  // What an app opened from the Finder gets: launchd's bare PATH.
  const env = { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
  if (!REAL) env.SHELL = fakeClaude(userData);
  app = await electron.launch({
    executablePath: ELECTRON,
    args: ["--no-sandbox", ...(process.platform === "darwin" ? ["--use-mock-keychain"] : []), APP_DIR],
    env: { ...env, BAB_USER_DATA: userData, BAB_SERVER: SERVER, BAB_TEST: "1", BAB_ALLOW_PLAINTEXT_TOKEN: "1", BAB_UPDATES: "off" },
  });
  const logs = [];
  app.process().stdout?.on("data", (d) => logs.push(String(d)));
  app.process().stderr?.on("data", (d) => logs.push(String(d)));
  const probe = () => app.evaluate(() => globalThis.__babTest?.state() ?? null);
  const step = async (name, fn) => {
    try {
      return await fn();
    } catch (err) {
      console.log(`--- app log at "${name}" ---\n${logs.join("").split("\n").slice(-60).join("\n")}`);
      throw err;
    }
  };

  const pairWin = await app.firstWindow();
  await pairWin.waitForSelector("#signed-out:not([hidden])");
  await pairWin.fill("#code", code);
  await pairWin.click("#pair-button");
  await step("paired", () => pairWin.waitForSelector("#paired:not([hidden])", { timeout: 20_000 }));

  // It found Claude Code without the terminal's PATH, and listens for Inky's turns.
  const listening = await step("listening", () => until("the Bridge to listen", async () => ((await probe())?.bridge?.mode === "listening" ? (await probe()).bridge : null), 60_000));
  assert.match(listening.status, /Your bots think here with Claude Code/);
  await step("bridge card", () => pairWin.waitForSelector("#bridge-card:not([hidden])"));
  assert.match(await pairWin.textContent("#bridge-line"), /Claude Code/);

  // The website counts on this computer now.
  const devices = await (await web.get("/api/bridge/devices")).json();
  const mine = devices.devices.find((d) => d.platform?.startsWith("desktop-"));
  assert.ok(mine?.clis.claude, "the app told the server it has Claude Code");
  assert.equal(mine.online, true);

  // A message in the web chat: queued, picked up here, answered.
  const chat = await web.post(`/api/bots/${botId}/chat`, { data: { text: "Reply with exactly these words and nothing else: the bridge works" } });
  assert.ok(chat.ok(), `chat: ${chat.status()}`);
  const answer = await step("answer", () =>
    until(
      "the bot's answer from this computer",
      async () => {
        const m = await (await web.get(`/api/bots/${botId}/messages`)).json();
        return m.messages.find((x) => x.role === "assistant" && x.meta?.via === "bridge") ?? null;
      },
      REAL ? 180_000 : 60_000,
      1000,
    ),
  );
  console.log(`answer: ${answer.text}`);
  assert.match(answer.text, /bridge works/i);
  const s = await probe();
  assert.equal(s.bridge.answered, 1);
  assert.equal(s.bridge.thinking, false);

  // Quitting: the server stops counting on this computer.
  await app.close();
  app = null;
  const after = await (await web.get("/api/bridge/devices")).json();
  const gone = after.devices.find((d) => d.id === mine.id);
  assert.equal(gone.clis.claude, null, "quitting told the server this computer has no CLI now");
  fs.rmSync(userData, { recursive: true, force: true });
});
