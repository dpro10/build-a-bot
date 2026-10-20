/**
 * Cuts the demo video together from the recordings (record/), the cards (cards/), the promo's
 * scenes (video/stage) and Otto's narration (vo/), following the edit list in edit.mjs.
 *
 *   node video/demo/assemble.mjs              → video/out/demo/build-a-bot-demo.mp4 (1920×1080, 60 fps)
 *   node video/demo/assemble.mjs --sheet      also a contact sheet of every segment, to check the cut
 *
 * Each segment is rendered on its own (exact length, 60 fps), joined with hard cuts or short
 * crossfades, and the sound is mixed on one timeline: the narration, the call as it sounded, and
 * the music under it all (ducked under the voice), to −14 LUFS for YouTube.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEGMENTS, MUSIC } from "./edit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const OUT = path.join(ROOT, "video", "out", "demo");
const CLIPS = path.join(OUT, "clips");
const SEGS = path.join(OUT, "segments");
const VO = path.join(OUT, "vo");
const CARDS = path.join(OUT, "cards");
const W = 1920;
const H = 1080;
const FPS = 60;
fs.mkdirSync(SEGS, { recursive: true });

const ff = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
const probeDur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
const ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-r", String(FPS)];
const clipInfo = (name) => JSON.parse(fs.readFileSync(path.join(CLIPS, `${name}.json`), "utf8"));
const render = (args) => execFileSync("node", [path.join(HERE, "cards", "render.mjs"), ...args], { stdio: ["ignore", "ignore", "inherit"] });

/** Pieces of a recording, each trimmed and sped up, back to back (jump cuts), scaled to 1920×1080. */
function renderClip(seg, file) {
  const src = path.join(CLIPS, `${seg.src}.mp4`);
  const parts = seg.pieces.map((p, i) => {
    const crop = p.crop ? `,crop=${p.crop.w}:${p.crop.h}:${p.crop.x}:${p.crop.y}` : seg.crop ? `,crop=${seg.crop.w}:${seg.crop.h}:${seg.crop.x}:${seg.crop.y}` : "";
    const base = `[0:v]trim=start=${p.from}:end=${p.to},setpts=(PTS-STARTPTS)/${p.speed ?? 1}${crop}`;
    if (p.zoom) {
      // A slow push-in (eased) toward a point: zoom 1 → z, centred on (x, y) in the recording's pixels.
      const n = Math.round(((p.to - p.from) / (p.speed ?? 1)) * FPS);
      const e = `(3*pow(min(on/${n}\,1)\,2)-2*pow(min(on/${n}\,1)\,3))`;
      const z = `(1+${p.zoom.z - 1}*${e})`;
      const cx = `(iw/2+(${p.zoom.x}-iw/2)*${e})`;
      const cy = `(ih/2+(${p.zoom.y}-ih/2)*${e})`;
      return `${base},fps=${FPS},zoompan=z='${z}':x='max(0\,min(iw-iw/zoom\,${cx}-iw/zoom/2))':y='max(0\,min(ih-ih/zoom\,${cy}-ih/zoom/2))':d=1:s=${W}x${H}:fps=${FPS},scale=out_range=tv,setsar=1,format=yuv420p[p${i}]`;
    }
    return `${base},scale=${W}:${H}:flags=lanczos:out_range=tv,setsar=1,fps=${FPS},format=yuv420p[p${i}]`;
  });
  const concat = `${seg.pieces.map((_, i) => `[p${i}]`).join("")}concat=n=${seg.pieces.length}:v=1:a=0[v]`;
  ff(["-i", src, "-filter_complex", `${parts.join(";")};${concat}`, "-map", "[v]", ...ENC, "-an", file]);
}

