/**
 * Learning from a fix, end to end, on a real Windows computer (CI's windows-latest), in the app
 * as installed by its installer (BAB_E2E_APP; or from source without it):
 *
 *  - the real shortcut, Ctrl + Windows, held with SendInput (e2e/fixtures/winkey.py) while a
 *    sentence plays into Chromium's fake microphone (BAB_E2E_SPEECH_WAV), another app in front;
 *  - the server "mishears" a name ("Meet pro zee at the lab."), and the app types that;
 *  - the owner fixes it right there, with real key presses: selects "pro zee", types "Prozzi";
 *  - the app sees the fix (UI Automation) and adds "Prozzi" to the owner's dictionary, as a
 *    correction, with "pro zee" as how it was heard; and says so;
 *  - a different name typed over one ("Mark" → "Sarah") isn't learned;
 *  - two dictations in a row get a space between them, and one typed right before a word gets a
 *    space after it (the app reads what's next to the cursor right before typing);
 *  - nothing it read is in the app's log.
 *
 * Against a stand-in for Build-a-bot's server (only what voice typing calls, below). Private
 * speech is off here (BAB_PRIVATE_SPEECH=off), so the stand-in server is what hears.
 *
 *   BAB_E2E_SPEECH_WAV=said.wav [BAB_E2E_APP=…\Build-a-bot.exe] node --test --test-timeout=600000 e2e/windows-learn.e2e.mjs
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

const APP_DIR = fileURLToPath(new URL("../", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const electronBin = () => createRequire(path.join(APP_DIR, "package.json"))("electron");
const APP = process.env.BAB_E2E_APP || null;
const WAV = process.env.BAB_E2E_SPEECH_WAV;

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

function winkey(...args) {
  return new Promise((resolve, reject) =>
    execFile("python", [path.join(FIXTURES, "winkey.py"), ...args.map(String)], (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout.trim()))),
  );
}

/**
 * A stand-in for Build-a-bot's server that hears recordings: each dictation is "heard" as the
 * next line in `said`. The dictionary starts empty and keeps what's added.
 */
async function fakeServer(said) {
  const calls = [];
  const dictionary = [];
  const TOKEN = "bab_dev_e2e_learn";
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
      if (req.method === "POST" && url.pathname === "/api/bridge/pair") return send(200, { deviceId: "dev_learn", token: TOKEN });
      if (!call.authed) return send(401, { error: "Not paired" });
      if (req.method === "GET" && url.pathname === "/api/desktop/session") {
        return send(200, {
          device: { id: "dev_learn", name: "Windows" },
          owner: { name: "Dana", plan: "free" },
          bots: [{ id: "bot_1", name: "Otto", avatar: "otto", color: "mint", paused: false, meetingsOn: false }],
          meetings: { available: false, minutesLeft: 0, chunkMs: 60000 },
          voice: { available: true, polish: false, edit: false, simulated: false, local: false, usage: { words: 0, limit: 8000 } },
          appUrl: `http://127.0.0.1:${srv.address().port}`,
          demo: false,
        });
      }
      if (req.method === "POST" && url.pathname === "/api/voice/dictate") {
        const text = said.shift() ?? "";
        call.text = text;
        const words = text.split(/\s+/).filter(Boolean).length;
        return send(200, { kind: text ? "text" : "empty", text, heard: text, polished: false, words, usage: { words, limit: 8000 }, simulated: false, ms: { stt: 5, polish: 0 } });
      }
      if (req.method === "GET" && url.pathname === "/api/voice/dictionary") return send(200, { entries: dictionary, fromMemories: [], bots: [{ id: "bot_1", name: "Otto" }] });
      if (req.method === "POST" && url.pathname === "/api/voice/dictionary") {
        const entry = JSON.parse(body.toString("utf8"));
        call.entry = entry;
        const saved = { id: `dict_${dictionary.length + 1}`, kind: entry.kind, text: entry.text, heard: entry.heard ?? [], source: entry.source ?? "manual", updatedAt: new Date().toISOString() };
        dictionary.unshift(saved);
        return send(201, { entry: saved, merged: false, count: dictionary.length });
      }
      send(404, { error: "not found" });
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", () => r(undefined)));
  return {
    origin: `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}`,
    calls,
    dictionary,
    close() {
      srv.closeAllConnections();
      srv.close();
    },
  };
}

let app = null;
let target = null;
let server = null;
after(async () => {
  target?.kill();
  if (app) await app.close().catch(() => {});
  server?.close();
});

