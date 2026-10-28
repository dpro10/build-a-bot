/**
 * The desktop app, filmed on a made-up desktop (desktop/scene.cjs) under Xvfb, against
 * build-a-bot.site with the demo account, with NVIDIA's real runtime and Parakeet hearing on this
 * computer:
 *
 *   voice     hold Right Ctrl over a "New message" window, the dictation plays into the app's
 *             microphone, let go: the words land in the window, cleaned up
 *   meeting   a video call starts, Juno peeks up and asks, Take notes, the call plays into the
 *             microphone and Parakeet captions it live, Stop: the notes get written
 *
 * The pointer is real (XTest), drawn the same way as in the web recordings. Recorded at 2× like the
 * web scenes (2560×1440 for a 1280×720 screen), 60 fps, with markers.
 *   node video/demo/record/desktop.mjs voice|meeting
 *
 * Needs NVIDIA's files (nemo-speech-0.2.0-linux-x86_64-cpu.tar.gz, itn_configs.tar.bz2,
 * parakeet-tdt-0.6b-v3.q8_0.gguf) in BAB_SPEECH_FILES, the sign-in (record/signin.mjs) and Juno
 * (record/builder.mjs). The dictation and the meeting are video/out/demo/el/desk/*.wav.
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { _electron as electron, request } from "playwright";
import { CLIPS, OUT, PROXY, ROOT, SITE, loadAccount, loadSession, sleep } from "./recorder.mjs";

const MODE = process.argv[2] ?? "voice";
const APP_DIR = path.join(ROOT, "desktop");
const ELECTRON = path.join(APP_DIR, "node_modules", "electron", "dist", "electron");
const SCENE = path.join(ROOT, "video", "demo", "desktop", "scene.cjs");
const XINPUT = path.join(ROOT, "video", "demo", "desktop", "xinput.py");
const FILES = process.env.BAB_SPEECH_FILES;
const DESK = path.join(OUT, "el", "desk");
const USER_DATA = path.join(OUT, "desktop-user");
const DISPLAY = process.env.BAB_DESKTOP_DISPLAY ?? ":98";
const W = 2560;
const H = 1440;
const SCALE = 2;
if (!FILES) throw new Error("Set BAB_SPEECH_FILES to the folder with NVIDIA's files.");
fs.mkdirSync(USER_DATA, { recursive: true });

const x = (...args) => new Promise((resolve, reject) => execFile("python3", [XINPUT, ...args.map(String)], { env: { ...process.env, DISPLAY } }, (err, _o, e) => (err ? reject(new Error(e || err.message)) : resolve())));
/** Screen DIPs → the pointer, gliding. */
const glide = (px, py, ms = 700) => x("glide", Math.round(px * SCALE), Math.round(py * SCALE), ms);

async function until(what, fn, timeoutMs = 30000, everyMs = 200) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}

/** The virtual screen, with a compositor so see-through windows (the pill, Juno) show as they do. */
function screen() {
  const sock = `/tmp/.X11-unix/X${DISPLAY.slice(1)}`;
  if (!fs.existsSync(sock)) {
    spawn("Xvfb", [DISPLAY, "-screen", "0", `${W}x${H}x24`, "-nolisten", "tcp"], { stdio: "ignore", detached: true }).unref();
    for (let i = 0; i < 50 && !fs.existsSync(sock); i++) execFileSync("sleep", ["0.1"]);
    spawn("xcompmgr", ["-n"], { env: { ...process.env, DISPLAY }, stdio: "ignore", detached: true }).unref();
    execFileSync("sleep", ["0.5"]);
  }
}

/** NVIDIA's files, served from here the way GitHub and Hugging Face serve them (they still have to match the pinned hashes). */
async function serveFiles(dir) {
  const srv = http.createServer((req, res) => {
    const file = path.join(dir, path.basename(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)));
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      res.writeHead(404);
      return res.end();
    }
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
    const start = m ? Number(m[1]) : 0;
    res.writeHead(m ? 206 : 200, { "content-length": st.size - start, "accept-ranges": "bytes", ...(m ? { "content-range": `bytes ${start}-${st.size - 1}/${st.size}` } : {}) });
    fs.createReadStream(file, { start }).pipe(res);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", () => r(undefined)));
  return { base: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() };
}