/** The call: the panel's column through a rounded window, captions beside it, dead air trimmed. */
function renderCall(seg, file, timeline) {
  const info = clipInfo("call");
  const src = path.join(CLIPS, "call.mp4");
  // The column around the panel, in the recording's pixels (2×), and the window it shows through.
  const col = seg.column ?? { x: Math.max(0, info.panel.x - 60), y: 0, w: info.panel.width + 120, h: info.size[1] };
  const holeH = 1000;
  const holeW = Math.round((col.w * holeH) / col.h / 2) * 2;
  const hole = { x: seg.holeX ?? 210, y: Math.round((H - holeH) / 2), w: holeW, h: holeH };
  const frame = path.join(SEGS, `callframe-${seg.id}.png`);
  render(["callframe", JSON.stringify({ hole, title: seg.title ?? null, sub: seg.sub ?? null }), "--png", frame]);
  // Captions: one transparent PNG per line, shown from when it's said until the next one.
  const caps = (seg.lines ?? []).map((l, i) => {
    const png = path.join(SEGS, `${seg.id}-cap${i}.png`);
    render(["caption", JSON.stringify({ who: l.who, text: l.text, cut: l.cut ?? false }), "--png", png]);
    return { ...l, png, at: timeline.map(l.src) };
  });
  const dur = timeline.duration;
  const parts = seg.ranges.map(([a, b], i) => `[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS,crop=${col.w}:${col.h}:${col.x}:${col.y},scale=${hole.w}:${hole.h}:flags=lanczos,fps=${FPS}[r${i}]`);
  const join = `${seg.ranges.map((_, i) => `[r${i}]`).join("")}concat=n=${seg.ranges.length}:v=1:a=0[call]`;
  const inputs = ["-i", src, "-f", "lavfi", "-t", String(dur), "-i", `color=c=0xf7f3ec:s=${W}x${H}:r=${FPS}`, "-loop", "1", "-t", String(dur), "-i", frame];
  caps.forEach((c) => inputs.push("-loop", "1", "-t", String(dur), "-i", c.png));
  let chain = `[1:v][call]overlay=${hole.x}:${hole.y}:shortest=1[a0];[a0][2:v]overlay=0:0[b0]`;
  let last = "b0";
  caps.forEach((c, i) => {
    const end = i + 1 < caps.length ? caps[i + 1].at : dur;
    const fadeIn = `fade=t=in:st=${Math.max(0, c.at).toFixed(3)}:d=0.18:alpha=1`;
    const fadeOut = i + 1 < caps.length ? `,fade=t=out:st=${Math.max(0, end - 0.12).toFixed(3)}:d=0.12:alpha=1` : "";
    chain += `;[${3 + i}:v]format=rgba,${fadeIn}${fadeOut}[c${i}];[${last}][c${i}]overlay=0:0[o${i}]`;
    last = `o${i}`;
  });
  ff([...inputs, "-filter_complex", `${parts.join(";")};${join};${chain};[${last}]format=yuv420p[v]`, "-map", "[v]", "-t", String(dur), ...ENC, "-an", file]);
}

/** The promo's own scenes (its reveal and end card), rendered once. */
function renderPromo(seg, file) {
  const raw = path.join(SEGS, `promo-${seg.from}-${seg.to}.mkv`);
  if (!fs.existsSync(raw)) {
    execFileSync("node", [path.join(ROOT, "video", "scripts", "render.mjs"), "video", "--fps", String(FPS), "--from", String(seg.from), "--to", String(seg.to), "--out", raw], {
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, PW_CHANNEL: process.env.PW_CHANNEL ?? "chrome" },
    });
  }
  const speed = seg.speed ?? 1;
  ff(["-i", raw, "-vf", `setpts=PTS/${speed},fps=${FPS},format=yuv420p`, ...ENC, "-an", file]);
}

/** A card from cards.html, rendered for this segment's length. */
function renderCard(seg, file) {
  const name = seg.card;
  const out = `${seg.id}`;
  render([name, String(seg.duration), JSON.stringify(seg.opts ?? {}), out]);
  fs.copyFileSync(path.join(CARDS, `${out}.mp4`), file);
}

/** Maps a moment in the call recording to this segment's time, through its trimmed ranges. */
function callTimeline(ranges) {
  let acc = 0;
  const spans = ranges.map(([a, b]) => {
    const s = { a, b, at: acc };
    acc += b - a;
    return s;
  });
  return {
    duration: acc,
    map(t) {
      for (const s of spans) if (t >= s.a && t <= s.b) return s.at + (t - s.a);
      const next = spans.find((s) => s.a > t);
      return next ? next.at : acc;
    },
    spans,
  };
}

function segmentDuration(seg) {
  if (seg.kind === "clip") return seg.pieces.reduce((d, p) => d + (p.to - p.from) / (p.speed ?? 1), 0);
  if (seg.kind === "call") return callTimeline(seg.ranges).duration;
  if (seg.kind === "promo") return (seg.to - seg.from) / (seg.speed ?? 1);
  return seg.duration;
}

// ---------------------------------------------------------------------------

const sheet = process.argv.includes("--sheet");
// --reuse keeps segments already rendered (after changing only the sound, or one segment with --only).
const reuse = process.argv.includes("--reuse");
const only = (() => {
  const i = process.argv.indexOf("--only");
  return i > 0 ? process.argv[i + 1].split(",") : null;
})();

