/**
 * Meeting notes heard on this computer by NVIDIA Parakeet, end to end, with NVIDIA's real runtime
 * and model and real speech, against a Build-a-bot dev server (BAB_E2E_SERVER, default
 * http://localhost:3000; start it with DEMO_SPEECH=0 to hear it as build-a-bot.site does, with no
 * speech-to-text of its own), under Xvfb:
 *
 *   BAB_E2E_SPEECH_FILES=<folder> BAB_E2E_MEETING_WAV=<wav> \
 *     xvfb-run -a node --test --test-timeout=900000 e2e/meeting-parakeet.e2e.mjs
 *
 * BAB_E2E_SPEECH_FILES holds NVIDIA's files as they're published, as for e2e/local-speech.e2e.mjs.
 * BAB_E2E_MEETING_WAV is someone talking for about half a minute; BAB_E2E_MEETING_EXPECT lists
 * words to look for in what was heard ("|"-separated; each has to be there).
 *
 * Pairing with a bot whose meeting notes are on gets Parakeet right away. Then a fake Zoom call:
 * the bot asks, Take notes, the WAV plays into Chromium's fake microphone, each piece of the call is
 * turned into 16 kHz WAV and heard on this computer, and only the lines go to the server, which
 * shows them as the live transcript and writes the notes when it's stopped.
 *
 * Then the same call with Parakeet's download held back until it's over: the bot listens and says
 * why there are no captions, the pieces wait on disk (nothing is sent), the server doesn't write
 * notes from part of the meeting, and once Parakeet is here every piece is heard and the notes come.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, request } from "playwright";

const APP_DIR = fileURLToPath(new URL("../", import.meta.url));
const SERVER = process.env.BAB_E2E_SERVER ?? "http://localhost:3000";
const SHOTS = process.env.BAB_E2E_SHOTS ?? path.join(os.tmpdir(), "bab-desktop-e2e");
const ELECTRON = path.join(APP_DIR, "node_modules", "electron", "dist", "electron");
const FILES = process.env.BAB_E2E_SPEECH_FILES;
const MEETING = process.env.BAB_E2E_MEETING_WAV;
const EXPECT = (process.env.BAB_E2E_MEETING_EXPECT ?? "about 200 people|team meeting|Nemotron demo").split("|").map((w) => new RegExp(w, "i"));
const RUNTIME = "nemo-speech-0.2.0-linux-x86_64-cpu.tar.gz";
const MODEL = "parakeet-tdt-0.6b-v3.q8_0.gguf";
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

/** The WAV with a second of quiet before (the owner clicks, then talks) and a long quiet after. Returns its length in seconds. */
function micFile(src, dest, beforeSec = 1, afterSec = 30) {
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
  return beforeSec + data.length / frame / fmt.rate;
}

/**
 * NVIDIA's files, served from here (the app still checks them against the hashes it pins).
 * `hold(name)` can return a promise a file's download waits on (Parakeet "still downloading").
 * @param {string} dir
 * @param {{ hold?: (name: string) => Promise<void> | null }} [o]
 */
