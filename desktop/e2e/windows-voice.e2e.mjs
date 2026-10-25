/**
 * Voice typing on Windows, end to end, on a real Windows computer (CI's windows-latest):
 *
 *  - the app as installed by its installer (BAB_E2E_APP; or from source without it), paired;
 *  - NVIDIA Parakeet run on the computer, as for an owner: NVIDIA's runtime from the installer (signed
 *    with the app in signed builds), the model downloaded from NVIDIA's own page;
 *  - a sentence the system's own voice says (BAB_E2E_SPEECH_WAV, 16-bit PCM) playing into
 *    Chromium's fake microphone while the default shortcut, Right Ctrl, is held down with
 *    SendInput (e2e/fixtures/winkey.py), with another app in front;
 *  - the words pasted into that app, which keeps the keyboard, and the clipboard put back.
 *
 * Ctrl + Windows, the two-key choice, and the F24 tap that keeps the Start menu shut when it's let
 * go are held for real in e2e/windows-learn.e2e.mjs.
 *
 * Against a stand-in for Build-a-bot's server (only what voice typing calls, below), so nothing
 * else has to run. It checks the server got the words and never the recording.
 *
 *   BAB_E2E_SPEECH_WAV=said.wav [BAB_E2E_APP=…\Build-a-bot.exe] node --test --test-timeout=900000 e2e/windows-voice.e2e.mjs
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { quitApp } from "./quit.mjs";

const APP_DIR = fileURLToPath(new URL("../", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
/** Electron from source, for the other app (and this one without BAB_E2E_APP): it downloads on first use. */
const electronBin = () => createRequire(path.join(APP_DIR, "package.json"))("electron");
const APP = process.env.BAB_E2E_APP || null;
const WAV = process.env.BAB_E2E_SPEECH_WAV;
const EXPECT = (process.env.BAB_E2E_SPEECH_EXPECT ?? "team meeting,tuesday").split(",").map((w) => w.trim().toLowerCase());
const SHOTS = process.env.BAB_E2E_SHOTS ?? path.join(os.tmpdir(), "bab-desktop-e2e");
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, timeoutMs = 30_000, everyMs = 250) {
  const t0 = Date.now();
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() - t0 > timeoutMs) throw new Error(`Timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
    await sleep(everyMs);
  }
}

/** Real key presses and focus (SendInput), with the Python every Windows runner has. */
function winkey(...args) {
  return new Promise((resolve, reject) =>
    execFile("python", [path.join(FIXTURES, "winkey.py"), ...args.map(String)], (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout.trim()))),
  );
}

/** The recording, with silence before (a person presses the key, then talks) and after. Returns the speech's length in seconds. */
function micFile(src, dest, beforeSec = 0.6, afterSec = 3) {
  const b = fs.readFileSync(src);
  let fmt = null;
  let data = null;
  for (let at = 12; at + 8 <= b.length; ) {
    const id = b.toString("ascii", at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === "fmt ") fmt = { channels: b.readUInt16LE(at + 10), rate: b.readUInt32LE(at + 12), bits: b.readUInt16LE(at + 22) };
    if (id === "data") data = b.subarray(at + 8, Math.min(b.length, at + 8 + size));
    at += 8 + size + (size % 2);
  }
  assert.ok(fmt && data && fmt.bits === 16, `${src}: needs a 16-bit PCM WAV`);
  const frame = fmt.channels * 2;
  const pad = (sec) => Buffer.alloc(Math.round(sec * fmt.rate) * frame);
  const pcm = Buffer.concat([pad(beforeSec), data, pad(afterSec)]);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(fmt.channels, 22);
  head.writeUInt32LE(fmt.rate, 24);
  head.writeUInt32LE(fmt.rate * frame, 28);
  head.writeUInt16LE(frame, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(dest, Buffer.concat([head, pcm]));
  return data.length / frame / fmt.rate;
}

/**
 * A stand-in for Build-a-bot's server: pairing, the desktop session, and dictation (the words in
 * JSON come back as the text to type, as the real one does with words that need no cleanup; a
 * recording gets 503, so if one ever arrives the test sees it). Everything else: 404.
 */
async function fakeServer() {
  const calls = [];
  const TOKEN = "bab_dev_e2e_windows";
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const type = String(req.headers["content-type"] ?? "").split(";")[0];
      const call = { method: req.method, path: url.pathname, type, bytes: body.length, authed: req.headers.authorization === `Bearer ${TOKEN}` };
      calls.push(call);
      const send = (status, data) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      };
      if (req.method === "POST" && url.pathname === "/api/bridge/pair") return send(200, { deviceId: "dev_windows", token: TOKEN });
      if (!call.authed) return send(401, { error: "Not paired" });
      if (req.method === "GET" && url.pathname === "/api/desktop/session") {
        return send(200, {
          device: { id: "dev_windows", name: "Windows" },
          owner: { name: "Dana", plan: "free" },
          bots: [{ id: "bot_1", name: "Otto", avatar: "otto", color: "mint", paused: false, meetingsOn: false }],
          meetings: { available: false, minutesLeft: 0, chunkMs: 60000 },
          // Like build-a-bot.site: no speech-to-text of its own, so only Parakeet on the computer hears.
          voice: { available: false, polish: false, edit: false, simulated: false, local: true, usage: { words: 0, limit: 8000 } },
          appUrl: `http://127.0.0.1:${srv.address().port}`,
          demo: false,
        });
      }
      if (req.method === "POST" && url.pathname === "/api/voice/dictate") {
        if (type !== "application/json") return send(503, { error: "This server has no speech-to-text.", code: "unavailable" });
        const heard = String(JSON.parse(body.toString("utf8")).heard ?? "").trim();
        call.heard = heard;
        const words = heard.split(/\s+/).filter(Boolean).length;
        return send(200, { kind: heard ? "text" : "empty", text: heard, heard, polished: false, words, usage: { words, limit: 8000 }, simulated: false, ms: { stt: 0, polish: 0 } });
      }
      if (req.method === "GET" && url.pathname === "/api/voice/dictionary") return send(200, { entries: [], fromMemories: [], bots: [{ id: "bot_1", name: "Otto" }] });
      send(404, { error: "not found" });
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", () => r(undefined)));
  return {
    origin: `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}`,
    calls,
    close() {
      srv.closeAllConnections();
      srv.close();
    },
  };
}