// 1. Each segment, and where it lands on the timeline (crossfades overlap the one before).
let t = 0;
const placed = [];
for (const [i, seg] of SEGMENTS.entries()) {
  const dur = segmentDuration(seg);
  const fade = i === 0 ? 0 : seg.fade ?? 0;
  const start = Math.max(0, t - fade);
  const file = path.join(SEGS, `${String(i).padStart(2, "0")}-${seg.id}.mp4`);
  if (!fs.existsSync(file) || (only ? only.includes(seg.id) : !reuse)) {
    process.stdout.write(`${seg.id} (${dur.toFixed(2)} s)… `);
    if (seg.kind === "clip") renderClip(seg, file);
    else if (seg.kind === "call") renderCall(seg, file, callTimeline(seg.ranges));
    else if (seg.kind === "promo") renderPromo(seg, file);
    else if (seg.kind === "card") renderCard(seg, file);
    else throw new Error(`unknown segment kind ${seg.kind}`);
    console.log("done");
  }
  placed.push({ seg, file, start, dur, fade });
  t = start + dur;
}
const total = t;
console.log(`\ntimeline: ${placed.length} segments, ${total.toFixed(2)} s`);

// 2. The picture: hard cuts and crossfades.
const video = path.join(OUT, "demo-video.mp4");
{
  const inputs = placed.flatMap((p) => ["-i", p.file]);
  // Same size, pixel shape, range (the recordings are full-range JPEG frames) and clock for all.
  let graph = placed.map((_, i) => `[${i}:v]scale=${W}:${H}:out_range=tv,setsar=1,format=yuv420p,fps=${FPS},settb=1/${FPS * 256},setpts=PTS-STARTPTS[s${i}];`).join("");
  let last = "[s0]";
  let at = placed[0].dur;
  for (let i = 1; i < placed.length; i++) {
    const p = placed[i];
    const outLabel = `[x${i}]`;
    // Both joins keep the same clock, so the next crossfade accepts them.
    if (p.fade > 0) graph += `${last}[s${i}]xfade=transition=fade:duration=${p.fade}:offset=${(at - p.fade).toFixed(3)},settb=1/${FPS * 256}${outLabel};`;
    else graph += `${last}[s${i}]concat=n=2:v=1:a=0,settb=1/${FPS * 256}${outLabel};`;
    at = at - p.fade + p.dur;
    last = outLabel;
  }
  graph += `${last}format=yuv420p[v]`;
  ff([...inputs, "-filter_complex", graph, "-map", "[v]", ...ENC, "-an", video]);
}

