/**
 * A real call with Juno on build-a-bot.site (NVIDIA Parakeet hears, Magpie speaks, Nemotron talks,
 * Juno's own agent looks things up in its files), recorded with both voices:
 *
 *   1. "Hey Juno, when's my bio midterm?"            (Juno reads the syllabus)
 *   2. "Perfect. Quick one: what's the first stable molecule in the Calvin cycle?"
 *      (said while Juno is still talking: a cut-in; Juno answers from the lecture slides)
 *   3. "Got it. Remind me to study tomorrow at 7 p.m."    (a real reminder)
 *   4. "Thanks, Juno. Bye!"
 *
 * The caller's lines are WAV files played into a scripted microphone at those moments
 * (video/out/demo/caller/*.wav, or CALLER_DIR=… for Diego's own recordings).
 * Juno from the builder, with the class files from the files scene.
 *   node video/demo/record/call.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CLIPS, OUT, SITE, Take, actor, callAudio, launch, loadSession, sleep } from "./recorder.mjs";

const DIR = process.env.CALLER_DIR ?? path.join(OUT, "caller");
const LINE = (n) => {
  const f = path.join(DIR, `${n}.wav`);
  if (!fs.existsSync(f)) throw new Error(`Missing ${f}`);
  return f;
};
const s = loadSession();

// Taller than 16:9, so the whole call panel fits with its work list; the edit shows the panel
// itself, so only the column around it is recorded (at 1.5×, with the blur off: Chromium keeps up
// with 60 frames a second, and the panel still has more pixels than the edit shows).
const SCALE = 1.5;
const REGION = { x: 300, y: 0, width: 680, height: 960 };
const { browser, page } = await launch({ mic: true, storageState: s.storage, view: { width: 1280, height: 960 }, scale: SCALE, light: true, region: REGION });
const a = actor(page, 41);
const log = () => page.evaluate(() => ({ events: window.__callLog.events.map((e) => ({ t: e.t, ...JSON.parse(e.data) })), audio: window.__callLog.audio.map((x) => ({ t: x.t, n: Math.floor((x.b64.length * 3) / 4 / 2) })) }));
const events = async () => (await log()).events;
const said = [];
const say = async (n) => {
  said.push(LINE(n));
  return page.evaluate((b) => window.__say(b), fs.readFileSync(LINE(n)).toString("base64"));
};

/** Juno answered: a reply of its own after event `from`, then listening for a while, with no work running. */
async function answered(from, max = 90000) {
  const start = Date.now();
  while (Date.now() - start < max) {
    const ev = (await events()).slice(from);
    if (ev.some((e) => e.type === "ended")) return true;
    const reply = ev.findLastIndex((e) => e.type === "transcript" && e.role === "bot");
    const last = ev.findLastIndex((e) => e.type === "state");
    const started = ev.filter((e) => e.type === "task" && e.state === "started").length;
    const ended = ev.filter((e) => e.type === "task" && e.state !== "started").length;
    if (reply >= 0 && last > reply && ev[last].state === "listening" && started === ended && (await playing()) <= 0) {
      await sleep(1200);
      const now = (await events()).slice(from);
      const stillLast = now.findLastIndex((e) => e.type === "state");
      if (stillLast === last || now[stillLast]?.state === "listening") return true;
    }
    await sleep(120);
  }
  console.log("a turn timed out");
  return false;
}

/**
 * The page's playback, worked out the way it plays: each piece at max(end of the last, arrival +
 * 60 ms), and a "clear" drops what's queued. The server sends each sentence's text ("say", all of a
 * reply's at once), then its audio, then a "mark"; so the audio between marks is one sentence, in
 * order. Returns how many seconds are still to play, and when each sentence starts playing.
 */
async function schedule() {
  const { events: ev, audio } = await log();
  const rate = ev.find((e) => e.type === "ready")?.outputRate ?? 22050;
  const items = [...audio.map((x) => ({ kind: "pcm", t: x.t, dur: x.n / rate })), ...ev.filter((e) => ["clear", "interrupted", "say", "mark"].includes(e.type)).map((e) => ({ kind: e.type, t: e.t, text: e.text }))].sort((x, y) => x.t - y.t);
  let next = 0;
  const says = [];
  let waiting = 0; // the first say whose audio hasn't started
  let open = false; // a sentence's audio is coming in
  for (const it of items) {
    const at = it.t / 1000;
    if (it.kind === "clear" || it.kind === "interrupted") {
      next = at;
      waiting = says.length;
      open = false;
    } else if (it.kind === "say") says.push({ text: it.text, t: at, plays: null });
    else if (it.kind === "mark") open = false;
    else {
      const start = Math.max(next, at + 0.06);
      if (!open) {
        open = true;
        // Audio with no text waiting for it (a "let me check" filler) belongs to no sentence.
        if (waiting < says.length && says[waiting].t <= at) says[waiting++].plays = start;
      }
      next = start + it.dur;
    }
  }
  return { left: next - Date.now() / 1000, says };
}
const playing = async () => (await schedule()).left;

