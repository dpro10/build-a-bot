/**
 * Beats 1 and 7: a real call with Otto on build-a-bot.site (NVIDIA Parakeet hears, Magpie speaks,
 * Nemotron talks, Otto's own agent looks things up in its Library), recorded with both voices.
 *
 *   1. "Hey Otto, when's my bio midterm again?"        (Otto reads the syllabus)
 *   2. "Perfect. Quiz me on my Calvin cycle notes."    (said while Otto is still answering: a cut-in)
 *   3. "The stroma." or "Rubisco. It grabs carbon dioxide.", whichever Otto's question asks for
 *   4. "Remind me to study at seven tonight."          (a real reminder)
 *   5. "Thanks, Otto. Bye!"
 *
 * The caller's lines are WAV files played into a scripted microphone at those moments: by default
 * video/out/demo/caller/line1-5.wav (a stand-in voice); CALLER_DIR=… for Diego's own recordings.
 * Its own Otto in a fresh guest account (guests get 5 messages before signing in), with the class
 * files added on the Library page (that costs no messages). Deleted afterwards unless KEEP=1.
 *   node video/demo/record/call.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CLIPS, OUT, PROPS, SITE, Take, actor, callAudio, launch, sleep } from "./recorder.mjs";

const DIR = process.env.CALLER_DIR ?? path.join(OUT, "caller");
const LINES = { 1: "line1", 2: "line2", "3a": "line3a", "3b": "line3b", 4: "line4", 5: "line5" };
for (const k of Object.keys(LINES)) {
  LINES[k] = path.join(DIR, `${LINES[k]}.wav`);
  if (!fs.existsSync(LINES[k])) throw new Error(`Missing ${LINES[k]}`);
}

// Taller than 16:9, so the whole call panel fits with its work list; the edit shows the panel itself.
const { browser, context, page } = await launch({ mic: true, view: { width: 1280, height: 960 } });
const a = actor(page, 41);
const events = () => page.evaluate(() => window.__callLog.events.map((e) => ({ t: e.t, ...JSON.parse(e.data) })));
const said = [];
const say = async (n) => {
  said.push(LINES[n]);
  return page.evaluate((b) => window.__say(b), fs.readFileSync(LINES[n]).toString("base64"));
};

/** Otto answered: a reply of its own after event `from`, then listening for a while, with no work running. */
async function answered(from, max = 60000) {
  const start = Date.now();
  while (Date.now() - start < max) {
    const ev = (await events()).slice(from);
    if (ev.some((e) => e.type === "ended")) return true;
    const reply = ev.findLastIndex((e) => e.type === "transcript" && e.role === "bot");
    const last = ev.findLastIndex((e) => e.type === "state");
    const started = ev.filter((e) => e.type === "task" && e.state === "started").length;
    const ended = ev.filter((e) => e.type === "task" && e.state !== "started").length;
    if (reply >= 0 && last > reply && ev[last].state === "listening" && started === ended) {
      await sleep(1400);
      const now = (await events()).slice(from);
      const stillLast = now.findLastIndex((e) => e.type === "state");
      if (stillLast === last || now[stillLast]?.state === "listening") return true;
    }
    await sleep(120);
  }
  console.log("a turn timed out");
  return false;
}

/** Otto started saying its reply (after event `from`). */
async function replyStarted(from, max = 45000) {
  const start = Date.now();
  while (Date.now() - start < max) {
    const ev = (await events()).slice(from);
    const reply = ev.findIndex((e) => e.type === "transcript" && e.role === "bot");
    if (reply >= 0 && ev.slice(reply).some((e) => e.type === "state" && e.state === "speaking")) return ev[reply].text;
    await sleep(50);
  }
  return null;
}

/** The call panel's extent over the whole call (it grows as work rows appear): the edit crops to it. */
let box = null;
async function track() {
  const b = await page.locator("[role=dialog]").boundingBox().catch(() => null);
  if (!b) return;
  const r = { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height };
  box = box ? { x0: Math.min(box.x0, r.x0), y0: Math.min(box.y0, r.y0), x1: Math.max(box.x1, r.x1), y1: Math.max(box.y1, r.y1) } : r;
}

