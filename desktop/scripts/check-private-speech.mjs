/**
 * Private speech on this computer, for real: gets NVIDIA's runtime and Parakeet from where the app
 * gets them (checked against the same pinned hashes), runs the engine the way the app does, and
 * makes sure a recording of someone talking comes back as the right words. CI runs it on Windows
 * and macOS with speech the system's own voice says.
 *
 *   node scripts/check-private-speech.mjs <folder> <recording.wav> "<words it must hear, comma-separated>"
 *
 * The folder is reused: what's already downloaded and checked isn't downloaded again.
 */
import fs from "node:fs";
import { LocalSpeech } from "../src/main/voice/local-speech.mjs";

const [dir, wavPath, expected = ""] = process.argv.slice(2);
if (!dir || !wavPath) {
  console.error('usage: node scripts/check-private-speech.mjs <folder> <recording.wav> "<words, comma-separated>"');
  process.exit(2);
}

const t = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;
const started = Date.now();
const local = new LocalSpeech({ dir, log: (m) => console.log(`  ${m}`) });
console.log(`${process.platform}-${process.arch}: Private speech ${local.supported() ? "runs here" : "doesn't run here"} (${local.state})`);
if (!local.supported()) process.exit(1);

let lastPct = -10;
local.on("change", (s) => {
  if (s.state !== "downloading" || !s.total) return console.log(`[${t()}] ${s.state}${s.error ? `: ${s.error}` : ""}`);
  const pct = Math.floor((s.received / s.total) * 100);
  if (pct >= lastPct + 10) {
    lastPct = pct;
    console.log(`[${t()}] downloading ${pct}% (${Math.round(s.received / 1e6)} of ${Math.round(s.total / 1e6)} MB)`);
  }
});

let failed = false;
/** @type {LocalSpeech | null} */
let next = null;
try {
  await local.install();
  console.log(`[${t()}] installed: ${local.isInstalled()}`);

  const wav = new Uint8Array(fs.readFileSync(wavPath));
  const seconds = (wav.byteLength - 44) / 32000;
  const words = expected
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  // The first one starts the engine (the model loads); the second finds it running.
  for (const run of ["first (starts it)", "second (running)"]) {
    const t0 = Date.now();
    const text = await local.transcribe(wav, { durationMs: seconds * 1000, startWaitMs: 120_000 });
    console.log(`[${t()}] ${run}: ${Date.now() - t0} ms for ${seconds.toFixed(1)} s of audio → ${JSON.stringify(text)}`);
    const flat = text.toLowerCase().replace(/[^\p{L}\p{N}$:\s]/gu, " ");
    const missing = words.filter((w) => !flat.includes(w));
    if (missing.length) {
      console.error(`  missing: ${missing.join(", ")}`);
      failed = true;
    }
  }
  console.log(`[${t()}] engine device: ${local.device} ("auto" is the GPU where this build has one)`);

  // The app was force-quit and left its engine running: the next start stops it (on Windows it
  // checks the process with tasklist, on macOS with ps).
  const orphan = local.child?.pid;
  local.child = null;
  next = new LocalSpeech({ dir, log: (m) => console.log(`  ${m}`) });
  const again = await next.transcribe(wav, { durationMs: seconds * 1000, startWaitMs: 120_000 });
  let alive = true;
  for (let i = 0; i < 50 && alive; i++) {
    try {
      process.kill(/** @type {number} */ (orphan), 0);
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      alive = false;
    }
  }
  console.log(`[${t()}] after a force-quit: the old engine (${orphan}) ${alive ? "is STILL RUNNING" : "was stopped"}; the new one heard ${JSON.stringify(again)}`);
  if (alive) failed = true;

  // Removing it from settings: the engine stops and its folder is deleted (Windows keeps files open
  // while a program uses them).
  await next.remove();
  const gone = !fs.existsSync(dir);
  console.log(`[${t()}] removed: ${next.state}, folder ${gone ? "deleted" : "STILL THERE"}`);
  if (!gone || next.state !== "absent") failed = true;
} catch (err) {
  console.error(`[${t()}] FAILED: ${/** @type {any} */ (err)?.code ?? ""} ${/** @type {any} */ (err)?.message ?? err}`);
  failed = true;
  await local.stop().catch(() => {});
  await next?.stop().catch(() => {});
}
process.exit(failed ? 1 : 0);
