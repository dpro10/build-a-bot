/**
 * End to end, against a running Build-a-bot dev server in demo mode (default
 * http://localhost:3000; BAB_E2E_SERVER to change it), under Xvfb:
 *
 *   npm run test:e2e        (xvfb-run -a node --test e2e/*.e2e.mjs)
 *
 * It makes a demo account with a bot, turns on Meeting notes, gets a pairing code,
 * pairs the app through its pairing window, fakes a Zoom call (BAB_FAKE_MEETING_FILE)
 * and Chromium's fake microphone, then clicks through the bot at the bottom of the
 * screen: ask → Take notes → live captions → pause → resume → stop → notes ready,
 * then "Stop and delete", "Not now", and a call that ends on its own.
 *
 * Private speech is off here (BAB_PRIVATE_SPEECH=off): the pieces' audio goes to the server, whose
 * scripted speech (DEMO_SPEECH, on in a dev server) hears the demo meeting. NVIDIA Parakeet
 * hearing a meeting on the computer, with real speech, is e2e/meeting-parakeet.e2e.mjs.
 * Screenshots of each phase go to BAB_E2E_SHOTS (default: <tmp>/bab-desktop-e2e).
 *
 * Uses Playwright from the web app's node_modules (or a local `npm i -D playwright`).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, chromium, request } from "playwright";

const APP_DIR = fileURLToPath(new URL("../", import.meta.url));
const SERVER = process.env.BAB_E2E_SERVER ?? "http://localhost:3000";
const SHOTS = process.env.BAB_E2E_SHOTS ?? path.join(os.tmpdir(), "bab-desktop-e2e");
const ELECTRON = path.join(APP_DIR, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron");
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn` until it returns something truthy. */
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

let app = null;
const shots = [];
after(async () => {
  if (app) await app.close().catch(() => {});
  if (shots.length) await contactSheet().catch((err) => console.log(`contact sheet: ${err.message}`));
});