async function serveFiles(dir, o = {}) {
  const srv = http.createServer(async (req, res) => {
    const name = path.basename(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
    const file = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      res.writeHead(404);
      return res.end();
    }
    const wait = o.hold?.(name);
    if (wait) await wait;
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
    const start = m ? Number(m[1]) : 0;
    res.writeHead(m ? 206 : 200, { "content-length": st.size - start, "accept-ranges": "bytes", ...(m ? { "content-range": `bytes ${start}-${st.size - 1}/${st.size}` } : {}) });
    fs.createReadStream(file, { start }).pipe(res);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", () => r(undefined)));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}`;
  return {
    base,
    close() {
      srv.closeAllConnections();
      srv.close();
    },
  };
}

async function waitForWindow(electronApp, match, timeoutMs = 20_000) {
  const t0 = Date.now();
  for (;;) {
    for (const w of electronApp.windows()) if (match(w.url())) return w;
    if (Date.now() - t0 > timeoutMs) throw new Error("window not found");
    await Promise.race([electronApp.waitForEvent("window", { timeout: 1000 }).catch(() => null), sleep(250)]);
  }
}

/** What each test started, closed and deleted afterwards (each app folder holds its own copy of the model, 0.7 GB). */
const cleanup = { apps: [], servers: [], dirs: [] };
after(async () => {
  for (const a of cleanup.apps) await a.close().catch(() => {});
  for (const f of cleanup.servers) f.close();
  for (const d of cleanup.dirs) fs.rmSync(d, { recursive: true, force: true });
});

const ready = () => process.platform === "linux" && process.env.DISPLAY && FILES && MEETING;
const SKIP = "meeting e2e with Parakeet: needs Linux with an X display (xvfb-run), BAB_E2E_SPEECH_FILES and BAB_E2E_MEETING_WAV; skipped";

/** A demo owner with a bot whose meeting notes are on, and a pairing code for the app. */
async function ownerWithBot(name) {
  const web = await request.newContext({ baseURL: SERVER, extraHTTPHeaders: { origin: SERVER } });
  const created = await web.post("/api/bots", {
    data: {
      avatar: "otto",
      color: "grape",
      name,
      jobs: ["meetings"],
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
  const on = await web.post(`/api/bots/${botId}/connections`, { data: { connectorId: "meetings" } });
  assert.ok(on.ok(), `meeting notes on: ${on.status()} ${await on.text()}`);
  const { code } = await (await web.post("/api/bridge/pairing-code")).json();
  return { web, botId, code };
}

/**
 * The app, with a fake Zoom call that starts when `call.txt` says "zoom", and someone talking into
 * the fake microphone (the WAV, played once). NVIDIA's files come from `files`.
 */
async function launch(files) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bab-meeting-e2e-"));
  cleanup.dirs.push(userData);
  const mic = path.join(userData, "mic.wav");
  const talkSec = micFile(MEETING, mic);
  const callFile = path.join(userData, "call.txt");
  fs.writeFileSync(callFile, "");
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${mic}%noloop`, APP_DIR],
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
      // The call's own audio isn't what's tested here (Xvfb has none): the microphone is.
      BAB_SYSTEM_AUDIO: "off",
      BAB_SPEECH_RUNTIME_URL: `${files.base}/${RUNTIME}`,
      BAB_SPEECH_ITN_URL: `${files.base}/itn_configs.tar.bz2`,
      BAB_SPEECH_MODEL_URL: `${files.base}/${MODEL}`,
    },
  });
  cleanup.apps.push(app);
  const logs = [];
  app.process().stdout?.on("data", (d) => logs.push(String(d)));
  app.process().stderr?.on("data", (d) => logs.push(String(d)));
  const probe = () => app.evaluate(() => globalThis.__babTest?.state() ?? null);
  const step = async (name, fn) => {
    try {
      return await fn();
    } catch (err) {
      console.log(`--- app log (last 80 lines) at "${name}" ---\n${logs.join("").split("\n").slice(-80).join("\n")}`);
      throw err;
    }
  };
  return { app, probe, step, talkSec, callFile };
}

/** Type the code into the pairing window. */
async function pair(app, code) {
  const pairWin = await app.firstWindow();
  await pairWin.waitForSelector("#signed-out:not([hidden])");
  await pairWin.fill("#code", code);
  await pairWin.click("#pair-button");
  await pairWin.waitForSelector("#paired:not([hidden])", { timeout: 20_000 });
  return pairWin;
}

/** A Zoom call starts; the bot asks; Take notes. Returns the bot's window and the meeting's id. */
async function takeNotes({ app, probe, step, callFile }) {
  fs.writeFileSync(callFile, "zoom");
  const buddy = await step("buddy", () => waitForWindow(app, (u) => u.includes("/desktop/buddy")));
  await step("asking", () => until("asking", async () => (await probe())?.phase === "asking" && (await probe())?.buddyShowing, 20_000));
  await buddy.click("button:has-text('Take notes')");
  const s = await step("listening", () => until("listening", async () => ((await probe())?.phase === "listening" ? probe() : null), 20_000));
  return { buddy, meetingId: s.meetingId };
}

async function stop(buddy) {
  await buddy.locator("span.font-mono").hover();
  await buddy.click("button[aria-label='Stop and write notes']");
}

/** The server has what Parakeet heard (and nothing made up), and the notes. */
async function checkMeeting(web, botId, meetingId) {
  const body = await (await web.get(`/api/bots/${botId}/meetings/${meetingId}`)).json();
  assert.equal(body.meeting.status, "ready");
  assert.equal(body.meeting.source, "desktop");
  assert.ok(body.meeting.notes && body.meeting.notes.length > 20, "notes were written");
  const said = body.segments.map((x) => x.text).join(" ");
  console.log(`transcript (${body.segments.length} lines): ${said}`);
  for (const re of EXPECT) assert.match(said, re);
  assert.ok(body.segments.every((x) => x.track === "mic" && x.speaker === "You"));
  assert.doesNotMatch(said, /Okay, thanks everyone for joining/, "not the scripted demo meeting");
}

test("a meeting heard by NVIDIA Parakeet on this computer: only the lines go to the server, and the notes get written", { timeout: 900_000 }, async () => {
  if (!ready()) return console.log(SKIP);
  const files = await serveFiles(FILES);
  cleanup.servers.push(files);
  const { web, botId, code } = await ownerWithBot("Inky");
  // The website can't take notes itself.
  const fromWeb = await web.post(`/api/bots/${botId}/meetings`, { data: { app: "zoom" } });
  assert.equal(fromWeb.status(), 403);

  const run = await launch(files);
  const { probe, step } = run;

  // ---- pair: a bot takes notes here, so NVIDIA Parakeet downloads right away
  const pairWin = await pair(run.app, code);
  const t0 = Date.now();
  // The pairing window says where the 0.7 GB is going, and when it's here.
  await step("pairing window: getting Parakeet", () => pairWin.waitForSelector("#hearing:not([hidden])", { timeout: 20_000 }));
  console.log(`pairing window: "${await pairWin.textContent("#hearing")}"`);
  await step("Parakeet downloaded", () => until("NVIDIA Parakeet downloaded and checked", async () => ["installed", "starting", "ready"].includes((await probe())?.voice?.local?.state), 300_000));
  console.log(`Parakeet downloaded and checked in ${((Date.now() - t0) / 1000).toFixed(1)} s, without voice typing on`);
  await step("pairing window: Parakeet is here", () =>
    until("the pairing window saying Parakeet is here", async () => /NVIDIA Parakeet turns calls into text on this computer/.test((await pairWin.textContent("#hearing")) ?? ""), 20_000),
  );

  // ---- a Zoom call: the bot asks; Take notes
  const { buddy, meetingId } = await takeNotes(run);
  const startedAt = Date.now();

  // ---- what was said shows up as a live caption, heard on this computer
  await step("caption", () => until("a line Parakeet heard", async () => ((await probe())?.caption?.text ? (await probe()).caption : null), 120_000));
  console.log(`first caption ${((Date.now() - startedAt) / 1000).toFixed(1)} s after Take notes: "${(await probe()).caption.text}"`);
  await buddy.screenshot({ path: path.join(SHOTS, "meeting-parakeet-1-caption.png"), omitBackground: true });

  // ---- let them finish talking, then Stop: the last piece is heard, then the notes are written
  const left = run.talkSec * 1000 + 2000 - (Date.now() - startedAt);
  if (left > 0) await sleep(left);
  await stop(buddy);
  const stoppedAt = Date.now();
  await step("notes", () => buddy.waitForSelector("text=Your notes are ready!", { timeout: 180_000 }));
  console.log(`notes ready ${((Date.now() - stoppedAt) / 1000).toFixed(1)} s after Stop`);
  await buddy.screenshot({ path: path.join(SHOTS, "meeting-parakeet-2-done.png"), omitBackground: true });

  // ---- only lines went to the server: no audio, nothing waiting on disk
  const done = await probe();
  console.log(`pieces: ${JSON.stringify(done.pieces)}; chunks: ${done.stats.chunkLog.map((c) => `${c.track}#${c.chunk}+${c.durationMs}${c.silent ? "(silent)" : ""}[${c.cut}]`).join(" ")}`);
  assert.equal(done.pieces.audio, 0, "no audio was sent");
  assert.ok(done.pieces.lines >= 1, "pieces were heard on this computer");
  assert.equal(done.spoolFiles, 0, "nothing left on disk");

  await checkMeeting(web, botId, meetingId);
  await web.dispose();
});

test("a call before NVIDIA Parakeet is here: it listens and says so, the pieces wait on the computer, and the notes come once it's here", { timeout: 900_000 }, async () => {
  if (!ready()) return console.log(SKIP);
  // The model's download doesn't start until the call is over.
  let release = () => {};
  const held = new Promise((r) => (release = () => r(undefined)));
  const files = await serveFiles(FILES, { hold: (name) => (name === MODEL ? held : null) });
  cleanup.servers.push(files);
  const { web, botId, code } = await ownerWithBot("Pip");
  const run = await launch(files);
  const { probe, step } = run;

  const pairWin = await pair(run.app, code);
  await step("pairing window: getting Parakeet", () =>
    until("the pairing window saying Parakeet is on its way", async () => /Getting NVIDIA Parakeet/.test((await pairWin.textContent("#hearing").catch(() => "")) ?? ""), 20_000),
  );
  assert.equal((await probe()).voice.local.state, "downloading");

  // ---- the call starts anyway: the bot listens, and says why there are no captions yet
  const { buddy, meetingId } = await takeNotes(run);
  const startedAt = Date.now();
  await step("wait note", () => until("the bot saying Parakeet is on its way", async () => (await probe())?.stats?.notices?.some((n) => /Getting NVIDIA Parakeet/.test(n)), 10_000));
  await buddy.screenshot({ path: path.join(SHOTS, "meeting-parakeet-3-waiting.png"), omitBackground: true });

  // ---- the pieces wait on this computer: nothing is sent, not even as audio
  await step("a piece waits on disk", () => until("a piece waiting in the spool", async () => (await probe())?.spoolFiles >= 1, 60_000));
  const left = run.talkSec * 1000 + 2000 - (Date.now() - startedAt);
  if (left > 0) await sleep(left);
  await stop(buddy);
  await sleep(4000);
  const waiting = await probe();
  assert.ok(waiting.spoolFiles >= 2, `every piece waits (${waiting.spoolFiles} on disk)`);
  assert.equal(waiting.pieces.audio + waiting.pieces.lines, 0, "nothing sent yet");
  const early = await (await web.get(`/api/bots/${botId}/meetings/${meetingId}`)).json();
  assert.equal(early.meeting.status, "recording", "no notes from part of the meeting");
  assert.equal(early.segments.filter((x) => x.text).length, 0);

  // ---- Parakeet arrives: the pieces are heard in order, then the notes are written
  const releasedAt = Date.now();
  release();
  await step("notes after Parakeet arrived", () =>
    until("the notes", async () => (await (await web.get(`/api/bots/${botId}/meetings/${meetingId}`)).json()).meeting?.status === "ready", 300_000, 1000),
  );
  console.log(`notes ready ${((Date.now() - releasedAt) / 1000).toFixed(1)} s after Parakeet's download was let through (download, load, hear every piece, write)`);
  const done = await probe();
  console.log(`pieces: ${JSON.stringify(done.pieces)}; spool: ${done.spoolFiles}`);
  assert.equal(done.pieces.audio, 0, "no audio was sent");
  assert.ok(done.pieces.lines >= 2, "every piece was heard on this computer");
  assert.equal(done.spoolFiles, 0, "nothing left on disk");
  await step("notified", () => until("the notes-ready notification", async () => (await probe())?.stats?.notifications?.some((n) => /^Notes from “.+” are ready$/.test(n)), 30_000));
  await checkMeeting(web, botId, meetingId);
  await web.dispose();
});