let app = null;
let target = null;
let server = null;
/** The app's log so far (set once it's running). */
let appLog = () => "";
after(async () => {
  target?.kill();
  try {
    await quitApp(app, appLog);
  } finally {
    server?.close();
  }
});

test("Windows: hold Right Ctrl, talk, let go: NVIDIA Parakeet hears it on the computer and it's typed in the app in front", { timeout: 900_000 }, async () => {
  if (process.platform !== "win32" || !WAV) {
    console.log("windows voice e2e: needs Windows and BAB_E2E_SPEECH_WAV; skipped");
    return;
  }
  const { _electron: electron } = await import("playwright");
  server = await fakeServer();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bab-win-e2e-"));
  const mic = path.join(userData, "mic.wav");
  const said = micFile(WAV, mic);

  // ---- the app (as installed, or from source), paired with the stand-in server
  app = await electron.launch({
    executablePath: APP ?? electronBin(),
    args: [...(APP ? [] : [APP_DIR]), "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${mic}`],
    env: { ...process.env, BAB_USER_DATA: userData, BAB_SERVER: server.origin, BAB_TEST: "1", BAB_VOICE_ENABLE: "1", BAB_LOG: "1" },
    timeout: 60_000,
  });
  const logs = [];
  app.process().stdout?.on("data", (d) => logs.push(String(d)));
  app.process().stderr?.on("data", (d) => logs.push(String(d)));
  appLog = () => {
    const file = path.join(userData, "logs", "main.log");
    return logs.join("") + (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
  };
  const probe = async () => (await app.evaluate(() => globalThis.__babTest?.state() ?? null))?.voice ?? null;
  const step = async (name, fn) => {
    try {
      return await fn();
    } catch (err) {
      console.log(`--- app log (last 80 lines) at "${name}" ---\n${appLog().split("\n").slice(-80).join("\n")}`);
      console.log(`--- voice state ---\n${JSON.stringify(await probe().catch(() => null), null, 2)}`);
      console.log(`--- server calls ---\n${JSON.stringify(server?.calls.slice(-20), null, 2)}`);
      throw err;
    }
  };

  const pairWin = await app.firstWindow();
  await pairWin.waitForSelector("#signed-out:not([hidden])");
  await pairWin.fill("#code", "WIN1-2345");
  await pairWin.click("#pair-button");
  await step("paired", () => pairWin.waitForSelector("#paired:not([hidden])", { timeout: 30_000 }));
  await step("hold mode", () => until("the shortcut to be heard", async () => (await probe())?.mode === "hold", 30_000));

  // ---- NVIDIA Parakeet: the runtime copied from the installed app, the model downloaded and checked, then loaded
  const t0 = Date.now();
  await step("private speech ready", () => until("Parakeet downloaded and loaded", async () => (await probe())?.local?.state === "ready", 600_000, 1000));
  console.log(`windows voice e2e: Parakeet downloaded, checked and loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  assert.equal((await probe()).local.active, true);
  await pairWin.close();

  // ---- another app in front, with "ORIGINAL CLIPBOARD" on the clipboard
  const outFile = path.join(userData, "target.txt");
  const clipFile = path.join(userData, "clip.txt");
  target = spawn(electronBin(), [path.join(FIXTURES, "target-app.cjs")], { env: { ...process.env, TARGET_OUT: outFile, TARGET_CLIP: clipFile }, stdio: ["ignore", "pipe", "pipe"] });
  let targetFailed = null;
  target.on("error", (err) => (targetFailed = err));
  await until("the target app", () => {
    if (targetFailed) throw targetFailed;
    return fs.existsSync(clipFile) && fs.readFileSync(clipFile, "utf8") === "ORIGINAL CLIPBOARD";
  }, 60_000);
  const typed = () => fs.readFileSync(outFile, "utf8");
  await step("focus", () => winkey("focus", "Target app"));

  // ---- hold Right Ctrl (the default) while the sentence plays, then let go
  const holdSec = 0.6 + said + 0.9;
  const pressed = Date.now();
  await winkey("down", "RControl", "sleep", holdSec.toFixed(2), "up", "RControl");
  const released = Date.now();
  await step("typed", () => until("the words in the other app", () => EXPECT.every((w) => typed().toLowerCase().includes(w)), 90_000, 100));
  const tookMs = Date.now() - released;
  const done = await until("done", async () => ((await probe())?.phase === "done" ? probe() : null), 15_000, 50).catch(() => null);
  const pill = app.windows().find((w) => w.url().startsWith("bab-app://dictation"));
  await pill?.screenshot({ path: path.join(SHOTS, "windows-done.png"), omitBackground: true }).catch(() => {});
  console.log(`windows voice e2e: held ${((released - pressed) / 1000).toFixed(1)} s; typed ${(tookMs / 1000).toFixed(2)} s after letting go: ${JSON.stringify(typed())}`);

  // Heard on this computer: the server got the words, never the recording.
  const dictations = server.calls.filter((c) => c.path === "/api/voice/dictate");
  assert.equal(dictations.length, 1);
  assert.equal(dictations[0].type, "application/json", "only the words were sent");
  assert.ok(EXPECT.every((w) => dictations[0].heard.toLowerCase().includes(w)), dictations[0].heard);
  if (done) assert.equal(done.pill.local, true, "the pill says private");
  assert.match(appLog(), /voice: heard on this computer in \d+ ms/);

  // The app in front kept the keyboard, and the clipboard was put back.
  assert.equal(await winkey("front"), "Target app", "the app in front is still the one typed into");
  await until("the clipboard put back", () => fs.readFileSync(clipFile, "utf8") === "ORIGINAL CLIPBOARD", 15_000);
  assert.equal(typed().split(dictations[0].heard).length - 1, 1, "typed once");
});
