/**
 * Voice typing with NVIDIA Parakeet on this computer, end to end, with NVIDIA's real runtime and
 * model and real speech. Against a Build-a-bot dev server in demo mode (BAB_E2E_SERVER, default
 * http://localhost:3000), under Xvfb:
 *
 *   BAB_E2E_SPEECH_FILES=<folder> BAB_E2E_SPEECH_DICTATION=<wav> BAB_E2E_SPEECH_COMMAND=<wav> \
 *     xvfb-run -a node --test --test-timeout=600000 e2e/local-speech.e2e.mjs
 *
 * BAB_E2E_SPEECH_FILES holds NVIDIA's files as they're published (nemo-speech-0.2.0-linux-x86_64-cpu.tar.gz,
 * itn_configs.tar.bz2, parakeet-tdt-0.6b-v3.q8_0.gguf); they're served from here, so the 0.7 GB
 * isn't downloaded each run, and they still have to match the hashes the app pins. The two WAVs
 * are someone saying "Let's move the Nemotron demo to next Tuesday at 10 AM." and "Hey Otto, add a
 * reminder to pay the electricity bill, about one hundred and forty two dollars, on October
 * thirtieth." (BAB_E2E_SPEECH_EXPECT and BAB_E2E_SPEECH_EXPECT_COMMAND: other words to look for).
 *
 * As soon as voice typing is on, the app downloads them (the model's download is cut off once
 * and picks up where it stopped), checks them and unpacks the runtime. Then each sentence plays
 * into Chromium's fake microphone while the shortcut is held: Parakeet hears it on this computer,
 * only the words go to the server, and they're typed into another app, or go to Otto.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, request } from "playwright";

const APP_DIR = fileURLToPath(new URL("../", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const SERVER = process.env.BAB_E2E_SERVER ?? "http://localhost:3000";
const SHOTS = process.env.BAB_E2E_SHOTS ?? path.join(os.tmpdir(), "bab-desktop-e2e");
const ELECTRON = path.join(APP_DIR, "node_modules", "electron", "dist", "electron");
const FILES = process.env.BAB_E2E_SPEECH_FILES;
const DICTATION = process.env.BAB_E2E_SPEECH_DICTATION;
const COMMAND = process.env.BAB_E2E_SPEECH_COMMAND;
const EXPECT = new RegExp(process.env.BAB_E2E_SPEECH_EXPECT ?? "Nemotron demo to next Tuesday at 10", "i");
const EXPECT_COMMAND = new RegExp(process.env.BAB_E2E_SPEECH_EXPECT_COMMAND ?? "electricity bill.*\\$142.*October 30", "i");
const RUNTIME = "nemo-speech-0.2.0-linux-x86_64-cpu.tar.gz";
const MODEL = "parakeet-tdt-0.6b-v3.q8_0.gguf";
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, timeoutMs = 30_000, everyMs = 200) {
  const t0 = Date.now();
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() - t0 > timeoutMs) throw new Error(`Timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
    await sleep(everyMs);
  }
}

function keys(...args) {
  return new Promise((resolve, reject) => execFile("python3", [path.join(FIXTURES, "xkey.py"), ...args.map(String)], (err, _o, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())));
}

/**
 * A 16-bit PCM WAV with silence before and after it (a person presses the key, then talks), as
 * the fake microphone's file. Returns how long the speech part is, in seconds.
 */
function micFile(src, dest, beforeSec = 0.6, afterSec = 3) {
  const b = fs.readFileSync(src);
  assert.equal(b.toString("ascii", 0, 4), "RIFF");
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

/** NVIDIA's files, served the way GitHub and Hugging Face serve them (ranges), with the model's first download cut off. */
async function serveFiles(dir) {
  const requests = [];
  let cut = 120 * 1024 * 1024;
  const srv = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname.slice(1));
    requests.push({ name, range: req.headers.range ?? null });
    const file = path.join(dir, path.basename(name));
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      res.writeHead(404);
      return res.end();
    }
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
    const start = m ? Number(m[1]) : 0;
    if (start >= st.size) {
      res.writeHead(416);
      return res.end();
    }
    res.writeHead(m ? 206 : 200, { "content-length": st.size - start, "accept-ranges": "bytes", ...(m ? { "content-range": `bytes ${start}-${st.size - 1}/${st.size}` } : {}) });
    const stream = fs.createReadStream(file, { start });
    if (name === MODEL && cut) {
      const limit = cut;
      cut = 0;
      let sent = 0;
      stream.on("data", (c) => {
        sent += c.length;
        if (sent > limit) {
          stream.destroy();
          res.destroy();
        }
      });
    }
    stream.pipe(res);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", () => r(undefined)));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}`;
  return {
    base,
    requests,
    close() {
      srv.closeAllConnections();
      srv.close();
    },
  };
}

