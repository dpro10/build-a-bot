// A real call on the live site, made the way a person makes one: a browser opens a new bot's page,
// presses Call, waits for the greeting, then asks a question out loud (scripts/live-call-question.wav,
// NVIDIA Magpie's Aria voice). On the voice server Parakeet hears it, Nemotron answers and Magpie
// speaks. It passes when the greeting, the question, a spoken answer and the call's record all come
// through, and reports how long the answer took. The bot is deleted afterwards.
//
//   node scripts/live-call.mjs [APP_URL] [OUT_DIR]      (https://build-a-bot.site, live-call/)
//
// Run by .github/workflows/live-call.yml after each voice deploy, and by hand from Actions. Needs
// Playwright's Chromium, and VOICE_SERVER_SECRET: calls need a signed-in account, and the check signs
// in as its own (POST /api/calls/check, signed like the voice server's requests). A site without
// calls set up (VOICE_SERVER_URL, VOICE_SERVER_SECRET) is reported and passes.
import { createHmac } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = (process.argv[2] || process.env.APP_URL || "https://build-a-bot.site").replace(/\/$/, "");
const out = process.argv[3] || "live-call";
const QUESTION = "Hi Otto. What can you help me with?";
mkdirSync(out, { recursive: true });

/** A 16-bit mono WAV's sample rate and samples. */
function readWav(path) {
  const buf = readFileSync(path);
  let rate = 0;
  for (let pos = 12; pos + 8 <= buf.length; ) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") {
      if (buf.readUInt16LE(pos + 10) !== 1 || buf.readUInt16LE(pos + 22) !== 16) throw new Error(`${path}: not 16-bit mono`);
      rate = buf.readUInt32LE(pos + 12);
    }
    if (id === "data") {
      const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset + pos + 8, buf.byteOffset + pos + 8 + size));
      return { rate, samples: Array.from(pcm) };
    }
    pos += 8 + size + (size & 1);
  }
  throw new Error(`${path}: no audio`);
}

const summary = (md) => process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
const s = (ms) => `${(ms / 1000).toFixed(2)} s`;
const cell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim() || "—";

const question = readWav(new URL("./live-call-question.wav", import.meta.url));
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 860 } });
const page = await context.newPage();

// The microphone: quiet until the test asks its question, then the recording, then quiet again.
await page.addInitScript(({ rate, samples }) => {
  let mic = null;
  const open = () => {
    if (!mic) {
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      const clip = ctx.createBuffer(1, samples.length, rate);
      const channel = clip.getChannelData(0);
      for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
      mic = { ctx, dest, clip };
    }
    return mic;
  };
  navigator.mediaDevices.getUserMedia = async () => {
    const { ctx, dest } = open();
    await ctx.resume();
    return dest.stream;
  };
  window.askQuestion = () =>
    new Promise((resolve) => {
      const { ctx, dest, clip } = open();
      const source = ctx.createBufferSource();
      source.buffer = clip;
      source.connect(dest);
      source.onended = () => resolve(null);
      source.start();
    });
}, question);

// Everything the voice server sends, with when it arrived (ms after pressing Call).
let t0 = Date.now();
const at = () => Date.now() - t0;
const events = [];
const audio = [];
let socketClosed = false;
page.on("websocket", (ws) => {
  ws.on("framereceived", (f) => {
    if (typeof f.payload !== "string") return void audio.push(at());
    try {
      events.push({ t: at(), ...JSON.parse(f.payload) });
    } catch {}
  });
  ws.on("close", () => (socketClosed = true));
});
let startError = null;
page.on("response", async (res) => {
  if (res.request().method() === "POST" && /\/api\/bots\/[^/]+\/calls$/.test(new URL(res.url()).pathname) && !res.ok()) {
    startError = `${res.status()} ${(await res.json().catch(() => ({}))).error ?? ""}`.trim();
  }
});
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