// 3. The sound: narration lines and the call where they belong, the music under them.
const cues = [];
for (const p of placed) {
  for (const v of p.seg.vo ?? []) cues.push({ kind: "vo", file: path.join(VO, `${v.id}.wav`), at: p.start + v.at, gain: v.gain ?? 1 });
  if (p.seg.kind === "call") {
    const tl = callTimeline(p.seg.ranges);
    for (const s of tl.spans) cues.push({ kind: "call", file: path.join(CLIPS, "call.wav"), at: p.start + s.at, from: s.a, to: s.b, gain: p.seg.callGain ?? 1 });
  }
  if (p.seg.kind === "clip" && p.seg.src === "call" && p.seg.callGain) {
    let acc = 0;
    for (const piece of p.seg.pieces) {
      cues.push({ kind: "call", file: path.join(CLIPS, "call.wav"), at: p.start + acc, from: piece.from, to: piece.to, gain: p.seg.callGain, speed: piece.speed ?? 1 });
      acc += (piece.to - piece.from) / (piece.speed ?? 1);
    }
  }
}
const voTimes = cues.filter((c) => c.kind === "vo").map((c) => ({ file: path.basename(c.file), a: c.at, b: c.at + probeDur(c.file) }));
// Narration never talks over itself, or over the call where the call is meant to be heard.
const heardCall = cues.filter((c) => c.kind === "call" && c.gain >= 0.5).map((c) => ({ a: c.at, b: c.at + (c.to - c.from) / (c.speed ?? 1) }));
for (const [i, v] of voTimes.entries()) {
  for (const w of voTimes.slice(i + 1)) if (v.a < w.b - 0.05 && w.a < v.b - 0.05) throw new Error(`${v.file} and ${w.file} overlap (${v.a.toFixed(2)}–${v.b.toFixed(2)} and ${w.a.toFixed(2)}–${w.b.toFixed(2)})`);
  for (const c of heardCall) if (v.a < c.b - 0.05 && c.a < v.b - 0.05) throw new Error(`${v.file} talks over the call at ${c.a.toFixed(2)}`);
}
const audio = path.join(OUT, "demo-mix.wav");
{
  const inputs = [];
  const parts = [];
  cues.forEach((c, i) => {
    inputs.push("-i", c.file);
    const trim = c.from !== undefined ? `atrim=start=${c.from}:end=${c.to},asetpts=PTS-STARTPTS,` : "";
    const tempo = c.speed && c.speed !== 1 ? `atempo=${c.speed},` : "";
    // Each piece fades in and out over a few milliseconds, so cuts don't click.
    const d = c.from !== undefined ? (c.to - c.from) / (c.speed ?? 1) : probeDur(c.file);
    parts.push(`[${i}:a]aresample=48000,aformat=channel_layouts=mono,${trim}${tempo}afade=t=in:d=0.015,afade=t=out:st=${Math.max(0, d - 0.03).toFixed(3)}:d=0.03,volume=${c.gain},adelay=${Math.round(c.at * 1000)}:all=1[a${i}]`);
  });
  const voice = `${cues.map((_, i) => `[a${i}]`).join("")}amix=inputs=${cues.length}:normalize=0:dropout_transition=0,apad=whole_dur=${total.toFixed(3)}[voice]`;
  let graph = `${parts.join(";")};${voice}`;
  let mixIn = "[voice]";
  if (MUSIC && fs.existsSync(MUSIC.file)) {
    inputs.push("-stream_loop", "-1", "-i", MUSIC.file);
    const m = cues.length;
    // The music ducks under the voice (sidechain), and fades in and out with the video.
    graph += `;[voice]asplit=2[vmix][vkey];[${m}:a]aresample=48000,aformat=channel_layouts=mono,atrim=duration=${total.toFixed(3)},volume=${MUSIC.gain},afade=t=in:d=1.5,afade=t=out:st=${(total - 3).toFixed(3)}:d=3[mus];[mus][vkey]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=400[duck];[vmix][duck]amix=inputs=2:normalize=0[mixed]`;
    mixIn = "[mixed]";
  }
  graph += `;${mixIn}aresample=48000[out]`;
  const premix = path.join(OUT, "demo-premix.wav");
  ff([...inputs, "-filter_complex", graph, "-map", "[out]", "-ac", "2", "-c:a", "pcm_f32le", "-t", total.toFixed(3), premix]);
  // Two passes to −14 LUFS (YouTube's level), true peaks under −1.5 dBTP: measure, then apply exactly.
  const measured = execFileSync("ffmpeg", ["-hide_banner", "-nostats", "-i", premix, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] });
  const m = JSON.parse(/\{[\s\S]*\}/.exec(measured.toString() || "")?.[0] ?? "{}");
  const stats = m.input_i ? m : JSON.parse(/\{[^{}]*"input_i"[^{}]*\}/.exec(execFileSync("sh", ["-c", `ffmpeg -hide_banner -nostats -i '${premix}' -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1`]).toString())[0]);
  ff(["-i", premix, "-af", `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true,aresample=48000`, "-ac", "2", audio]);
}

// 4. Together, for YouTube.
const final = path.join(OUT, "build-a-bot-demo.mp4");
ff(["-i", video, "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", "-shortest", final]);
console.log(`→ ${path.relative(ROOT, final)} (${total.toFixed(1)} s)`);
fs.writeFileSync(path.join(OUT, "timeline.json"), JSON.stringify({ total, segments: placed.map((p) => ({ id: p.seg.id, start: Number(p.start.toFixed(3)), dur: Number(p.dur.toFixed(3)) })), vo: voTimes }, null, 2));

if (sheet) {
  // One frame from the middle of each segment.
  const frames = placed.map((p, i) => {
    const png = path.join(SEGS, `sheet-${i}.png`);
    ff(["-ss", (p.start + p.dur / 2).toFixed(2), "-i", final, "-frames:v", "1", "-vf", "scale=480:-1", png]);
    return png;
  });
  const cols = 5;
  const rows = Math.ceil(frames.length / cols);
  ff([...frames.flatMap((f) => ["-i", f]), "-filter_complex", `${frames.map((_, i) => `[${i}:v]`).join("")}xstack=inputs=${frames.length}:layout=${frames.map((_, i) => `${(i % cols) * 480}_${Math.floor(i / cols) * 270}`).join("|")}:fill=black[v]`, "-map", "[v]", "-frames:v", "1", path.join(OUT, "sheet.png")]);
  console.log(`sheet → ${path.relative(ROOT, path.join(OUT, "sheet.png"))} (${rows} rows)`);
}