/** A 16-bit WAV with quiet before and after (a person presses, then talks), for the fake microphone. */
function micFile(src, dest, beforeSec, afterSec) {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-af", `adelay=${Math.round(beforeSec * 1000)}:all=1,apad=pad_dur=${afterSec}`, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", dest]);
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]).toString().trim());
}

/** The screen recorder: the whole virtual screen at 60 fps; x11grab stamps frames with the wall clock. */
class ScreenTake {
  constructor(name) {
    this.name = name;
    this.marks = [];
  }
  async start() {
    this.raw = path.join(CLIPS, `${this.name}.raw.mkv`);
    this.ff = spawn("ffmpeg", ["-hide_banner", "-y", "-f", "x11grab", "-framerate", "60", "-video_size", `${W}x${H}`, "-draw_mouse", "0", "-i", `${DISPLAY}+0,0`, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", "-pix_fmt", "yuv420p", this.raw], { stdio: ["pipe", "ignore", "pipe"] });
    this.closed = new Promise((r) => this.ff.on("close", r));
    let err = "";
    this.t0 = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`screen recorder didn't start\n${err}`)), 10000);
      this.ff.stderr.on("data", (d) => {
        err += d;
        const m = /start: (\d+\.\d+)/.exec(err);
        if (m) {
          clearTimeout(timer);
          resolve(Number(m[1]));
        }
      });
    });
    return this;
  }
  mark(label) {
    this.marks.push({ label, t: Number((Date.now() / 1000 - this.t0).toFixed(3)) });
    console.log(`  ${label} @ ${this.marks.at(-1).t}`);
  }
  async stop(extra = {}) {
    const end = Date.now() / 1000;
    this.ff.stdin.write("q");
    this.ff.stdin.end();
    await this.closed;
    const mp4 = path.join(CLIPS, `${this.name}.mp4`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", this.raw, "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
    fs.rmSync(this.raw, { force: true });
    const info = { name: this.name, t0: this.t0, duration: end - this.t0, size: [W, H], marks: this.marks, ...extra };
    fs.writeFileSync(path.join(CLIPS, `${this.name}.json`), JSON.stringify(info, null, 2));
    console.log(`${this.name}: ${info.duration.toFixed(1)} s → ${path.relative(ROOT, mp4)}`);
    return info;
  }
}

async function waitForWindow(app, match, timeoutMs = 20000) {
  const t0 = Date.now();
  for (;;) {
    for (const w of app.windows()) if (match(w.url())) return w;
    if (Date.now() - t0 > timeoutMs) throw new Error("window not found");
    await Promise.race([app.waitForEvent("window", { timeout: 1000 }).catch(() => null), sleep(250)]);
  }
}

/** Where an element of one of the app's windows is on the screen, in DIPs. */
async function onScreen(app, win, selector) {
  const url = win.url();
  const bounds = await app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === u)?.getBounds(), url);
  const box = await win.locator(selector).first().boundingBox();
  return { x: bounds.x + box.x + box.width / 2, y: bounds.y + box.y + box.height / 2 };
}

screen();
const account = loadAccount();
const session = loadSession();
const files = await serveFiles(FILES);
const callFile = path.join(USER_DATA, "call.txt");
fs.writeFileSync(callFile, "");
const mic = path.join(USER_DATA, `mic-${MODE}.wav`);
const LEAD = MODE === "voice" ? 0.6 : 1.0;
// Long quiet after: Chromium plays the file in a loop, and the meeting must not start over.
const said = micFile(path.join(DESK, MODE === "voice" ? "dictation.wav" : "meeting.wav"), mic, LEAD, MODE === "voice" ? 3 : 240);