/** The first event that matches, waiting up to ms for it; a failed call stops the wait. */
async function until(what, match, ms) {
  for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
    const hit = events.find(match);
    if (hit) return hit;
    const failed = events.find((e) => e.type === "error");
    if (failed) throw new Error(`the call failed: ${failed.message}`);
    if (startError) throw new Error(`the call didn't start: ${startError}`);
    await page.waitForTimeout(100);
  }
  throw new Error(`no ${what} within ${ms / 1000} s`);
}

let botId = null;
let code = 0;
try {
  // Calls need a signed-in account: the check's own, signed in with the voice server's secret.
  const secret = process.env.VOICE_SERVER_SECRET;
  if (!secret) throw new Error("VOICE_SERVER_SECRET isn't set: the check signs in with it, since calls need a signed-in account");
  const body = JSON.stringify({ check: "live-call" });
  const t = Math.floor(Date.now() / 1000);
  const signature = `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
  const signedIn = await page.request.post("/api/calls/check", { data: body, headers: { "content-type": "application/json", "x-voice-signature": signature } });
  if (signedIn.status() === 404) {
    console.log(`::notice::${base} doesn't have calls set up yet (VOICE_SERVER_URL and VOICE_SERVER_SECRET in Vercel), so there's no call to make.`);
    summary(`### Live call on ${base}\n\nNot made: the site doesn't have calls set up yet (\`VOICE_SERVER_URL\` and \`VOICE_SERVER_SECRET\` in Vercel).`);
    await browser.close();
    process.exit(0);
  }
  if (!signedIn.ok()) throw new Error(`couldn't sign in for the check: ${signedIn.status()} ${await signedIn.text()}`);

  const made = await page.request.post("/api/bots", {
    data: { avatar: "nimbus", color: "sky", name: "Otto", jobs: ["inbox", "reminders"], brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" }, connectors: [], trust: "ask", channels: [], contact: {}, ageConfirmed: true, timezone: "America/Chicago" },
  });
  botId = (await made.json().catch(() => ({}))).id ?? null;
  if (!botId) throw new Error(`couldn't make a bot: ${made.status()} ${await made.text()}`);

  const listing = await page.request.get(`/api/bots/${botId}/calls`);
  if (!(await listing.json()).available) {
    console.log(`::notice::${base} doesn't have calls set up yet (VOICE_SERVER_URL and VOICE_SERVER_SECRET in Vercel), so there's no call to make.`);
    summary(`### Live call on ${base}\n\nNot made: the site doesn't have calls set up yet (\`VOICE_SERVER_URL\` and \`VOICE_SERVER_SECRET\` in Vercel).`);
  } else {
    await page.goto(`/app/bots/${botId}`);
    const call = page.getByRole("button", { name: "Call Otto" });
    await call.waitFor({ timeout: 30_000 });
    t0 = Date.now();
    await call.click();

    const ready = await until("answer from the voice server", (e) => e.type === "ready", 20_000);
    const greeting = await until("greeting", (e) => e.type === "transcript" && e.role === "bot", 20_000);
    const speaking = await until("greeting's audio", (e) => e.type === "state" && e.state === "speaking", 20_000);
    await until("end of the greeting", (e) => e.type === "state" && e.state === "listening" && e.t > speaking.t, 30_000);
    await page.screenshot({ path: `${out}/1-greeting.png` });

    const askedAt = at();
    await page.evaluate(() => window.askQuestion());
    const askedEnd = at();
    const heard = await until("question heard", (e) => e.type === "transcript" && e.role === "caller" && e.t > askedAt, 20_000);
    const latency = await until("spoken answer", (e) => e.type === "latency" && e.t > askedAt, 30_000);
    const done = await until("end of the answer", (e) => e.type === "state" && e.state === "listening" && e.t > latency.t, 60_000).catch(() => null);
    // The server's timing event goes out just before the audio it times, so look once the answer has played.
    const firstAudio = audio.find((t) => t > askedEnd) ?? null;
    await page.screenshot({ path: `${out}/2-answer.png` });
    const answer = events.filter((e) => e.type === "say" && e.t > heard.t).map((e) => e.text).join(" ");
    const tasks = events.filter((e) => e.type === "task" && e.state === "done" && e.t > heard.t);

    await page.getByRole("button", { name: "Hang up" }).click();
    for (let i = 0; i < 50 && !socketClosed; i++) await page.waitForTimeout(100);
    await page.screenshot({ path: `${out}/3-ended.png` });
    // The voice server reports the finished call to the app.
    let record = null;
    for (let i = 0; i < 30 && record?.status !== "ended"; i++) {
      await page.waitForTimeout(500);
      record = (await (await page.request.get(`/api/bots/${botId}/calls`)).json()).calls?.[0] ?? null;
    }

    const problems = [];
    if (!answer) problems.push("no answer was spoken");
    if (firstAudio === null) problems.push("no answer audio reached the browser");
    if (record?.status !== "ended") problems.push(`the call's record says ${record?.status ?? "nothing"}, not ended`);
    if (!/help/i.test(heard.text)) console.log(`::warning::Parakeet heard "${heard.text}" for "${QUESTION}".`);
    if (!done) console.log("::warning::The answer was still playing after a minute.");
    for (const e of pageErrors) console.log(`::warning::Page error during the call: ${e}`);

    const result = {
      site: base,
      engine: ready.engine,
      talker: ready.talker,
      greeting: greeting.text,
      asked: QUESTION,
      heard: heard.text,
      answer,
      tasks: tasks.map((e) => e.request),
      latencyMs: latency.ms,
      hearingMs: latency.asrMs === null ? null : Math.round(latency.asrMs),
      firstTokenMs: latency.llmMs === null ? null : Math.round(latency.llmMs),
      browserMs: firstAudio === null ? null : firstAudio - askedEnd,
      greetingAudioMs: audio[0] ?? null,
      record,
      problems,
    };
    writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    summary(
      [
        `### Live call on ${base}: ${problems.length ? "failed" : "passed"}`,
        problems.length ? `\n${problems.map((p) => `- ${p}`).join("\n")}\n` : "",
        "| | |",
        "|---|---|",
        `| Otto said | ${cell(greeting.text)} |`,
        `| The caller asked | ${cell(QUESTION)} |`,
        `| Parakeet heard | ${cell(heard.text)} |`,
        `| Otto answered | ${cell(answer)} |`,
        tasks.length ? `| Handed to the bot's agent | ${cell(tasks.map((e) => e.request).join("; "))} |` : "",
        `| Answer started | ${s(latency.ms)} after the caller stopped talking (${result.browserMs === null ? "no audio in the browser" : `${s(result.browserMs)} as the browser heard it`}) |`,
        `| Of which | hearing ${result.hearingMs === null ? "—" : s(result.hearingMs)}, Nemotron's first words ${result.firstTokenMs === null ? "—" : s(result.firstTokenMs)} |`,
        `| Greeting started | ${result.greetingAudioMs === null ? "—" : `${s(result.greetingAudioMs)} after pressing Call`} |`,
        `| Voice | ${cell(ready.engine)}; talker ${cell(ready.talker)} |`,
        `| Call record | ${cell(record ? `${record.status}, ${record.durationS ?? "?"} s` : "none")} |`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    if (problems.length) throw new Error(problems.join("; "));
  }
} catch (e) {
  code = 1;
  console.log(`::error::Live call on ${base}: ${e.message}`);
  summary(`### Live call on ${base}: failed\n\n${e.message}`);
  await page.screenshot({ path: `${out}/failed.png` }).catch(() => {});
} finally {
  writeFileSync(`${out}/events.json`, JSON.stringify({ events, audio, pageErrors }, null, 1));
  if (botId) await page.request.delete(`/api/bots/${botId}`).catch(() => {});
  await browser.close();
}
process.exit(code);
