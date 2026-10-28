/**
 * Cuts the demo video together from the recordings (record/), the cards (cards/), the promo's
 * scenes and the narration, following the edit list in edit.mjs.
 *
 *   node video/demo/assemble.mjs              → video/out/demo/build-a-bot-demo.mp4 (1920×1080, 60 fps)
 *   node video/demo/assemble.mjs --sheet      also a contact sheet of every segment, to check the cut
 *   node video/demo/assemble.mjs --plan       where everything lands, and whether the sound fits, without rendering
 *   node video/demo/assemble.mjs --reuse --sound-only     only the sound again (after the music changes)
 *   node video/demo/assemble.mjs --edit video/demo/edit-voiceover.mjs   another edit list (its own folder)
 *
 * Each segment is rendered on its own (exact length, 60 fps), joined with hard cuts or short
 * crossfades, and the sound is mixed on one timeline: the narration, the call as it sounded, what
 * the desktop app heard, and the music under it all (ducked under the voice), to −14 LUFS for YouTube.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const OUT = path.join(ROOT, "video", "out", "demo");
const CLIPS = path.join(OUT, "clips");
// --edit picks another edit list (edit-voiceover.mjs); a NAME keeps its work and result apart.
const EDIT = (() => {
  const i = process.argv.indexOf("--edit");
  return i > 0 ? path.resolve(process.argv[i + 1]) : path.join(HERE, "edit.mjs");
})();
const { SEGMENTS, MUSIC, VO_DIR, CALL_MIX, NAME, SCORE } = await import(pathToFileURL(EDIT).href);
const WORK = NAME ? path.join(OUT, NAME) : OUT;
const SEGS = path.join(WORK, "segments");
const VO = VO_DIR ?? path.join(OUT, "vo");
const CARDS = path.join(OUT, "cards");
const FINAL = path.join(OUT, NAME ? `build-a-bot-demo-${NAME}.mp4` : "build-a-bot-demo.mp4");
const W = 1920;
const H = 1080;
const FPS = 60;
fs.mkdirSync(SEGS, { recursive: true });

const ff = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
const probeDur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
const ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-r", String(FPS)];
const clipInfo = (name) => JSON.parse(fs.readFileSync(path.join(CLIPS, `${name}.json`), "utf8"));
const render = (args) => execFileSync("node", [path.join(HERE, "cards", "render.mjs"), ...args], { stdio: ["ignore", "ignore", "inherit"] });

/** A file's integrated loudness (LUFS) and true peak (dBTP). */
function loudness(file) {
  const out = execFileSync("sh", ["-c", `ffmpeg -hide_banner -nostats -i '${file}' -af ebur128=peak=true -f null - 2>&1`]).toString();
  const summary = out.slice(out.lastIndexOf("Summary:"));
  return { I: Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)[1]), TP: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)[1]) };
}

/** How long a piece of a recording plays for in the cut. */
const pieceLength = (p) => (p.freeze !== undefined ? p.dur : (p.to - p.from) / (p.speed ?? 1));

/** Maps a moment in a recording to a clip segment's time, through its pieces (frozen ones aside). */
function clipTimeline(pieces) {
  let acc = 0;
  const spans = pieces.map((p) => {
    const s = { ...p, at: acc, len: pieceLength(p) };
    acc += s.len;
    return s;
  });
  return {
    duration: acc,
    spans,
    map(t) {
      for (const s of spans) if (s.freeze === undefined && t >= s.from && t <= s.to) return s.at + (t - s.from) / (s.speed ?? 1);
      const next = spans.find((s) => s.freeze === undefined && s.from > t);
      return next ? next.at : acc;
    },
  };
}

/**
 * A slow push (eased) from one framing to another: zoom z centred on (x, y) in the recording's
 * pixels; `from` defaults to the whole frame.
 */
