/**
 * Otto's narration for the demo video, in its own voice: NVIDIA Magpie TTS (voice Sofia, guidance on,
 * as on calls) through NeMo-Speech.cpp, on this computer. Several takes of each line; NVIDIA
 * Parakeet transcribes every take, and the pick is the one that matches the script word for word,
 * at a natural pace, heard with the most confidence. Then a light polish (EQ, de-essing, gentle
 * compression) so it sits well over music.
 *
 *   node video/demo/vo/make.mjs                 all lines, 5 takes each
 *   node video/demo/vo/make.mjs --takes 8 --only V05a,V11
 *
 * Needs NeMo-Speech.cpp (the desktop app's copy is used by default; NEMO_SPEECH_BIN to change it)
 * and Parakeet's GGUF (PARAKEET_GGUF). Magpie downloads itself the first time (about 650 MB).
 * Writes video/out/demo/vo/<id>.wav, <id>.json (word timings) and picks.json.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "..", "out", "demo", "vo");
const TAKES = path.join(OUT, "takes");
const APP = path.join(os.homedir(), "Library", "Application Support", "Build-a-bot", "speech");
const BIN = process.env.NEMO_SPEECH_BIN ?? path.join(APP, "runtime", "bin", "nemo-speech");
const PARAKEET = process.env.PARAKEET_GGUF ?? path.join(APP, "models", "parakeet-tdt-0.6b-v3.q8_0.gguf");
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const takes = Number(arg("takes", 5));
const only = arg("only", null)?.split(",");
const lines = JSON.parse(fs.readFileSync(path.join(HERE, "lines.json"), "utf8")).filter((l) => !only || only.includes(l.id));
fs.mkdirSync(TAKES, { recursive: true });

/** Words to compare: lowercase, digits and letters only ("Build-a-bot" and "Buildabot" both become "buildabot"). */
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/build[\s-]*a[\s-]*bot/g, "buildabot")
    .replace(/twenty[\s-]*four hundred|2,?400/g, "twentyfourhundred")
    .replace(/\bdot\b/g, " ")
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Word error rate by edit distance. */
function wer(ref, hyp) {
  const d = Array.from({ length: ref.length + 1 }, (_, i) => [i, ...Array(hyp.length).fill(0)]);
  for (let j = 1; j <= hyp.length; j++) d[0][j] = j;
  for (let i = 1; i <= ref.length; i++)
    for (let j = 1; j <= hyp.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  return d[ref.length][hyp.length] / Math.max(1, ref.length);
}

function transcribe(wav) {
  const json = wav.replace(/\.wav$/, ".asr.json");
  execFileSync(BIN, ["transcribe", wav, "--model", PARAKEET, "-f", "json", "--quiet", "--force", "-o", json], { stdio: "ignore" });
  return JSON.parse(fs.readFileSync(json, "utf8"));
}

const picks = fs.existsSync(path.join(OUT, "picks.json")) ? JSON.parse(fs.readFileSync(path.join(OUT, "picks.json"), "utf8")) : {};
for (const line of lines) {
  const scored = [];
  for (let seed = 1; seed <= takes; seed++) {
    // Keyed by the words too, so an edited line gets new takes.
    const key = crypto.createHash("sha1").update(line.text).digest("hex").slice(0, 8);
    const wav = path.join(TAKES, `${line.id}-${key}-s${seed}.wav`);
    if (!fs.existsSync(wav)) execFileSync(BIN, ["synthesize", line.text, "--voice", "Sofia", "--device", "metal", "--seed", String(seed), "-o", wav, "--force", "--quiet"], { stdio: "ignore" });
    const asr = transcribe(wav);
    const words = asr.words ?? [];
    const duration = asr.duration ?? 0;
    const spoken = words.length ? words.at(-1).end - words[0].start : duration;
    const wps = norm(line.text).length / Math.max(0.5, spoken);
    const conf = words.length ? words.reduce((a, w) => a + (w.confidence ?? 0), 0) / words.length : 0;
    // The longest pause between words: Magpie sometimes stalls mid-sentence.
    let gap = 0;
    for (let i = 1; i < words.length; i++) gap = Math.max(gap, words[i].start - words[i - 1].end);
    const e = wer(norm(line.text), norm(asr.text ?? ""));
    scored.push({ seed, wav, text: asr.text, wer: e, wps, conf, gap, duration });
  }
  // Natural pace for this voice is about 2.7 words a second (faster than 3.3 sounds rushed); stalls over 0.9 s are a fault.
  const score = (t) => t.wer * 10 + Math.abs(t.wps - 2.7) * 0.6 + Math.max(0, t.wps - 3.3) * 3 + Math.max(0, t.gap - 0.9) * 2 + (1 - t.conf);
  scored.sort((a, b) => score(a) - score(b));
  const best = scored[0];
  const dst = path.join(OUT, `${line.id}.wav`);
  // A light polish: a high-pass, a touch of presence, de-essing, gentle compression, 48 kHz.
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", best.wav, "-af", "highpass=f=80,equalizer=f=3200:t=q:w=1.2:g=2,deesser=i=0.4,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=120:makeup=2,aresample=48000:filter_size=64:phase_shift=10", "-ac", "1", dst]);
  const asr = transcribe(dst);
  fs.writeFileSync(path.join(OUT, `${line.id}.json`), JSON.stringify({ id: line.id, text: line.text, heard: asr.text, duration: asr.duration, words: asr.words }, null, 2));
  picks[line.id] = { seed: best.seed, wer: Number(best.wer.toFixed(3)), wps: Number(best.wps.toFixed(2)), gap: Number(best.gap.toFixed(2)), duration: Number(best.duration.toFixed(2)) };
  console.log(`${line.id}  seed ${best.seed}  wer ${best.wer.toFixed(2)}  ${best.wps.toFixed(2)} w/s  ${best.duration.toFixed(1)} s  "${best.text}"`);
  fs.writeFileSync(path.join(OUT, "picks.json"), JSON.stringify(picks, null, 2));
}