test("Windows: a name fixed right where it was typed is learned, as the owner's own word", { timeout: 600_000 }, async () => {
  if (process.platform !== "win32" || !WAV) {
    console.log("windows learn e2e: needs Windows and BAB_E2E_SPEECH_WAV; skipped");
    return;
  }
  const { _electron: electron } = await import("playwright");
  server = await fakeServer(["Meet pro zee at the lab.", "Call Mark tomorrow about the lab.", "Meet at the lab.", "Bring the slides.", "great"]);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bab-learn-e2e-"));

  app = await electron.launch({
    executablePath: APP ?? electronBin(),
    args: [...(APP ? [] : [APP_DIR]), "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}`],
    env: { ...process.env, BAB_USER_DATA: userData, BAB_SERVER: server.origin, BAB_TEST: "1", BAB_VOICE_ENABLE: "1", BAB_LOG: "1", BAB_PRIVATE_SPEECH: "off" },
    timeout: 60_000,
  });
  const logs = [];
  app.process().stdout?.on("data", (d) => logs.push(String(d)));
  app.process().stderr?.on("data", (d) => logs.push(String(d)));
  const appLog = () => {
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
  const learnState = (await probe()).learn;
  assert.equal(learnState.supported, true, "Windows can read the box typed into");
  assert.equal(learnState.on, true, "learning from fixes is on by default");
  assert.equal((await probe()).spacing.on, true, "spacing is on by default");
  await pairWin.close();

  // ---- another app in front, with a text box
  const outFile = path.join(userData, "target.txt");
  const cmdFile = path.join(userData, "target-cmd.json");
  target = spawn(electronBin(), [path.join(FIXTURES, "target-app.cjs")], { env: { ...process.env, TARGET_OUT: outFile, TARGET_CMD: cmdFile }, stdio: ["ignore", "pipe", "pipe"] });
  let targetFailed = null;
  target.on("error", (err) => (targetFailed = err));
  await until("the target app", () => {
    if (targetFailed) throw targetFailed;
    return fs.existsSync(outFile);
  }, 60_000);
  const typed = () => fs.readFileSync(outFile, "utf8");
  let cmdN = 0;
  /** What a person does with the mouse: select words in the box. */
  const targetDo = async (c) => {
    const n = ++cmdN;
    fs.writeFileSync(cmdFile, JSON.stringify({ n, ...c }));
    const done = await until(`the other app to ${c.cmd}`, () => fs.existsSync(`${cmdFile}.done`) && fs.readFileSync(`${cmdFile}.done`, "utf8").split(" ")[0] === String(n) && fs.readFileSync(`${cmdFile}.done`, "utf8"), 10_000, 100);
    if (done.includes("failed")) throw new Error(done);
    await sleep(150);
  };
  await step("focus", () => winkey("focus", "Target app"));

  /** Hold Ctrl + Windows for a moment while the sentence plays, then let go. */
  const dictate = async (expect) => {
    await winkey("focus", "Target app");
    await winkey("down", "LControl", "down", "LWin", "sleep", "2.5", "up", "LWin", "up", "LControl");
    await step(`typed: ${expect}`, () => until("the words in the other app", () => typed().includes(expect), 60_000, 100));
    await step("found", () => until("its words found in the box", async () => (await probe())?.learn?.found, 10_000, 100));
  };

  // ---- the server mishears a name; the owner fixes it right there
  await dictate("Meet pro zee at the lab.");
  // Give the app a moment to find its words in the box, as a person reads what was typed.
  await sleep(1500);
  await targetDo({ cmd: "select", text: "pro zee" });
  await winkey("focus", "Target app", "type", "Prozzi");
  await step("fixed", () => until("the fix in the box", () => typed() === "Meet Prozzi at the lab.", 10_000, 100));
  const added = await step("learned", () => until("the word added to the dictionary", () => server.calls.find((c) => c.path === "/api/voice/dictionary" && c.method === "POST"), 20_000, 100));
  assert.deepEqual(added.entry, { kind: "word", text: "Prozzi", heard: ["pro zee"], source: "correction" });
  await step("learned count", () => until("the app to count it", async () => (await probe())?.learn?.learned === 1, 10_000));
  assert.equal(server.calls.filter((c) => c.path === "/api/voice/dictionary" && c.method === "POST").length, 1, "learned once");
  // The dictation went to the server as a recording (Private speech is off here), and nothing else did.
  const dictations = server.calls.filter((c) => c.path === "/api/voice/dictate");
  assert.equal(dictations.length, 1);

  // ---- a different name typed over one isn't a word it misheard (in a box emptied first, as sent)
  await targetDo({ cmd: "set", value: "" });
  await dictate("Call Mark tomorrow about the lab.");
  await sleep(1500);
  await targetDo({ cmd: "select", text: "Mark" });
  await winkey("focus", "Target app", "type", "Sarah");
  await step("edited", () => until("the edit in the box", () => typed() === "Call Sarah tomorrow about the lab.", 10_000, 100));
  await sleep(6000);
  assert.equal(server.calls.filter((c) => c.path === "/api/voice/dictionary" && c.method === "POST").length, 1, "nothing more learned");

  // ---- two dictations in a row: a space between them (what's before the cursor, read right before typing)
  await targetDo({ cmd: "set", value: "" });
  await dictate("Meet at the lab.");
  await dictate("Bring the slides.");
  await step("spaced", () => until("a space between the two", () => typed() === "Meet at the lab. Bring the slides.", 10_000, 100));
  // ---- typed right before a word: a space after it
  await targetDo({ cmd: "set", value: "Thanks for the notes." });
  await targetDo({ cmd: "caret", at: "Thanks for the ".length });
  await dictate("great");
  await step("spaced after", () => until("a space after the word", () => typed() === "Thanks for the great notes.", 10_000, 100));

  // ---- what it read and learned never reaches the log
  const log = appLog();
  assert.match(log, /learn: watching the box it typed into/);
  assert.match(log, /learn: learned 1 word/);
  assert.match(log, /notify: learned 1 word/);
  assert.match(log, /voice: spaced it \(before; from the box\)/);
  assert.match(log, /voice: spaced it \(after; from the box\)/);
  for (const secret of ["Prozzi", "pro zee", "Meet pro", "Call Mark", "Sarah", "Meet at", "Bring the slides", "great notes", "lab."]) assert.ok(!log.includes(secret), `the log mentions "${secret}"`);
  console.log(`windows learn e2e: learned ${JSON.stringify(added.entry)}; ${(await probe()).learn.stats.watched} dictations watched`);
});
