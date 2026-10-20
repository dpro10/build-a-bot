/**
 * Checks the finished video's narration: each line, cut from the final mix where the timeline put
 * it, is transcribed by NVIDIA Parakeet and compared with the script. With music and the call under
 * it, every line should still come back word for word.
 *   node video/demo/check-voice.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEGMENTS } from "./edit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "out", "demo");
const APP = path.join(os.homedir(), "Library", "Application Support", "Build-a-bot", "speech");
const BIN = process.env.NEMO_SPEECH_BIN ?? path.join(APP, "runtime", "bin", "nemo-speech");
const PARAKEET = process.env.PARAKEET_GGUF ?? path.join(APP, "models", "parakeet-tdt-0.6b-v3.q8_0.gguf");
const lines = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(HERE, "vo", "lines.json"), "utf8")).map((l) => [l.id, l.text]));
const timeline = JSON.parse(fs.readFileSync(path.join(OUT, "timeline.json"), "utf8"));
const starts = Object.fromEntries(timeline.segments.map((s) => [s.id, s.start]));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vo-check-"));
const norm = (s) => s.toLowerCase().replace(/build[\s-]*a[\s-]*bot/g, "buildabot").replace(/twenty[\s-]*four hundred|2,?400/g, "twentyfourhundred").replace(/\bdot\b/g, " ").replace(/\bany time\b/g, "anytime").replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
function wer(ref, hyp) {
  const d = Array.from({ length: ref.length + 1 }, (_, i) => [i, ...Array(hyp.length).fill(0)]);
  for (let j = 1; j <= hyp.length; j++) d[0][j] = j;
  for (let i = 1; i <= ref.length; i++) for (let j = 1; j <= hyp.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  return d[ref.length][hyp.length] / Math.max(1, ref.length);
}
let bad = 0;
for (const seg of SEGMENTS) {
  for (const v of seg.vo ?? []) {
    const at = starts[seg.id] + v.at;
    const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(OUT, "vo", `${v.id}.wav`)]).toString());
    const wav = path.join(tmp, `${v.id}.wav`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", (at - 0.1).toFixed(3), "-t", (dur + 0.2).toFixed(3), "-i", path.join(OUT, "build-a-bot-demo.mp4"), "-ar", "16000", "-ac", "1", wav]);
    const json = wav.replace(".wav", ".json");
    execFileSync(BIN, ["transcribe", wav, "--model", PARAKEET, "-f", "json", "--quiet", "--force", "-o", json], { stdio: "ignore" });
    const heard = JSON.parse(fs.readFileSync(json, "utf8")).text ?? "";
    const e = wer(norm(lines[v.id]), norm(heard));
    if (e > 0) bad++;
    console.log(`${e === 0 ? "ok  " : "MISS"} ${v.id} @ ${at.toFixed(1)}s  wer ${e.toFixed(2)}  "${heard}"`);
  }
}
console.log(bad ? `${bad} line(s) not heard word for word` : "every line heard word for word");