let botId = null;
try {
  const res = await context.request.post(`${SITE}/api/bots`, {
    headers: { origin: SITE },
    data: {
      avatar: "otto", color: "grape", name: "Otto", role: "tutor", jobs: ["school", "reminders"],
      brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: ["web_search", "wikipedia", "notes"], trust: "ask", channels: [], contact: {},
      ageConfirmed: true, timezone: "America/Chicago", ownerName: "Diego",
    },
  });
  if (!res.ok()) throw new Error(`create: ${res.status()} ${await res.text()}`);
  botId = (await res.json()).id;
  // The class files, on the Library page.
  await page.goto(`${SITE}/app/bots/${botId}/library`, { waitUntil: "networkidle" });
  await page.locator("input[type=file]").first().setInputFiles(fs.readdirSync(PROPS).map((f) => path.join(PROPS, f)));
  for (let i = 0; ; i++) {
    const files = (await (await context.request.get(`${SITE}/api/bots/${botId}/files`)).json()).files;
    if (files.length === 3 && files.every((f) => f.status === "ready")) break;
    if (i > 80) throw new Error(`files not read: ${JSON.stringify(files.map((f) => [f.name, f.status]))}`);
    await sleep(1500);
  }
  await page.goto(`${SITE}/app/bots/${botId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Make flashcards from my notes/ }).waitFor({ timeout: 60000 });
  await page.mouse.move(900, 300);

  const take = await new Take(page, "call").start();
  await sleep(1200);
  await a.click(page.getByRole("button", { name: "Call Otto" }), { pause: 300 });
  take.mark("ringing");
  await answered(0, 30000);
  take.mark("greeted");
  await track();
  await sleep(500);

  // 1 → the syllabus; 2 cuts in a few seconds into the answer.
  let from = (await events()).length;
  await say(1);
  take.mark("q1");
  const reply1 = await replyStarted(from);
  take.mark("a1");
  // Cut in once the date and room are out (the first sentence), about 2.4 words a second spoken,
  // numbers and times taking longer; a one-sentence answer is let finish.
  const sentences = (reply1 ?? "").split(/(?<=[.!?])\s+/);
  if (sentences.length > 1) await sleep(1200 + (sentences[0].split(/\s+/).length / 2.4) * 1000 + 1400);
  else await answered(from);
  from = (await events()).length;
  await say(2);
  take.mark("cut-in");
  await sleep(1200);
  await answered(from);
  take.mark("a2");
  await track();
  await sleep(500);

  // Answer what Otto actually asked.
  const question = [...(await events())].reverse().find((e) => e.type === "transcript" && e.role === "bot")?.text ?? "";
  const answer = /enzyme|rubisco|fix(es|ing)? carbon|grab/i.test(question) ? "3b" : "3a";
  console.log(`Otto asked: ${question}\n  → answering with line ${answer}`);
  from = (await events()).length;
  await say(answer);
  take.mark("q3");
  await sleep(1200);
  await answered(from);
  take.mark("a3");
  await track();
  await sleep(500);

  from = (await events()).length;
  await say(4);
  take.mark("q4");
  await sleep(1200);
  await answered(from);
  take.mark("a4");
  await track();
  await sleep(500);

  from = (await events()).length;
  await say(5);
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
  // In video pixels (2×), the panel's widest and tallest over the call.
  if (box) take.note({ panel: { x: Math.round(box.x0 * 2), y: Math.round(box.y0 * 2), width: Math.round((box.x1 - box.x0) * 2), height: Math.round((box.y1 - box.y0) * 2) } });
  const lines = await page.locator("[role=dialog] [aria-label=Transcript] li").allInnerTexts().catch(() => []);
  const ev = await events();
  const info = await take.stop();
  const wav = await callAudio(page, take, said);
  const mp4 = path.join(CLIPS, "call.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", mp4, "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", path.join(CLIPS, "call-av.mp4")]);
  fs.writeFileSync(path.join(CLIPS, "call.transcript.json"), JSON.stringify({ lines, tasks: ev.filter((e) => e.type === "task"), latency: ev.filter((e) => e.type === "latency").map((e) => e.ms), events: ev.map((e) => ({ t: e.t, type: e.type, role: e.role, state: e.state, text: e.text })), marks: info.marks }, null, 2));
  console.log("TRANSCRIPT:\n" + lines.map((l) => "  " + l).join("\n"));
  console.log("tasks:", ev.filter((e) => e.type === "task" && e.state !== "started").map((e) => `${e.request} → ${(e.result ?? "").slice(0, 90)}`).join("\n  "));
  console.log("latency (ms):", ev.filter((e) => e.type === "latency").map((e) => e.ms).join(", "));
} finally {
  if (botId && process.env.KEEP !== "1") await context.request.delete(`${SITE}/api/bots/${botId}`, { headers: { origin: SITE } }).catch(() => {});
  await browser.close();
}
