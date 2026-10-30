/**
 * Checks the finished video's narration: each line, cut from the final mix where the timeline put
 * it (timeline.json, written by assemble.mjs), is transcribed by NVIDIA Parakeet and compared with
 * the script (vo/lines.json; a line the edit splits in two is checked part by part). With music and
 * the call under it, every line should still come back word for word.
 *   node video/demo/check-voice.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "out", "demo");
const APP = path.join(os.homedir(), "Library", "Application Support", "Build-a-bot", "speech");
const BIN = process.env.NEMO_SPEECH_BIN ?? path.join(APP, "runtime", "bin", "nemo-speech");
const PARAKEET = process.env.PARAKEET_GGUF ?? path.join(APP, "models", "parakeet-tdt-0.6b-v3.q8_0.gguf");
const lines = {};
for (const l of JSON.parse(fs.readFileSync(path.join(HERE, "vo", "lines.json"), "utf8"))) {
  lines[l.id] = l.text;
  Object.assign(lines, l.parts ?? {});
}
const timeline = JSON.parse(fs.readFileSync(path.join(OUT, "timeline.json"), "utf8"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vo-check-"));
// Spellings Parakeet and the script may disagree on, while the words are the same.
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/build[\s-]*a[\s-]*bot/g, "buildabot")
    .replace(/twelve thousand|12,?000/g, "twelvethousand")
    .replace(/five dollars|\$5\b/g, "fivedollars")
    .replace(/\btwelve\b/g, "12")
    .replace(/\btav[ai]l[iy]\b/g, "tavily")
    .replace(/\bn[ei]motron\b/g, "nemotron")
    .replace(/\bokay\b/g, "ok")
    .replace(/\bit's\b/g, "its")
    .replace(/\bdot\b/g, " ")
    .replace(/\bany time\b/g, "anytime")
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
function wer(ref, hyp) {
  const d = Array.from({ length: ref.length + 1 }, (_, i) => [i, ...Array(hyp.length).fill(0)]);
  for (let j = 1; j <= hyp.length; j++) d[0][j] = j;
  for (let i = 1; i <= ref.length; i++) for (let j = 1; j <= hyp.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  return d[ref.length][hyp.length] / Math.max(1, ref.length);
}
let bad = 0;
for (const v of timeline.vo) {
  const id = v.file.replace(/\.wav$/, "");
  const wav = path.join(tmp, `${id}.wav`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", (v.a - 0.1).toFixed(3), "-t", (v.b - v.a + 0.2).toFixed(3), "-i", path.join(OUT, "build-a-bot-demo.mp4"), "-ar", "16000", "-ac", "1", wav]);
  const json = wav.replace(".wav", ".json");
  execFileSync(BIN, ["transcribe", wav, "--model", PARAKEET, "-f", "json", "--quiet", "--force", "-o", json], { stdio: "ignore" });
  const heard = JSON.parse(fs.readFileSync(json, "utf8")).text ?? "";
  const e = wer(norm(lines[id] ?? ""), norm(heard));
  if (e > 0) bad++;
  console.log(`${e === 0 ? "ok  " : "MISS"} ${id} @ ${v.a.toFixed(1)}s  wer ${e.toFixed(2)}  "${heard}"`);
}
console.log(bad ? `${bad} line(s) not heard word for word` : "every line heard word for word");