/** The call panel's extent over the whole call (it grows as work rows appear): the edit crops to it. */
let box = null;
async function track() {
  const b = await page.locator("[role=dialog]").boundingBox().catch(() => null);
  if (!b) return;
  const r = { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height };
  box = box ? { x0: Math.min(box.x0, r.x0), y0: Math.min(box.y0, r.y0), x1: Math.max(box.x1, r.x1), y1: Math.max(box.y1, r.y1) } : r;
}

try {
  await page.goto(`${SITE}/app/bots/${s.botId}`, { waitUntil: "load" });
  await page.getByRole("button", { name: "Call Juno" }).waitFor({ timeout: 30000 });
  await sleep(1500);
  await a.place(900, 300);

  const take = await new Take(page, "call").start();
  await sleep(1200);
  await a.click(page.getByRole("button", { name: "Call Juno" }), { pause: 300 });
  take.mark("ringing");
  await answered(0, 40000);
  take.mark("greeted");
  await track();
  await sleep(600);

  // 1 → the syllabus; 2 cuts in a second into the sentence after the answer.
  let from = (await events()).length;
  await say("line1");
  take.mark("q1");
  let cutAt = null;
  for (const t0 = Date.now(); Date.now() - t0 < 90000; ) {
    const { says, left } = await schedule();
    const mine = says.filter((x) => x.t * 1000 > t0 - 1000);
    const answer = mine.findIndex((x) => /November|Nov\.? 12|Science Hall/i.test(x.text ?? ""));
    if (answer >= 0) {
      const after = mine.slice(answer + 1).find((x) => x.plays !== null);
      const more = mine.length > answer + 1;
      if (after) {
        cutAt = after.plays + 1.0;
        break;
      }
      // A one-sentence answer: let it play out, then speak.
      if (!more && mine[answer].plays !== null) {
        cutAt = Date.now() / 1000 + Math.max(0, left) + 0.3;
        break;
      }
    }
    await sleep(80);
  }
  take.mark("a1");
  if (cutAt) while (Date.now() / 1000 < cutAt) await sleep(30);
  from = (await events()).length;
  await say("line2c");
  take.mark("cut-in");
  await sleep(1200);
  await answered(from);
  take.mark("a2");
  await track();
  await sleep(500);

  from = (await events()).length;
  await say("line4c");
  take.mark("q4");
  await sleep(1200);
  await answered(from);
  take.mark("a4");
  await track();
  await sleep(500);

  from = (await events()).length;
  await say("line5");
  take.mark("bye");
  await sleep(1200);
  await answered(from, 20000);
  if (!(await page.getByText("Call ended").isVisible().catch(() => false))) {
    await sleep(600);
    await a.click(page.getByRole("button", { name: "Hang up" }), { pause: 250 }).catch(() => {});
  }
  take.mark("ended");
  await sleep(2500);

  await track();
  // In the recording's pixels, the panel's widest and tallest over the call.
  if (box) take.note({ panel: { x: Math.round((box.x0 - REGION.x) * SCALE), y: Math.round((box.y0 - REGION.y) * SCALE), width: Math.round((box.x1 - box.x0) * SCALE), height: Math.round((box.y1 - box.y0) * SCALE) } });
  const lines = await page.locator("[role=dialog] [aria-label=Transcript] li").allInnerTexts().catch(() => []);
  const ev = await events();
  const { says } = await schedule();
  const info = await take.stop();
  const wav = await callAudio(page, take, said);
  const mp4 = path.join(CLIPS, "call.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", mp4, "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", path.join(CLIPS, "call-av.mp4")]);
  const rel = (t) => Number((t / 1000 - take.t0).toFixed(3));
  const caller = await page.evaluate(() => window.__callLog.said);
  fs.writeFileSync(
    path.join(CLIPS, "call.transcript.json"),
    JSON.stringify(
      {
        lines,
        latency: ev.filter((e) => e.type === "latency").map((e) => e.ms),
        tasks: ev.filter((e) => e.type === "task"),
        says: says.map((x) => ({ text: x.text, plays: Number((x.plays - take.t0).toFixed(3)) })),
        caller: caller.map((c, i) => ({ file: path.basename(said[i] ?? ""), at: rel(c.t), dur: c.dur })),
        events: ev.map((e) => ({ t: rel(e.t), type: e.type, role: e.role, state: e.state, text: e.text, ms: e.ms })),
        marks: info.marks,
      },
      null,
      2,
    ),
  );
  console.log("TRANSCRIPT:\n" + lines.map((l) => "  " + l).join("\n"));
  console.log("latency (ms):", ev.filter((e) => e.type === "latency").map((e) => e.ms).join(", "));
} finally {
  await browser.close();
}