let app = null;
let target = null;
let files = null;
after(async () => {
  target?.kill();
  if (app) await app.close().catch(() => {});
  files?.close();
});

test("NVIDIA Parakeet on this computer: downloaded, checked, and hearing real speech", { timeout: 600_000 }, async () => {
  if (process.platform !== "linux" || !process.env.DISPLAY || !FILES || !DICTATION) {
    console.log("on-device speech e2e: needs Linux with an X display (xvfb-run), BAB_E2E_SPEECH_FILES and BAB_E2E_SPEECH_DICTATION; skipped");
    return;
  }
  files = await serveFiles(FILES);

  // ---- a demo owner with a bot called Otto, and a pairing code
  const web = await request.newContext({ baseURL: SERVER, extraHTTPHeaders: { origin: SERVER } });
  const created = await web.post("/api/bots", {
    data: {
      avatar: "otto",
      color: "mint",
      name: "Otto",
      jobs: [],
      brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: [],
      trust: "ask",
      channels: [],
      contact: {},
      ageConfirmed: true,
      timezone: "America/Chicago",
      ownerName: "Dana",
    },
  });
  assert.ok(created.ok(), `create bot: ${created.status()} ${await created.text()}`);
  const botId = (await created.json()).id;
  const { code } = await (await web.post("/api/bridge/pairing-code")).json();

  // ---- the app, with voice typing on, downloading NVIDIA's files from here
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bab-local-e2e-"));
  const mic = path.join(userData, "mic.wav");
  const said = micFile(DICTATION, mic);
  app = await electron.launch({
    executablePath: ELECTRON,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${mic}`, APP_DIR],
    env: {
      ...process.env,
      BAB_USER_DATA: userData,
      BAB_SERVER: SERVER,
      BAB_TEST: "1",
      BAB_ALLOW_PLAINTEXT_TOKEN: "1",
      BAB_VOICE_ENABLE: "1",
      BAB_SPEECH_RUNTIME_URL: `${files.base}/${RUNTIME}`,
      BAB_SPEECH_ITN_URL: `${files.base}/itn_configs.tar.bz2`,
      BAB_SPEECH_MODEL_URL: `${files.base}/${MODEL}`,
    },
  });
  const logs = [];
  app.process().stdout?.on("data", (d) => logs.push(String(d)));
  app.process().stderr?.on("data", (d) => logs.push(String(d)));
  const log = () => logs.join("");
  const probe = async () => (await app.evaluate(() => globalThis.__babTest?.state() ?? null))?.voice ?? null;
  const step = async (name, fn) => {
    try {
      return await fn();
    } catch (err) {
      console.log(`--- app log (last 80 lines) at "${name}" ---\n${log().split("\n").slice(-80).join("\n")}`);
      console.log(`--- voice state ---\n${JSON.stringify(await probe().catch(() => null), null, 2)}`);
      throw err;
    }
  };

  // ---- pair: voice typing starts, and so does the download
  const pairWin = await app.firstWindow();
  await pairWin.waitForSelector("#signed-out:not([hidden])");
  await pairWin.fill("#code", code);
  await pairWin.click("#pair-button");
  await pairWin.waitForSelector("#paired:not([hidden])", { timeout: 20_000 });
  await step("hold mode", () => until("the shortcut to be heard", async () => (await probe())?.mode === "hold", 20_000));
  const t0 = Date.now();
  await pairWin.click("#voice-open");
  const voiceWin = await step("voice window", () => waitForWindow(app, (u) => u.startsWith("bab-app://voice")));
  await voiceWin.waitForSelector("#main:not([hidden])");
  await step("downloading", () => voiceWin.waitForSelector("#local:not([hidden]) #local-progress:not([hidden])", { timeout: 30_000 }));
  assert.match(await voiceWin.textContent("#local-status"), /Getting NVIDIA Parakeet/);
  await voiceWin.screenshot({ path: path.join(SHOTS, "local-0-downloading.png"), fullPage: true });
  await step("installed", () => until("Parakeet downloaded and checked", async () => (await probe())?.local?.state === "installed", 300_000, 500));
  const installMs = Date.now() - t0;
  const modelGets = files.requests.filter((r) => r.name === MODEL);
  assert.equal(modelGets.length, 2, "the cut-off download picked up where it stopped");
  assert.match(modelGets[1].range ?? "", /^bytes=[1-9]\d*-$/);
  assert.match(log(), /local speech: installed/);
  const v0 = await probe();
  assert.equal(v0.local.active, true, "the next dictation is heard on this computer");
  await voiceWin.waitForSelector("#local-status:has-text('On: your voice is turned into text on this computer')");
  assert.equal(await voiceWin.isHidden("#local-progress"), true);
  await voiceWin.screenshot({ path: path.join(SHOTS, "local-1-on.png"), fullPage: true });
  await voiceWin.close();
  await pairWin.close();

  // ---- another app: hold the shortcut while the sentence plays; it's typed there
  const outFile = path.join(userData, "target.txt");
  const clipFile = path.join(userData, "clip.txt");
  target = spawn(ELECTRON, ["--no-sandbox", path.join(FIXTURES, "target-app.cjs")], { env: { ...process.env, TARGET_OUT: outFile, TARGET_CLIP: clipFile }, stdio: ["ignore", "pipe", "pipe"] });
  await until("the target app", () => fs.existsSync(clipFile) && fs.readFileSync(clipFile, "utf8") === "ORIGINAL CLIPBOARD", 20_000);
  const typed = () => fs.readFileSync(outFile, "utf8");

  const holdMs = Math.round((0.6 + said + 0.9) * 1000);
  await keys("down", "Control_R");
  const pill = await step("pill", () => waitForWindow(app, (u) => u.startsWith("bab-app://dictation")));
  await sleep(holdMs);
  const released = Date.now();
  await keys("up", "Control_R");
  await step("typed", () => until("the sentence in the other app", () => EXPECT.test(typed()), 60_000, 100));
  const firstMs = Date.now() - released;
  const done = await until("done", async () => ((await probe())?.phase === "done" ? probe() : null), 10_000, 50);
  assert.equal(done.pill.local, true, "the pill says it was heard on this computer");
  assert.equal(done.pill.simulated, false);
  await pill.screenshot({ path: path.join(SHOTS, "local-2-done.png"), omitBackground: true }).catch(() => {});
  assert.match(log(), /voice: heard on this computer in \d+ ms/);
  assert.doesNotMatch(log(), /sending the recording instead/);
  await until("the clipboard put back", () => fs.readFileSync(clipFile, "utf8") === "ORIGINAL CLIPBOARD", 10_000);
  console.log(`on-device speech e2e: installed in ${(installMs / 1000).toFixed(1)} s; typed ${(firstMs / 1000).toFixed(2)} s after letting go: ${JSON.stringify(typed())}`);

  // ---- the same again, with the engine already running
  await until("the pill to go", async () => (await probe())?.phase === null, 15_000);
  const before = typed();
  await keys("down", "Control_R", "sleep", (holdMs / 1000).toFixed(2));
  const released2 = Date.now();
  await keys("up", "Control_R");
  await step("typed again", () => until("the sentence typed a second time", () => typed().length > before.length && EXPECT.test(typed().slice(before.length)), 60_000, 100));
  console.log(`on-device speech e2e: warm, typed ${((Date.now() - released2) / 1000).toFixed(2)} s after letting go`);

  // ---- "Hey Otto, …", heard on this computer: Otto gets the request
  if (COMMAND) {
    await until("the pill to go", async () => (await probe())?.phase === null, 15_000);
    const saidCmd = micFile(COMMAND, mic);
    await keys("down", "Control_R", "sleep", (0.6 + saidCmd + 0.9).toFixed(2), "up", "Control_R");
    const reply = await step("reply", () => until("Otto's answer", async () => ((await probe())?.phase === "reply" ? probe() : null), 90_000));
    assert.match(reply.pill.command, EXPECT_COMMAND);
    await pill.screenshot({ path: path.join(SHOTS, "local-3-command.png"), omitBackground: true }).catch(() => {});
    const chat = await (await web.get(`/api/bots/${botId}/messages`)).json();
    assert.ok(
      chat.messages.some((m) => m.role === "user" && EXPECT_COMMAND.test(m.text) && m.meta?.via === "voice"),
      "the request is in Otto's chat",
    );
    console.log(`on-device speech e2e: Otto was asked ${JSON.stringify(reply.pill.command)}`);
  }
  assert.equal((log().match(/sending the recording instead/g) ?? []).length, 0);
  const heardMs = [...log().matchAll(/voice: heard on this computer in (\d+) ms/g)].map((m) => Number(m[1]));
  console.log(`on-device speech e2e: Parakeet's part of each: ${heardMs.join(", ")} ms`);
  await web.dispose();
});

async function waitForWindow(electronApp, match, timeoutMs = 20_000) {
  const t0 = Date.now();
  for (;;) {
    for (const w of electronApp.windows()) if (match(w.url())) return w;
    if (Date.now() - t0 > timeoutMs) throw new Error("window not found");
    await Promise.race([electronApp.waitForEvent("window", { timeout: 1000 }).catch(() => null), sleep(250)]);
  }
}