const app = await electron.launch({
  executablePath: ELECTRON,
  args: ["--no-sandbox", `--force-device-scale-factor=${SCALE}`, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${mic}`, ...(PROXY ? [`--proxy-server=${PROXY.server}`] : []), APP_DIR],
  env: {
    ...process.env,
    DISPLAY,
    BAB_USER_DATA: USER_DATA,
    BAB_SERVER: SITE,
    BAB_TEST: "1",
    BAB_ALLOW_PLAINTEXT_TOKEN: "1",
    BAB_VOICE_ENABLE: "1",
    BAB_SYSTEM_AUDIO: "off",
    BAB_FAKE_MEETING_FILE: callFile,
    BAB_DETECT_INTERVAL_MS: "700",
    BAB_DETECT_SUSTAIN_MS: "1000",
    BAB_CALL_END_GRACE_MS: "3000",
    BAB_SPEECH_RUNTIME_URL: `${files.base}/nemo-speech-0.2.0-linux-x86_64-cpu.tar.gz`,
    BAB_SPEECH_ITN_URL: `${files.base}/itn_configs.tar.bz2`,
    BAB_SPEECH_MODEL_URL: `${files.base}/parakeet-tdt-0.6b-v3.q8_0.gguf`,
  },
});
const logs = [];
app.process().stdout?.on("data", (d) => logs.push(String(d)));
app.process().stderr?.on("data", (d) => logs.push(String(d)));
const probe = async () => await app.evaluate(() => globalThis.__babTest?.state() ?? null).catch(() => null);
let scene = null;
let raiser = null;

try {
  // ---- paired with the demo account, once (the pairing lives in USER_DATA)
  const first = await app.firstWindow();
  await first.waitForLoadState("domcontentloaded");
  if (await first.locator("#signed-out:not([hidden])").isVisible().catch(() => false)) {
    const web = await request.newContext({ baseURL: SITE, proxy: PROXY, storageState: account.storage, extraHTTPHeaders: { origin: SITE } });
    const { code } = await (await web.post("/api/bridge/pairing-code")).json();
    await web.dispose();
    await first.fill("#code", code);
    await first.click("#pair-button");
    await first.waitForSelector("#paired:not([hidden])", { timeout: 30000 });
    console.log("paired with the demo account");
  }
  // ---- NVIDIA Parakeet here, loaded
  // Downloaded and checked once; after a restart it loads on the first dictation.
  await until("NVIDIA Parakeet on this computer", async () => ["installed", "starting", "ready"].includes((await probe())?.voice?.local?.state), 600000, 500);
  console.log(`Parakeet is here (${(await probe())?.voice?.local?.state})`);
  for (const w of app.windows()) await w.close().catch(() => {});
  await sleep(1000);

  // ---- the made-up desktop
  const sceneOut = path.join(USER_DATA, "scene.txt");
  const sceneCmd = path.join(USER_DATA, "scene-cmd.json");
  fs.writeFileSync(sceneCmd, "{}");
  scene = spawn(ELECTRON, ["--no-sandbox", `--force-device-scale-factor=${SCALE}`, SCENE], { env: { ...process.env, DISPLAY, SCENE: MODE === "voice" ? "compose" : "call", SCENE_OUT: sceneOut, SCENE_CMD: sceneCmd }, stdio: "ignore" });
  await sleep(2500);
  // No window manager: keep the drawn pointer above everything, the app's windows included.
  raiser = spawn("bash", ["-c", 'while true; do xdotool search --name "^video-cursor$" windowraise >/dev/null 2>&1; sleep 0.1; done'], { env: { ...process.env, DISPLAY }, stdio: "ignore" });
  let n = 0;
  const cmd = (c) => fs.writeFileSync(sceneCmd, JSON.stringify({ n: ++n, ...c }));
  await x("move", 1700, 1000);

  if (MODE === "voice") {
    // A warm-up dictation off camera, so Parakeet is loaded; then an empty box.
    if ((await probe())?.voice?.local?.state !== "ready") {
      await x("key-down", "Control_R", "sleep", 2.2, "key-up", "Control_R");
      await until("the warm-up typed", () => (fs.readFileSync(sceneOut, "utf8").trim() ? true : null), 90000, 200).catch(() => console.log("the warm-up typed nothing"));
      await until("Parakeet loaded", async () => (await probe())?.voice?.local?.state === "ready", 60000, 300).catch(() => {});
      await sleep(2500);
      cmd({ clear: true });
      await sleep(600);
    }
    const take = await new ScreenTake("voice").start();
    await sleep(1200);
    // A click in the message, then hold the key and talk.
    await glide(560, 330, 800);
    await x("click");
    await sleep(900);
    take.mark("hold");
    await x("key-down", "Control_R");
    await until("the pill listening", async () => (await probe())?.voice?.phase === "listening", 10000, 50);
    take.mark("listening");
    await sleep((LEAD + said + 0.7) * 1000);
    await x("key-up", "Control_R");
    take.mark("let-go");
    await until("the words in the message", () => (fs.readFileSync(sceneOut, "utf8").trim() ? true : null), 60000, 50);
    take.mark("typed");
    await sleep(800);
    await glide(900, 560, 900);
    await sleep(2200);
    const text = fs.readFileSync(sceneOut, "utf8");
    console.log(`typed: ${JSON.stringify(text)}`);
    await take.stop({ typed: text, said, lead: LEAD });
  } else {
    const take = await new ScreenTake("meeting").start();
    await sleep(1500);
    // The call starts; a moment later Juno peeks up and asks.
    fs.writeFileSync(callFile, "browser");
    take.mark("call");
    const buddy = await waitForWindow(app, (u) => u.includes("/desktop/buddy"), 30000);
    await until("Juno asking", async () => (await probe())?.phase === "asking" && (await probe())?.buddyShowing, 30000, 100);
    take.mark("asking");
    await sleep(1800);
    // The pointer goes there on screen; the press goes to the page (on Linux the see-through
    // window can't feel the pointer, so OS clicks pass through it, as the app's own tests know).
    const btn = await onScreen(app, buddy, "button:has-text('Take notes')");
    await glide(btn.x, btn.y, 900);
    await sleep(300);
    await buddy.click("button:has-text('Take notes')");
    take.mark("take-notes");
    await until("listening", async () => (await probe())?.phase === "listening", 20000, 50);
    take.mark("listening");
    // The call plays into the mic from the moment it opens: light up whoever's talking.
    const t0 = Date.now() + LEAD * 1000;
    const turns = [["Maya", 5.6], ["Diego", 2.72], ["Maya", 4.32], ["Sam", 4.48], ["Maya", 6.72], ["Diego", 0.88]];
    const gaps = [0.4, 0.4, 0.35, 0.4, 0.3, 0];
    let at = 0;
    for (const [i, [who, dur]] of turns.entries()) {
      while (Date.now() < t0 + at * 1000) await sleep(20);
      cmd({ speaking: who });
      at += dur;
      while (Date.now() < t0 + at * 1000) await sleep(20);
      cmd({ speaking: null });
      at += gaps[i];
    }
    take.mark("talked");
    await until("a caption", async () => Boolean((await probe())?.caption?.text), 15000, 200).catch(() => console.log("no caption yet"));
    take.mark("captioned");
    await sleep(1500);
    // Stop: hover the timer, then Stop and write notes.
    const timer = await onScreen(app, buddy, "span.font-mono");
    await glide(timer.x, timer.y, 800);
    await buddy.locator("span.font-mono").hover();
    await sleep(700);
    const stop = await onScreen(app, buddy, "button[aria-label='Stop and write notes']");
    await glide(stop.x, stop.y, 500);
    await sleep(300);
    await buddy.click("button[aria-label='Stop and write notes']");
    take.mark("stop");
    await buddy.waitForSelector("text=Your notes are ready!", { timeout: 240000 });
    take.mark("notes-ready");
    await sleep(2500);
    const state = await probe();
    await take.stop({ said, lead: LEAD, meetingId: state?.meetingId ?? null });
    fs.writeFileSync(path.join(OUT, "meeting.json"), JSON.stringify({ botId: session.botId, meetingId: state?.meetingId ?? null, at: new Date().toISOString() }, null, 2));
  }
} catch (err) {
  console.log(`--- app log (last 60 lines) ---\n${logs.join("").split("\n").slice(-60).join("\n")}`);
  console.log(`--- state ---\n${JSON.stringify(await probe(), null, 2)?.slice(0, 3000)}`);
  throw err;
} finally {
  raiser?.kill();
  scene?.kill();
  await Promise.race([app.close().catch(() => {}), sleep(8000)]);
  files.close();
  // Electron's helpers and the file server's open sockets can keep node alive after a take.
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
