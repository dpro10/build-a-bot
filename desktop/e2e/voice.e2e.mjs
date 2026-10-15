/**
 * Voice typing end to end, against a Build-a-bot dev server in demo mode (BAB_E2E_SERVER,
 * default http://localhost:3000), under Xvfb with Chromium's fake microphone:
 *
 *   npm run test:e2e
 *
 * Real key presses (XTest, e2e/fixtures/xkey.py) hold the shortcut (Right Ctrl on Linux); the
 * app records, the demo server "hears" a sample line and cleans it up, and the app pastes it into
 * another app (e2e/fixtures/target-app.cjs) and puts the clipboard back. Then: the settings
 * window and its try-it box, a dictionary word, hands-free (two taps), Esc, and "Hey Otto, …".
 * Screenshots of the pill go to BAB_E2E_SHOTS (default: <tmp>/bab-desktop-e2e).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, request } from "playwright";

const APP_DIR = fileURLToPath(new URL("../", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const SERVER = process.env.BAB_E2E_SERVER ?? "http://localhost:3000";
const SHOTS = process.env.BAB_E2E_SHOTS ?? path.join(os.tmpdir(), "bab-desktop-e2e");
const ELECTRON = path.join(APP_DIR, "node_modules", "electron", "dist", "electron");
fs.mkdirSync(SHOTS, { recursive: true });

/** What the demo server types for its first sample line (src/lib/dictation/demo.ts), with the word added below. */
const TYPED = "I was thinking we could move the Team Meeting to Friday at 3.";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A steady, voice-like sound for the fake microphone (Chromium's own only beeps once a second,
 * which is too little "speech" for a short hold): 6 s of a 180 Hz tone, swelling like syllables.
 */
function toneWav(file) {
  const rate = 48000;
  const n = rate * 6;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const swell = 0.55 + 0.45 * Math.sin(2 * Math.PI * 3 * t);
    const v = 0.3 * swell * (Math.sin(2 * Math.PI * 180 * t) + 0.4 * Math.sin(2 * Math.PI * 360 * t));
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
  return file;
}

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

/** Real key presses through XTest. */
function keys(...args) {
  return new Promise((resolve, reject) => execFile("python3", [path.join(FIXTURES, "xkey.py"), ...args.map(String)], (err, _o, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())));
}

let app = null;
let target = null;
after(async () => {
  target?.kill();
  if (app) await app.close().catch(() => {});
});