function zoomFilter(zoom, frames, size = { w: W, h: H }) {
  const from = zoom.from ?? { z: 1 };
  const e = `(3*pow(min(on/${frames}\\,1)\\,2)-2*pow(min(on/${frames}\\,1)\\,3))`;
  const lerp = (a, b) => `(${a}+(${b}-(${a}))*${e})`;
  const z = lerp(from.z, zoom.z);
  const cx = lerp(from.x ?? "iw/2", zoom.x ?? "iw/2");
  const cy = lerp(from.y ?? "ih/2", zoom.y ?? "ih/2");
  return `zoompan=z='${z}':x='max(0\\,min(iw-iw/zoom\\,${cx}-iw/zoom/2))':y='max(0\\,min(ih-ih/zoom\\,${cy}-ih/zoom/2))':d=1:s=${size.w}x${size.h}:fps=${FPS}`;
}

/** A rounded-corner mask (white inside), for a recording shown in a window. */
function roundMask(w, h, r) {
  const png = path.join(SEGS, `mask-${w}x${h}-${r}.png`);
  if (!fs.existsSync(png)) {
    const d = `hypot(max(max(${r}-X\\,X-(W-1-${r}))\\,0)\\,max(max(${r}-Y\\,Y-(H-1-${r}))\\,0))`;
    ff(["-f", "lavfi", "-i", `color=black:s=${w}x${h}:d=0.1`, "-vf", `format=gray,geq=lum='if(lte(${d}\\,${r})\\,255\\,0)'`, "-frames:v", "1", png]);
  }
  return png;
}

/**
 * Overlays (transparent PNGs from cards.html): subtitles of what's said, at the moment in the
 * recording they're said (`src`), and notes (`card: "sidenote"`) at a time in the segment (`at`,
 * until `end`; a negative end counts from the segment's end). Fades in and out, except between
 * subtitles back to back.
 */
function overlayItems(seg, tl) {
  const subs = (seg.subs ?? []).map((sub, k, all) => {
    const a = tl.map(sub.src);
    const b = sub.until !== undefined ? tl.map(sub.until) : k + 1 < all.length ? tl.map(all[k + 1].src) : tl.duration;
    const joinedNext = k + 1 < all.length && sub.until === undefined;
    const joinedPrev = k > 0 && all[k - 1].until === undefined;
    return { card: "subtitle", opts: { who: sub.who, color: sub.color, text: sub.text, y: sub.y }, a, b, fadeIn: !joinedPrev, fadeOut: !joinedNext && b < tl.duration - 0.01 };
  });
  const notes = (seg.notes ?? []).map((n) => {
    const a = n.at ?? 0;
    const b = n.end === undefined ? tl.duration : n.end < 0 ? tl.duration + n.end : n.end;
    return { card: n.card ?? "sidenote", opts: n.opts, a, b, fadeIn: true, fadeOut: b < tl.duration - 0.01 };
  });
  return [...subs, ...notes];
}

/**
 * Pieces of a recording, each trimmed and sped up (or held), back to back (jump cuts), scaled to
 * 1920×1080, with its subtitles on top.
 */