test("pairs, notices a Zoom call, asks first, takes notes, and the notes get written", { timeout: 300_000 }, async () => {
  // ---- a signed-in demo owner with a bot, meeting notes on, and a pairing code
  const web = await request.newContext({ baseURL: SERVER, extraHTTPHeaders: { origin: SERVER } });
  const created = await web.post("/api/bots", {
    data: {
      avatar: "otto",
      color: "grape",
      name: "Inky",
      jobs: ["meetings"],
      brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
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
  const on = await web.post(`/api/bots/${botId}/connections`, { data: { connectorId: "meetings" } });
  assert.ok(on.ok(), `meeting notes on: ${on.status()} ${await on.text()}`);
  const pc = await web.post("/api/bridge/pairing-code");
  assert.ok(pc.ok(), `pairing code: ${pc.status()}`);
  const { code } = await pc.json();

  // ---- launch the app (fake call file, fake mic, short timings)
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bab-e2e-"));
  const callFile = path.join(userData, "call.txt");
  fs.writeFileSync(callFile, "");
  app = await electron.launch({
    executablePath: ELECTRON,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", APP_DIR],
    env: {
      ...process.env,
      BAB_USER_DATA: userData,
      BAB_SERVER: SERVER,
      BAB_TEST: "1",
      BAB_ALLOW_PLAINTEXT_TOKEN: "1",
      BAB_FAKE_MEETING_FILE: callFile,
      BAB_DETECT_INTERVAL_MS: "700",
      BAB_DETECT_SUSTAIN_MS: "1000",
      BAB_CALL_END_GRACE_MS: "3000",
      BAB_NOT_NOW_COOLDOWN_MS: "1500",
      BAB_PRIVATE_SPEECH: "off",
    },
  });
  const logs = [];
  app.process().stdout?.on("data", (d) => logs.push(String(d)));
  app.process().stderr?.on("data", (d) => logs.push(String(d)));
  const probe = () => app.evaluate(() => globalThis.__babTest?.state() ?? null);
  /** The bot is really on screen, asking (not just a stale page in a hidden window). */
  const asking = async (buddyPage) => {
    await until("asking", async () => {
      const st = await probe();
      return st.phase === "asking" && st.buddyShowing;
    }, 20_000);
    await buddyPage.waitForSelector("text=Want me to take notes?", { timeout: 5000 });
  };
  const step = async (name, fn) => {
    try {
      return await fn();
    } catch (err) {
      console.log(`--- app log (last 60 lines) at "${name}" ---\n${logs.join("").split("\n").slice(-60).join("\n")}`);
      throw err;
    }
  };

  // ---- pair through the pairing window
  const pairWin = await step("pairing window", () => app.firstWindow());
  await pairWin.waitForSelector("#signed-out:not([hidden])");
  assert.equal(await pairWin.inputValue("#server"), SERVER, "the dev server is prefilled");
  await pairWin.fill("#code", code.replace("-", "").toLowerCase());
  assert.equal(await pairWin.inputValue("#code"), code, "the code is formatted as you type");
  await snap(pairWin, "0-pairing", { transparent: false });
  await pairWin.click("#pair-button");
  await step("paired", () => pairWin.waitForSelector("#paired:not([hidden])", { timeout: 20_000 }));
  await pairWin.waitForSelector(`input[name=bot][value="${botId}"]:checked`);
  await snap(pairWin, "0-paired", { transparent: false });
  let s = await probe();
  assert.equal(s.paired, true);
  assert.equal(s.stored, "plaintext", "no keychain under Xvfb: stored only because BAB_ALLOW_PLAINTEXT_TOKEN=1");
  assert.equal(s.botId, botId);
  const deviceJson = fs.readFileSync(path.join(userData, "device.json"), "utf8");
  assert.match(deviceJson, /"enc": "plaintext"/);

  // ---- a Zoom call starts: the bot peeks up and asks (nothing is recorded yet)
  fs.writeFileSync(callFile, "zoom");
  const buddy = await step("buddy window", () => waitForWindow(app, (u) => u.includes("/desktop/buddy")));
  await step("asking", () => asking(buddy));
  s = await probe();
  assert.equal(s.phase, "asking");
  assert.equal(s.meetingId, null, "nothing recorded before the owner says yes");
  assert.equal(s.buddyShowing, true);
  const wa = s.workArea;
  assert.deepEqual(s.buddyBounds, { x: wa.x + Math.round((wa.width - 440) / 2), y: wa.y + wa.height - 330, width: 440, height: 330 }, "bottom-center, 440×330 while asking");
  assert.match(s.buddyUrl, /phase=asking/);
  assert.match(s.buddyUrl, /name=Inky/);
  assert.match(s.buddyUrl, /app=zoom/);
  assert.ok(await buddy.isVisible("text=Don't ask in Zoom"));
  await snap(buddy, "1-asking");

  // The page's own permission to the mic is denied (only the hidden capture page may record).
  const pagePerm = await buddy.evaluate(() => navigator.permissions.query({ name: "microphone" }).then((p) => p.state).catch((e) => String(e)));
  assert.notEqual(pagePerm, "granted");
  assert.equal(await buddy.evaluate(() => typeof window.babDesktop?.onState), "function");
  assert.equal(await buddy.evaluate(() => Object.keys(window.babDesktop).sort().join(",")), "act,copy,onState,setInteractive");
  assert.equal(await buddy.evaluate(() => typeof window.require), "undefined", "no Node in the page");

  // Copy the heads-up first: the start then records that everyone was told.
  await buddy.click("text=Copy a heads-up");
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.match(clip, /my AI assistant Inky to take notes on this call/);

  // ---- Take notes
  await buddy.click("button:has-text('Take notes')");
  s = await step("listening", () => until("listening", async () => ((await probe()).phase === "listening" ? probe() : null), 20_000));
  const meetingId = s.meetingId;
  assert.ok(meetingId?.startsWith("mtg_"), meetingId);
  assert.ok(["unavailable", "denied", "ok"].includes(s.system), `system audio: ${s.system}`);
  console.log(`system audio under Xvfb: ${s.system}`);
  await until("listening size", async () => {
    const b = (await probe()).buddyBounds;
    return b.width === 720 && b.height === 200 && b.x === wa.x + Math.round((wa.width - 720) / 2) && b.y === wa.y + wa.height - 200;
  });

  // Chunks upload and the demo transcript comes back as a live caption.
  await step("caption", () => buddy.waitForSelector("text=Okay, thanks everyone for joining", { timeout: 45_000 }));
  s = await probe();
  assert.ok(s.uploads.uploaded >= 1, "at least one chunk uploaded");
  assert.equal(s.spoolFiles, 0, "nothing waiting on disk");
  await snap(buddy, "2-listening");
  const pill = buddy.locator("span.font-mono").first();
  await pill.hover();
  await buddy.waitForSelector("button[aria-label='Stop and write notes']", { state: "visible" });
  await sleep(300); // the controls slide open
  await snap(buddy, "3-listening-hover");
  // Every control is inside the window (nothing cut off at the edge).
  const fits = (sel) => buddy.evaluate((q) => [...document.querySelectorAll(q)].every((el) => el.getBoundingClientRect().right <= window.innerWidth && el.getBoundingClientRect().left >= 0), sel);
  assert.ok(await fits("button[aria-label='Pause'], button[aria-label='Stop and write notes'], button[aria-label='Stop and delete everything']"), "the pill's buttons fit in the window");
  await buddy.click("button[aria-label='Stop and delete everything']");
  await buddy.waitForSelector("text=Delete it all?");
  await sleep(250);
  assert.ok(await fits("button"), "'Delete it all?' fits too");
  await snap(buddy, "3b-delete-confirm");
  await sleep(4300); // the confirm goes away on its own after 4 s; nothing was deleted
  assert.equal((await probe()).phase, "listening");

  // ---- pause (time stops, the mic is let go) and resume
  await buddy.click("button[aria-label='Pause']");
  await until("paused", async () => (await probe()).phase === "paused");
  await buddy.waitForSelector("text=Paused");
  await snap(buddy, "4-paused");
  await sleep(1500);
  const pausedClock = await buddy.textContent("span.font-mono");
  await sleep(1500);
  assert.equal(await buddy.textContent("span.font-mono"), pausedClock, "the timer doesn't move while paused");
  await buddy.locator("span.font-mono").hover();
  await buddy.click("button[aria-label='Resume']");
  await until("resumed", async () => (await probe()).phase === "listening");
  await sleep(7000); // one more chunk after resuming

  // ---- Stop via the buddy: saving → done
  await buddy.locator("span.font-mono").hover();
  await buddy.click("button[aria-label='Stop and write notes']");
  await step("saving", () => until("saving", async () => ["stopping", "saving"].includes((await probe()).phase), 10_000, 50));
  await snap(buddy, "5-saving").catch(() => {});
  await step("done", () => buddy.waitForSelector("text=Your notes are ready!", { timeout: 60_000 }));
  s = await probe();
  assert.equal(s.phase, "done");
  assert.deepEqual({ w: s.buddyBounds.width, h: s.buddyBounds.height }, { w: 420, h: 230 });
  assert.ok(s.stats.notifications.some((n) => /^Notes from “.+” are ready$/.test(n)), JSON.stringify(s.stats.notifications));
  await snap(buddy, "6-done");

  // ---- every chunk was a complete webm file, back to back on the timeline (pauses excluded)
  const chunks = s.stats.chunkLog.filter((c) => c.track === "mic");
  assert.ok(chunks.length >= 3, `mic chunks: ${chunks.length}`);
  for (const c of s.stats.chunkLog) assert.equal(c.head, "1a45dfa3", `chunk ${c.track}#${c.chunk} starts with the EBML (webm) header`);
  for (let i = 1; i < chunks.length; i++) {
    assert.equal(chunks[i].chunk, chunks[i - 1].chunk + 1);
    assert.ok(Math.abs(chunks[i].startMs - (chunks[i - 1].startMs + chunks[i - 1].durationMs)) <= 50, `chunk ${chunks[i].chunk} continues where ${chunks[i - 1].chunk} ended`);
  }
  // A chunk ends at a pause near chunkMs (6 s in demo mode): from 15% before it to 25% after (the beeps leave pauses).
  const full = chunks.filter((c) => c.cut === "pause" || c.cut === "time");
  assert.ok(full.length >= 2, `chunks that ended on their own: ${full.length}`);
  for (const c of full) assert.ok(c.durationMs >= 6000 * 0.85 - 100 && c.durationMs <= 6000 * 1.25 + 300, `chunk ${c.chunk}: ${c.durationMs} ms (${c.cut})`);
  assert.ok(full.some((c) => c.cut === "pause"), "chunks end at a pause in the sound when there is one");
  assert.ok(chunks.some((c) => !c.silent), "the fake mic's beeps count as sound");
  console.log(`chunks: ${s.stats.chunkLog.map((c) => `${c.track}#${c.chunk}@${c.startMs}+${c.durationMs}${c.silent ? "(silent)" : ""}[${c.cut}]:${c.bytes}B`).join(" ")}`);

  // ---- the server agrees: notes written, transcript kept, consent recorded
  const res = await web.get(`/api/bots/${botId}/meetings/${meetingId}`);
  assert.ok(res.ok());
  const body = await res.json();
  assert.equal(body.meeting.status, "ready");
  assert.equal(body.meeting.source, "desktop");
  assert.equal(body.meeting.app, "zoom");
  assert.ok(body.meeting.notes && body.meeting.notes.length > 20, "notes were written");
  assert.ok(body.meeting.actionItems.length >= 1, "with action items");
  assert.equal(body.meeting.noticeCopied, true, "the heads-up copy was recorded");
  assert.ok(body.segments.some((x) => /Okay, thanks everyone for joining/.test(x.text)));
  assert.ok(body.meeting.durationSec >= 6 && body.meeting.durationSec < 120, `duration ${body.meeting.durationSec}`);
  console.log(`meeting ${meetingId}: "${body.meeting.title}", ${body.meeting.durationSec}s, ${body.segments.length} lines, ${body.meeting.actionItems.length} action items`);

  // Tuck the bot away.
  await buddy.click("button[aria-label='Hide']");
  await until("hidden", async () => (await probe()).phase === "idle");
  assert.equal((await probe()).buddyShowing, false);
  // The hidden page can't start anything.
  await buddy.evaluate(() => window.babDesktop.act("take"));
  await sleep(500);
  assert.equal((await probe()).phase, "idle", "a hidden bubble's 'take' is ignored");

  // ---- end that call; a new call → Take notes → "Stop and delete" removes everything
  fs.writeFileSync(callFile, "");
  await until("call ended", async () => (await probe()).calls.length === 0, 10_000);
  fs.writeFileSync(callFile, "meet");
  await step("asking again", () => asking(buddy));
  assert.equal(await buddy.isVisible("text=Don't ask in Google Meet"), true);
  await buddy.click("button:has-text('Take notes')");
  s = await until("second listening", async () => ((await probe()).phase === "listening" ? probe() : null), 20_000);
  const doomed = s.meetingId;
  const uploadedBefore = s.uploads.uploaded;
  await until("a chunk of this meeting uploaded", async () => (await probe()).uploads.uploaded > uploadedBefore, 30_000);
  const lines = await (await web.get(`/api/bots/${botId}/meetings/${doomed}`)).json();
  assert.ok(lines.segments.length >= 1, "it had heard something before the delete");
  await buddy.locator("span.font-mono").hover();
  await buddy.click("button[aria-label='Stop and delete everything']");
  await buddy.click("text=Delete it all?");
  await until("discarded", async () => (await probe()).phase === "idle", 15_000);
  assert.equal((await probe()).buddyShowing, false, "nothing more is shown");
  const gone = await web.get(`/api/bots/${botId}/meetings/${doomed}`);
  assert.equal(gone.status(), 404, "the discarded meeting is gone from the server");

  // ---- "Not now": the bot hides and nothing is recorded; it doesn't ask again during that call
  fs.writeFileSync(callFile, "");
  await until("meet call ended", async () => (await probe()).calls.length === 0, 10_000);
  fs.writeFileSync(callFile, "teams");
  await step("asking (teams)", () => asking(buddy));
  await buddy.click("button:has-text('Not now')");
  await until("dismissed", async () => (await probe()).phase === "idle", 5000);
  await sleep(4000);
  s = await probe();
  assert.equal(s.phase, "idle", "no second prompt during the same call");
  assert.equal(s.buddyShowing, false);

  // ---- a call that ends on its own stops the notes automatically
  fs.writeFileSync(callFile, "");
  await until("teams call ended", async () => (await probe()).calls.length === 0, 10_000);
  await sleep(1600); // past the short "Not now" cooldown used in this test
  fs.writeFileSync(callFile, "zoom");
  await step("asking (auto-stop)", () => asking(buddy));
  await buddy.click("button:has-text('Take notes')");
  s = await until("third listening", async () => ((await probe()).phase === "listening" ? probe() : null), 20_000);
  const third = s.meetingId;
  await until("a chunk uploaded (3)", async () => (await probe()).stats.chunks >= 1, 20_000);
  fs.writeFileSync(callFile, ""); // the call ends: Zoom lets go of the mic
  await step("auto-stop", () => until("auto-stopped", async () => (await probe()).stats.stops.includes("call_ended"), 20_000));
  await step("done (3)", () => buddy.waitForSelector("text=Your notes are ready!", { timeout: 60_000 }));
  const third3 = await (await web.get(`/api/bots/${botId}/meetings/${third}`)).json();
  assert.equal(third3.meeting.status, "ready");

  // The token never reached a web page or the log.
  const all = logs.join("");
  const token = JSON.parse(deviceJson).token.data;
  assert.ok(!all.includes(token), "the token isn't in the log");
  assert.ok(!(await buddy.evaluate((t) => document.documentElement.outerHTML.includes(t), token)));
  await app.close();
  app = null;
  shared = { web, botId, userData, callFile };
});

test("when the computer won't share the call's audio, it keeps going on the mic and says so", { timeout: 180_000 }, async (t) => {
  if (!shared) return t.skip("needs the first test's paired app");
  const { web, botId, userData, callFile } = shared;
  fs.writeFileSync(callFile, "");
  // No --use-fake-ui-for-media-stream here: with it, Chromium approves screen capture by
  // itself (with a fake source that has audio) and the app's own handlers never run.
  app = await electron.launch({
    executablePath: ELECTRON,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", APP_DIR],
    env: {
      ...process.env,
      BAB_USER_DATA: userData,
      BAB_SERVER: SERVER,
      BAB_TEST: "1",
      BAB_ALLOW_PLAINTEXT_TOKEN: "1",
      BAB_FAKE_MEETING_FILE: callFile,
      BAB_DETECT_INTERVAL_MS: "700",
      BAB_DETECT_SUSTAIN_MS: "1000",
      BAB_CALL_END_GRACE_MS: "3000",
      BAB_PRIVATE_SPEECH: "off",
      // BAB_E2E_REAL_LOOPBACK=1: try this machine's real system-audio loopback instead.
      BAB_TEST_DENY_SYSTEM_AUDIO: process.env.BAB_E2E_REAL_LOOPBACK === "1" ? "0" : "1",
    },
  });
  const probe = () => app.evaluate(() => globalThis.__babTest?.state() ?? null);
  // Still paired after a restart (no pairing window this time).
  await until("session", async () => (await probe())?.account === "ready", 20_000);
  assert.equal((await probe()).botId, botId);
  assert.equal(app.windows().length, 0, "no pairing window when already paired");

  fs.writeFileSync(callFile, "zoom");
  const buddy = await waitForWindow(app, (u) => u.includes("/desktop/buddy"));
  await until("asking", async () => (await probe()).phase === "asking" && (await probe()).buddyShowing, 20_000);
  await buddy.click("button:has-text('Take notes')");
  const s = await until("listening", async () => ((await probe()).phase === "listening" ? probe() : null), 20_000);
  console.log(`system audio with the app's own handlers: ${s.system}`);
  if (process.env.BAB_E2E_REAL_LOOPBACK === "1" && s.system === "ok") return; // this machine can share system audio
  assert.ok(["unavailable", "denied"].includes(s.system), `system audio: ${s.system}`);
  assert.equal(s.tray, "Taking notes (your mic only)");
  await buddy.waitForSelector("text=I can only hear your mic here", { timeout: 5000 });
  await snap(buddy, "7-mic-only-notice");
  await until("mic chunks", async () => (await probe()).uploads.uploaded >= 1, 30_000);
  const meetingId = s.meetingId;
  await buddy.locator("span.font-mono").hover();
  await buddy.click("button[aria-label='Stop and write notes']");
  await buddy.waitForSelector("text=Your notes are ready!", { timeout: 60_000 });
  const body = await (await web.get(`/api/bots/${botId}/meetings/${meetingId}`)).json();
  assert.equal(body.meeting.status, "ready");
  assert.ok(body.segments.length >= 1 && body.segments.every((x) => x.track === "mic"), "only your side was recorded");
  await web.dispose();
});

let shared = null;

async function waitForWindow(electronApp, match, timeoutMs = 20_000) {
  const t0 = Date.now();
  for (;;) {
    for (const w of electronApp.windows()) if (match(w.url())) return w;
    if (Date.now() - t0 > timeoutMs) throw new Error("window not found");
    await Promise.race([electronApp.waitForEvent("window", { timeout: 1000 }).catch(() => null), sleep(250)]);
  }
}

async function snap(page, name, opts = {}) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, omitBackground: opts.transparent !== false });
  shots.push({ name, file, transparent: opts.transparent !== false });
}

/** The buddy shots over a fake call, side by side, so they're easy to look at. */
async function contactSheet() {
  const buddyShots = shots.filter((s) => s.transparent);
  const tiles = buddyShots
    .map((s) => {
      const b64 = fs.readFileSync(s.file).toString("base64");
      return `<figure><div class="desk"><div class="tile a"></div><div class="tile b"></div><img src="data:image/png;base64,${b64}"></div><figcaption>${s.name}</figcaption></figure>`;
    })
    .join("");
  const html = `<html><head><style>
    body{margin:0;padding:16px;background:#111;font:13px system-ui;color:#ddd;display:flex;flex-wrap:wrap;gap:16px}
    figure{margin:0}.desk{position:relative;width:760px;height:360px;background:linear-gradient(135deg,#1f2a44,#3b1f3f);overflow:hidden;border-radius:8px}
    .tile{position:absolute;border-radius:10px}.a{left:20px;top:20px;width:350px;height:150px;background:#2d4a7a}.b{left:390px;top:20px;width:350px;height:150px;background:#6a2b4a}
    img{position:absolute;left:50%;bottom:0;transform:translateX(-50%)}figcaption{padding:4px 2px}</style></head><body>${tiles}</body></html>`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.setContent(html);
  await page.screenshot({ path: path.join(SHOTS, "sheet.png"), fullPage: true });
  await browser.close();
}