test("hold a key, talk, let go: it's typed in the app you're in", { timeout: 300_000 }, async () => {
  if (process.platform !== "linux" || !process.env.DISPLAY) {
    console.log("voice e2e: needs Linux with an X display (xvfb-run); skipped");
    return;
  }
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

  // ---- the app, with voice typing on and the demo's first line
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bab-voice-e2e-"));
  const demoFile = path.join(userData, "demo-sample.txt");
  fs.writeFileSync(demoFile, "0");
  app = await electron.launch({
    executablePath: ELECTRON,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${toneWav(path.join(userData, "voice.wav"))}`, APP_DIR],
    env: { ...process.env, BAB_USER_DATA: userData, BAB_SERVER: SERVER, BAB_TEST: "1", BAB_ALLOW_PLAINTEXT_TOKEN: "1", BAB_VOICE_ENABLE: "1", BAB_VOICE_DEMO_FILE: demoFile },
  });
  const logs = [];
  app.process().stdout?.on("data", (d) => logs.push(String(d)));
  app.process().stderr?.on("data", (d) => logs.push(String(d)));
  const probe = async () => (await app.evaluate(() => globalThis.__babTest?.state() ?? null))?.voice ?? null;
  const step = async (name, fn) => {
    try {
      return await fn();
    } catch (err) {
      console.log(`--- app log (last 60 lines) at "${name}" ---\n${logs.join("").split("\n").slice(-60).join("\n")}`);
      console.log(`--- voice state ---\n${JSON.stringify(await probe().catch(() => null), null, 2)}`);
      throw err;
    }
  };

  // ---- pair
  const pairWin = await app.firstWindow();
  await pairWin.waitForSelector("#signed-out:not([hidden])");
  await pairWin.fill("#code", code);
  await pairWin.click("#pair-button");
  await pairWin.waitForSelector("#paired:not([hidden])", { timeout: 20_000 });
  await step("hold mode", () => until("the shortcut to be heard", async () => (await probe())?.mode === "hold", 20_000));
  await pairWin.waitForSelector("text=Voice typing settings");

  // ---- the settings window: how to use it, a word for the dictionary, and the try-it box
  await pairWin.click("#voice-open");
  const voiceWin = await step("voice window", () => waitForWindow(app, (u) => u.startsWith("bab-app://voice")));
  await voiceWin.waitForSelector("#main:not([hidden])");
  assert.match(await voiceWin.textContent("#how"), /Hold Right Ctrl and talk/);
  assert.match(await voiceWin.textContent("#tip-bot"), /Hey Otto/);
  await voiceWin.fill("#word", "Team Meeting");
  await voiceWin.click("#word-form button[type=submit]");
  await voiceWin.waitForSelector("#words li:has-text('Team Meeting')");
  const dict = await (await web.get("/api/voice/dictionary")).json();
  assert.deepEqual(dict.entries.map((e) => e.text), ["Team Meeting"], "the word is saved to the account");

  // Under Xvfb there's no window manager to give a clicked window the keyboard: focus it.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith("bab-app://voice"))?.focus());
  await voiceWin.click("#try-box");
  await keys("down", "Control_R", "sleep", "2", "up", "Control_R");
  await step("try box", () => until("the words in the try box", async () => (await voiceWin.inputValue("#try-box")).includes(TYPED), 30_000));
  // What it heard, under the box: the ums and the correction it took out.
  await voiceWin.waitForSelector("#try-heard:not([hidden]):has-text('No wait, Friday at three')");
  await voiceWin.waitForSelector(`#history-list li:has-text("${TYPED}")`);
  await voiceWin.screenshot({ path: path.join(SHOTS, "voice-0-settings.png"), fullPage: true });
  await voiceWin.close();
  await pairWin.close();

  // ---- another app: the words land where its cursor is, and the clipboard is put back
  const outFile = path.join(userData, "target.txt");
  const clipFile = path.join(userData, "clip.txt");
  target = spawn(ELECTRON, ["--no-sandbox", path.join(FIXTURES, "target-app.cjs")], { env: { ...process.env, TARGET_OUT: outFile, TARGET_CLIP: clipFile }, stdio: ["ignore", "pipe", "pipe"] });
  await until("the target app", () => fs.existsSync(clipFile) && fs.readFileSync(clipFile, "utf8") === "ORIGINAL CLIPBOARD", 20_000);
  const typed = () => fs.readFileSync(outFile, "utf8");
  const count = (s) => typed().split(s).length - 1;

  await keys("down", "Control_R");
  const pill = await step("pill", () => waitForWindow(app, (u) => u.startsWith("bab-app://dictation")));
  await until("listening", async () => (await probe())?.phase === "listening", 10_000);
  await sleep(700);
  await pill.screenshot({ path: path.join(SHOTS, "voice-1-listening.png"), omitBackground: true });
  await sleep(800);
  await keys("up", "Control_R");
  await step("pasted", () => until("the words in the other app", () => typed().includes(TYPED), 30_000));
  await until("done", async () => ["done", null].includes((await probe())?.phase), 10_000);
  await pill.screenshot({ path: path.join(SHOTS, "voice-2-done.png"), omitBackground: true }).catch(() => {});
  await until("the clipboard put back", () => fs.readFileSync(clipFile, "utf8") === "ORIGINAL CLIPBOARD", 10_000);
  assert.equal(count(TYPED), 1);

  // ---- hands-free: tap twice, talk, tap once more
  await until("the pill to go", async () => (await probe())?.phase === null, 10_000);
  await keys("tap", "Control_R", "sleep", "0.12", "tap", "Control_R");
  await until("hands-free", async () => (await probe())?.pill?.handsfree === true, 10_000);
  await pill.screenshot({ path: path.join(SHOTS, "voice-3-handsfree.png"), omitBackground: true });
  await sleep(1500);
  await keys("tap", "Control_R");
  await step("hands-free paste", () => until("the second paste", () => count(TYPED) === 2, 30_000));

  // ---- Esc throws it away
  await until("the pill to go", async () => (await probe())?.phase === null, 10_000);
  await keys("down", "Control_R", "sleep", "1", "tap", "Escape", "sleep", "0.3", "up", "Control_R");
  await sleep(2500);
  assert.equal(count(TYPED), 2, "nothing typed after Esc");

  // ---- "Hey Otto, …": the bot answers in the pill; Paste types its answer
  fs.writeFileSync(demoFile, "command");
  await keys("down", "Control_R", "sleep", "1.5", "up", "Control_R");
  const reply = await step("reply", () => until("Otto's answer", async () => ((await probe())?.phase === "reply" ? probe() : null), 60_000));
  assert.equal(reply.pill.command, "Remind me to call Mom tomorrow at 5.");
  assert.ok(reply.pill.message.length > 0);
  await pill.screenshot({ path: path.join(SHOTS, "voice-4-reply.png"), omitBackground: true });
  assert.equal(count(TYPED), 2, "a request for the bot isn't typed");
  const chat = await (await web.get(`/api/bots/${botId}/messages`)).json();
  const asked = chat.messages.find((m) => m.role === "user" && m.text === "Remind me to call Mom tomorrow at 5.");
  assert.ok(asked, "the request is in Otto's chat");
  assert.equal(asked.meta?.via, "voice");
  const before = typed();
  await pill.click("button:has-text('Paste')");
  await step("reply pasted", () => until("the answer typed", () => typed().length > before.length, 15_000));

  // ---- what's kept: the history on this computer, a word count on the server
  const v = await probe();
  assert.equal(v.history, 4, "3 dictations and 1 request");
  assert.ok(v.usage.words >= 36, `words counted: ${v.usage.words}`);
  assert.equal(v.usage.limit, 8000);
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