function renderClip(seg, file) {
  const src = seg.file ?? path.join(CLIPS, `${seg.src}.mp4`);
  const inputs = [];
  const graph = [];
  const lastInput = () => inputs.filter((a) => a === "-i").length - 1;
  // A still from another moment pasted over part of the frame, while the bubble shows.
  const patches = (seg.patches ?? []).map((p, k) => {
    const png = path.join(SEGS, `${seg.id}-patch${k}.png`);
    ff(["-ss", String(p.src), "-i", src, "-frames:v", "1", "-vf", `crop=${p.w}:${p.h}:${p.x}:${p.y}`, png]);
    return { ...p, png };
  });
  const n = seg.pieces.length;
  // In a frame, the pieces fill its window; otherwise the whole picture.
  const size = seg.frame ? { w: seg.frame.w, h: seg.frame.h } : { w: W, h: H };
  seg.pieces.forEach((p, i) => {
    // Each piece reads only its own seconds: one decoder shared by all of them would queue every
    // frame for the later pieces in memory (several GB for a long take at 2560×1440).
    const start = p.freeze ?? p.from;
    const len = p.freeze !== undefined ? 2 / FPS : p.to - p.from;
    inputs.push("-ss", start.toFixed(3), "-t", len.toFixed(3), "-i", src);
    let cur = `[${lastInput()}:v]`;
    patches
      .filter((pt) => pt.from < start + len && pt.to > start)
      .forEach((pt, k) => {
        inputs.push("-loop", "1", "-i", pt.png);
        graph.push(`${cur}setpts=PTS-STARTPTS[pr${i}_${k}];[pr${i}_${k}][${lastInput()}:v]overlay=${pt.x}:${pt.y}:enable='between(t,${(pt.from - start).toFixed(3)},${(pt.to - start).toFixed(3)})':shortest=1[pp${i}_${k}]`);
        cur = `[pp${i}_${k}]`;
      });
    const crop = p.crop ? `,crop=${p.crop.w}:${p.crop.h}:${p.crop.x}:${p.crop.y}` : seg.crop ? `,crop=${seg.crop.w}:${seg.crop.h}:${seg.crop.x}:${seg.crop.y}` : "";
    const base =
      p.freeze !== undefined
        ? `${cur}setpts=PTS-STARTPTS,trim=end_frame=1,tpad=stop_mode=clone:stop_duration=${p.dur + 0.1},trim=duration=${p.dur},setpts=PTS-STARTPTS${crop}`
        : `${cur}setpts=(PTS-STARTPTS)/${p.speed ?? 1}${crop}`;
    if (p.zoom) graph.push(`${base},fps=${FPS},${zoomFilter(p.zoom, Math.round(pieceLength(p) * FPS), size)},scale=out_range=tv,setsar=1,format=yuv420p[p${i}]`);
    else graph.push(`${base},scale=${size.w}:${size.h}:flags=lanczos:out_range=tv,setsar=1,fps=${FPS},format=yuv420p[p${i}]`);
  });
  graph.push(`${seg.pieces.map((_, i) => `[p${i}]`).join("")}concat=n=${n}:v=1:a=0[cut]`);
  const tl = clipTimeline(seg.pieces);
  let last = "cut";
  if (seg.frame) {
    // The recording in a rounded window on a card that moves with it (the builder's steps and clock).
    const f = seg.frame;
    const cardName = `${NAME ?? "demo"}-${seg.id}-frame`;
    render([f.card, tl.duration.toFixed(3), JSON.stringify({ ...f.opts, win: { x: f.x, y: f.y, w: f.w, h: f.h }, spans: tl.spans }), cardName]);
    inputs.push("-i", path.join(CARDS, `${cardName}.mp4`), "-loop", "1", "-i", roundMask(f.w, f.h, f.radius ?? 22));
    const card = lastInput() - 1;
    graph.push(`[${lastInput()}:v]format=gray[mask];[cut]format=rgba[cutrgba];[cutrgba][mask]alphamerge[win];[${card}:v]format=yuv420p[cardv];[cardv][win]overlay=${f.x}:${f.y}:shortest=1[framed]`);
    last = "framed";
  }
  // Subtitles and notes: one transparent PNG each.
  overlayItems(seg, tl).forEach((o, k) => {
    const png = path.join(SEGS, `${seg.id}-overlay${k}.png`);
    render([o.card, JSON.stringify(o.opts), "--png", png]);
    inputs.push("-loop", "1", "-t", String(tl.duration), "-i", png);
    const fadeIn = o.fadeIn ? `,fade=t=in:st=${o.a.toFixed(3)}:d=0.2:alpha=1` : "";
    const fadeOut = o.fadeOut ? `,fade=t=out:st=${Math.max(o.a, o.b - 0.2).toFixed(3)}:d=0.2:alpha=1` : "";
    graph.push(`[${lastInput()}:v]format=rgba${fadeIn}${fadeOut}[s${k}];[${last}][s${k}]overlay=0:0:enable='between(t,${o.a.toFixed(3)},${o.b.toFixed(3)})'[o${k}]`);
    last = `o${k}`;
  });
  graph.push(`[${last}]format=yuv420p[v]`);
  ff([...inputs, "-filter_complex", graph.join(";"), "-map", "[v]", "-t", tl.duration.toFixed(3), ...ENC, "-an", file]);
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
  // One seeked input per range (see renderClip), then the background, the frame and the captions.
  const R = seg.ranges.length;
  const inputs = seg.ranges.flatMap(([a, b]) => ["-ss", a.toFixed(3), "-t", (b - a).toFixed(3), "-i", src]);
  const parts = seg.ranges.map((_, i) => `[${i}:v]setpts=PTS-STARTPTS,crop=${col.w}:${col.h}:${col.x}:${col.y},scale=${hole.w}:${hole.h}:flags=lanczos,fps=${FPS}[r${i}]`);
  const join = `${seg.ranges.map((_, i) => `[r${i}]`).join("")}concat=n=${R}:v=1:a=0[call]`;
  inputs.push("-f", "lavfi", "-t", String(dur), "-i", `color=c=0xf7f3ec:s=${W}x${H}:r=${FPS}`, "-loop", "1", "-t", String(dur), "-i", frame);
  caps.forEach((c) => inputs.push("-loop", "1", "-t", String(dur), "-i", c.png));
  let chain = `[${R}:v][call]overlay=${hole.x}:${hole.y}:shortest=1[a0];[a0][${R + 1}:v]overlay=0:0[b0]`;
  let last = "b0";
  caps.forEach((c, i) => {
    const end = i + 1 < caps.length ? caps[i + 1].at : dur;
    const fadeIn = `fade=t=in:st=${Math.max(0, c.at).toFixed(3)}:d=0.18:alpha=1`;
    const fadeOut = i + 1 < caps.length ? `,fade=t=out:st=${Math.max(0, end - 0.12).toFixed(3)}:d=0.12:alpha=1` : "";
    chain += `;[${R + 2 + i}:v]format=rgba,${fadeIn}${fadeOut}[c${i}];[${last}][c${i}]overlay=0:0[o${i}]`;
    last = `o${i}`;
  });
  ff([...inputs, "-filter_complex", `${parts.join(";")};${join};${chain};[${last}]format=yuv420p[v]`, "-map", "[v]", "-t", String(dur), ...ENC, "-an", file]);
}

/**
 * The call's sound with the two voices evened out: the recording keeps the bot's voice (Magpie, as
 * the page played it) and the caller's lines apart, so each gets its own level here.
 */
function callTrack() {
  if (!CALL_MIX) return path.join(CLIPS, "call.wav");
  const out = path.join(SEGS, "call.balanced.wav");
  const { caller } = JSON.parse(fs.readFileSync(path.join(CLIPS, "call.transcript.json"), "utf8"));
  const lines = caller.map((c) => ({ ...c, file: path.join(OUT, "caller", c.file) }));
  const inputs = ["-i", path.join(CLIPS, "call.bot.wav"), ...lines.flatMap((c) => ["-i", c.file])];
  const graph = [`[0:a]aresample=48000,volume=${CALL_MIX.bot}[b]`, ...lines.map((c, i) => `[${i + 1}:a]aresample=48000,volume=${CALL_MIX.caller},adelay=${Math.round(c.at * 1000)}:all=1[c${i}]`)];
  graph.push(`[b]${lines.map((_, i) => `[c${i}]`).join("")}amix=inputs=${lines.length + 1}:normalize=0[out]`);
  ff([...inputs, "-filter_complex", graph.join(";"), "-map", "[out]", "-ac", "1", "-c:a", "pcm_f32le", out]);
  return out;
}
const CALL_WAV = callTrack();

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
  const spans = ranges.map(([a, b, gain]) => {
    const s = { a, b, at: acc, gain };
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
  if (seg.kind === "clip") return clipTimeline(seg.pieces).duration;
  if (seg.kind === "call") return callTimeline(seg.ranges).duration;
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

// 1. Where each segment lands on the timeline (crossfades overlap the one before).
let t = 0;
const placed = [];
for (const [i, seg] of SEGMENTS.entries()) {
  const dur = segmentDuration(seg);
  const fade = i === 0 ? 0 : seg.fade ?? 0;
  const start = Math.max(0, t - fade);
  const file = path.join(SEGS, `${String(i).padStart(2, "0")}-${seg.id}.mp4`);
  placed.push({ seg, file, start, dur, fade });
  t = start + dur;
}
const total = t;

// 2. The sound's cues: narration lines, the call, and what the desktop app heard, where they belong.
const cues = [];
for (const p of placed) {
  for (const v of p.seg.vo ?? []) cues.push({ kind: "vo", file: path.join(VO, `${v.id}.wav`), at: p.start + v.at, gain: v.gain ?? 1 });
  if (p.seg.kind === "call") {
    const tl = callTimeline(p.seg.ranges);
    for (const s of tl.spans) {
      const gain = s.gain ?? p.seg.callGain ?? 1;
      if (gain > 0) cues.push({ kind: "call", file: CALL_WAV, at: p.start + s.at, from: s.a, to: s.b, gain });
    }
  }
  // Sound recorded with a take (what the desktop app heard), where each piece shows it.
  if (p.seg.kind === "clip" && p.seg.audio) {
    const tl = clipTimeline(p.seg.pieces);
    for (const a of p.seg.audio) {
      const len = probeDur(a.file);
      for (const s of tl.spans) {
        if (s.freeze !== undefined) continue;
        const from = Math.max(s.from, a.at);
        const to = Math.min(s.to, a.at + len);
        if (to - from < 0.05) continue;
        cues.push({ kind: "heard", file: a.file, at: p.start + s.at + (from - s.from) / (s.speed ?? 1), from: from - a.at, to: to - a.at, gain: s.gain ?? a.gain ?? 1, speed: s.speed ?? 1 });
      }
    }
  }
}
const voTimes = cues.filter((c) => c.kind === "vo").map((c) => ({ file: path.basename(c.file), a: c.at, b: c.at + probeDur(c.file) }));
// Narration never talks over itself, or over the call (or the desktop app's sound) where it's meant
// to be heard. Every clash is listed before anything is rendered.
const heardCall = cues.filter((c) => (c.kind === "call" || c.kind === "heard") && c.gain >= 0.5).map((c) => ({ a: c.at, b: c.at + (c.to - c.from) / (c.speed ?? 1) }));
const clashes = [];
for (const [i, v] of voTimes.entries()) {
  for (const w of voTimes.slice(i + 1)) if (v.a < w.b - 0.05 && w.a < v.b - 0.05) clashes.push(`${v.file} and ${w.file} overlap (${v.a.toFixed(2)}–${v.b.toFixed(2)} and ${w.a.toFixed(2)}–${w.b.toFixed(2)})`);
  for (const c of heardCall) if (v.a < c.b - 0.05 && c.a < v.b - 0.05) clashes.push(`${v.file} (${v.a.toFixed(2)}–${v.b.toFixed(2)}) talks over the call or the desktop app's sound (${c.a.toFixed(2)}–${c.b.toFixed(2)})`);
}
if (process.argv.includes("--plan")) {
  // The cut on paper: where each segment and line lands, without rendering anything.
  for (const p of placed) {
    console.log(`${p.start.toFixed(2).padStart(7)}  ${p.seg.id} (${p.dur.toFixed(2)} s)`);
    for (const v of voTimes.filter((x) => x.a >= p.start - 0.01 && x.a < p.start + p.dur)) console.log(`${"".padStart(9)}${v.file.replace(".wav", "")} ${v.a.toFixed(2)}–${v.b.toFixed(2)}`);
  }
  console.log(`total ${total.toFixed(2)} s`);
}
if (clashes.length) throw new Error(`the sound doesn't fit:\n  ${clashes.join("\n  ")}`);
// Where everything lands (music.py scores to it, check-voice.mjs listens at it).
fs.writeFileSync(
  path.join(WORK, "timeline.json"),
  JSON.stringify(
    {
      total,
      segments: placed.map((p) => ({ id: p.seg.id, start: Number(p.start.toFixed(3)), dur: Number(p.dur.toFixed(3)) })),
      vo: voTimes,
      heard: heardCall.map((c) => ({ a: Number(c.a.toFixed(3)), b: Number(c.b.toFixed(3)) })),
      // Where the score's sections turn (music.py): segment ids in the edit.
      score: SCORE ?? null,
    },
    null,
    2,
  ),
);
if (process.argv.includes("--plan")) process.exit(0);

// 3. Each segment rendered on its own (missing ones, those named with --only, or all of them).
for (const p of placed) {
  const { seg, file, dur } = p;
  if (!fs.existsSync(file) || (only ? only.includes(seg.id) : !reuse)) {
    process.stdout.write(`${seg.id} (${dur.toFixed(2)} s)… `);
    if (seg.kind === "clip") renderClip(seg, file);
    else if (seg.kind === "call") renderCall(seg, file, callTimeline(seg.ranges));
    else if (seg.kind === "card") renderCard(seg, file);
    else throw new Error(`unknown segment kind ${seg.kind}`);
    console.log("done");
  }
}
console.log(`\ntimeline: ${placed.length} segments, ${total.toFixed(2)} s`);

// 4. The picture: hard cuts and crossfades.
const video = path.join(WORK, "demo-video.mp4");
// --sound-only keeps the picture from the last run (after changing only the music or the mix).
if (!(process.argv.includes("--sound-only") && fs.existsSync(video))) {
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

// 5. The sound: the cues mixed, the music under them.
const audio = path.join(WORK, "demo-mix.wav");
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
    graph += `;[voice]asplit=2[vmix][vkey];[${m}:a]aresample=48000,aformat=channel_layouts=mono,atrim=duration=${total.toFixed(3)},volume=${MUSIC.gain},afade=t=in:d=1.5,afade=t=out:st=${(total - 3).toFixed(3)}:d=3[mus];[mus][vkey]sidechaincompress=threshold=0.012:ratio=12:attack=15:release=450[duck];[vmix][duck]amix=inputs=2:normalize=0[mixed]`;
    mixIn = "[mixed]";
  }
  graph += `;${mixIn}aresample=48000[out]`;
  const premix = path.join(WORK, "demo-premix.wav");
  ff([...inputs, "-filter_complex", graph, "-map", "[out]", "-ac", "2", "-c:a", "pcm_f32le", "-t", total.toFixed(3), premix]);
  // To −14 LUFS (YouTube's level) with one gain for the whole video, and a limiter (4× oversampled,
  // so it holds true peaks) keeping the loudest syllables under −1.5 dBTP. loudnorm would turn into
  // an automatic gain when the peaks don't fit, and push the music up and down between the voices.
  // Measured, applied, then corrected once for what the limiter took off.
  let gain = -14 - loudness(premix).I;
  for (let pass = 0; pass < 2; pass++) {
    ff(["-i", premix, "-af", `volume=${gain.toFixed(2)}dB,aresample=192000,alimiter=limit=${10 ** (-1.6 / 20)}:attack=4:release=80:level=0:latency=1,aresample=48000`, "-ac", "2", "-c:a", "pcm_s24le", audio]);
    gain += -14 - loudness(audio).I;
  }
  const done = loudness(audio);
  console.log(`sound: ${done.I} LUFS, true peak ${done.TP} dBTP`);
}

// 6. Together, for YouTube.
const final = FINAL;
ff(["-i", video, "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", "-shortest", final]);
console.log(`→ ${path.relative(ROOT, final)} (${total.toFixed(1)} s)`);

if (sheet) {
  // One frame from the middle of each segment.
  const frames = placed.map((p, i) => {
    const png = path.join(SEGS, `sheet-${i}.png`);
    ff(["-ss", (p.start + p.dur / 2).toFixed(2), "-i", final, "-frames:v", "1", "-vf", "scale=480:-1", png]);
    return png;
  });
  const cols = 5;
  const rows = Math.ceil(frames.length / cols);
  ff([...frames.flatMap((f) => ["-i", f]), "-filter_complex", `${frames.map((_, i) => `[${i}:v]`).join("")}xstack=inputs=${frames.length}:layout=${frames.map((_, i) => `${(i % cols) * 480}_${Math.floor(i / cols) * 270}`).join("|")}:fill=black[v]`, "-map", "[v]", "-frames:v", "1", path.join(WORK, "sheet.png")]);
  console.log(`sheet → ${path.relative(ROOT, path.join(WORK, "sheet.png"))} (${rows} rows)`);
}
