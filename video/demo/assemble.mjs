/**
 * Cuts the demo video together from the recordings (record/), the cards (cards/), the promo's end
 * card and the narration, following the edit list in edit.mjs.
 *
 *   node video/demo/assemble.mjs              → video/out/demo/build-a-bot-demo.mp4 (1920×1080, 60 fps)
 *   node video/demo/assemble.mjs --sheet      also a contact sheet of every segment, to check the cut
 *   node video/demo/assemble.mjs --plan       where everything lands, and whether the sound fits, without rendering
 *   node video/demo/assemble.mjs --reuse --only build     render one segment again and keep the rest
 *   node video/demo/assemble.mjs --reuse --sound-only     only the sound again (after the music changes)
 *
 * Each segment's picture is drawn by compose.py (exact length, 60 fps, BT.709): a web recording in a
 * browser window on the stage, with the camera moving in on what matters (`screen`); a recording
 * filling the frame (`full`, the desktop app); the call's panel beside big captions (`call`); a card
 * from cards/cards.html (`card`). Segments join with hard cuts or short crossfades, and the sound is
 * mixed on one timeline: the narration, the call as it sounded, what the desktop app heard, and the
 * music under it all (ducked under every voice), to −14 LUFS for YouTube.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const OUT = path.join(ROOT, "video", "out", "demo");
const CLIPS = path.join(OUT, "clips");
// --edit picks another edit list; a NAME keeps its work and result apart.
const EDIT = (() => {
  const i = process.argv.indexOf("--edit");
  return i > 0 ? path.resolve(process.argv[i + 1]) : path.join(HERE, "edit.mjs");
})();
const { SEGMENTS, MUSIC, VO_DIR, VO_GAIN, CALL_MIX, NAME, SCORE, STAGE } = await import(pathToFileURL(EDIT).href);
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
const BT709 = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
const clipInfo = (name) => JSON.parse(fs.readFileSync(path.join(CLIPS, `${name}.json`), "utf8"));
const render = (args) => execFileSync("node", [path.join(HERE, "cards", "render.mjs"), ...args], { stdio: ["ignore", "ignore", "inherit"] });

/** A file's integrated loudness (LUFS) and true peak (dBTP). */
function loudness(file) {
  const out = execFileSync("sh", ["-c", `ffmpeg -hide_banner -nostats -i '${file}' -af ebur128=peak=true -f null - 2>&1`]).toString();
  const summary = out.slice(out.lastIndexOf("Summary:"));
  return { I: Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)[1]), TP: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)[1]) };
}

/** How long a piece of a recording plays for in the cut: whole frames, as compose.py draws it. */
const pieceLength = (p) => (p.freeze !== undefined ? Math.max(1, Math.round(p.dur * FPS)) : Math.max(1, Math.round(((p.to - p.from) * FPS) / (p.speed ?? 1)))) / FPS;

/** Maps a moment in a recording to a segment's time, through its pieces (frozen ones aside). */
function clipTimeline(pieces) {
  let acc = 0;
  const spans = pieces.map((p) => {
    const len = pieceLength(p);
    const s = { ...p, at: acc, len, rate: p.freeze !== undefined ? 0 : (p.to - p.from) / len };
    acc += len;
    return s;
  });
  return {
    duration: acc,
    spans,
    map(t) {
      for (const s of spans) if (s.freeze === undefined && t >= s.from && t <= s.to) return s.at + (t - s.from) / s.rate;
      const next = spans.find((s) => s.freeze === undefined && s.from > t);
      return next ? next.at : acc;
    },
  };
}

/** The call's time map: its ranges back to back. */
const callPieces = (ranges) => ranges.map(([from, to]) => ({ from, to }));

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
    return { card: "subtitle", opts: { who: sub.who, color: sub.color, text: sub.text, y: sub.y }, a, b, fadeIn: joinedPrev ? 0 : 0.2, fadeOut: !joinedNext && b < tl.duration - 0.01 ? 0.2 : 0 };
  });
  const notes = (seg.notes ?? []).map((n) => {
    const a = n.src !== undefined ? tl.map(n.src) : n.at ?? 0;
    const end = n.until !== undefined ? tl.map(n.until) : n.end;
    const b = end === undefined ? tl.duration : end < 0 ? tl.duration + end : end;
    return { card: n.card ?? "sidenote", opts: n.opts, a, b, fadeIn: 0.25, fadeOut: b < tl.duration - 0.01 ? 0.25 : 0 };
  });
  return [...subs, ...notes];
}

/** Overlay PNGs for compose.py, rendered once each. */
function overlayPngs(seg, items) {
  return items.map((o, k) => {
    const png = path.join(SEGS, `${seg.id}-overlay${k}.png`);
    render([o.card, JSON.stringify(o.opts), "--png", png]);
    return { png, a: Number(o.a.toFixed(4)), b: Number(o.b.toFixed(4)), fadeIn: o.fadeIn, fadeOut: o.fadeOut };
  });
}

/** The stage screen recordings sit on (the background and the browser window), drawn at 2×. */
const STAGE_WIN = STAGE?.win ?? { x: 128, y: 94, w: 1664, h: 936 };
let stagePng = null;
function stage() {
  if (!stagePng) {
    stagePng = path.join(SEGS, "stage.png");
    render(["stage", JSON.stringify({ win: STAGE_WIN, host: STAGE?.host ?? "build-a-bot.site" }), "--png", stagePng, "--scale", "2"]);
  }
  return stagePng;
}

/** compose.py's spec for one segment. */
function spec(seg, file) {
  if (seg.kind === "screen" || seg.kind === "full") {
    const src = seg.file ?? path.join(CLIPS, `${seg.src}.mp4`);
    const tl = clipTimeline(seg.pieces);
    const size = seg.file ? seg.size ?? [W, H] : clipInfo(seg.src).size;
    // Camera moves at moments in the recording (`src`) or the segment (`t`).
    const camera = (seg.camera ?? []).map((m) => ({ ...m, t: Number((m.src !== undefined ? tl.map(m.src) : m.t).toFixed(4)) }));
    return {
      kind: seg.kind,
      out: file,
      duration: tl.duration,
      src,
      srcSize: size,
      pieces: seg.pieces,
      ramp: seg.ramp ?? 0.35,
      camera,
      page: seg.page ?? [1280, 720],
      ...(seg.kind === "screen" ? { stage: stage(), win: STAGE_WIN } : {}),
      overlays: overlayPngs(seg, overlayItems(seg, tl)),
    };
  }
  if (seg.kind === "call") {
    const info = clipInfo("call");
    // The column around the panel, in the recording's pixels, and the window it shows through.
    const m = Math.round(30 * (info.scale ?? 2));
    const col = seg.column ?? { x: Math.max(0, info.panel.x - m), y: 0, w: Math.min(info.size[0], info.panel.width + 2 * m), h: info.size[1] };
    col.w -= col.w % 2;
    const holeH = 1000;
    const holeW = Math.round((col.w * holeH) / col.h / 2) * 2;
    const hole = { x: seg.holeX ?? 210, y: Math.round((H - holeH) / 2), w: holeW, h: holeH };
    const framePng = path.join(SEGS, `${seg.id}-callframe.png`);
    render(["callframe", JSON.stringify({ hole, title: seg.title ?? null, sub: seg.sub ?? null }), "--png", framePng]);
    const pieces = callPieces(seg.ranges);
    const tl = clipTimeline(pieces);
    // Captions: one PNG per line, from when it's said until the next one.
    const caps = (seg.lines ?? []).map((l) => ({ ...l, at: tl.map(l.src) }));
    const overlays = caps.map((c, i) => {
      const png = path.join(SEGS, `${seg.id}-cap${i}.png`);
      render(["caption", JSON.stringify({ who: c.who, text: c.text, cut: c.cut ?? false }), "--png", png]);
      const b = i + 1 < caps.length ? caps[i + 1].at : tl.duration;
      return { png, a: Math.max(0, c.at), b, fadeIn: 0.18, fadeOut: i + 1 < caps.length ? 0.12 : 0 };
    });
    return { kind: "call", out: file, duration: tl.duration, src: path.join(CLIPS, "call.mp4"), srcSize: info.size, pieces, col, hole, frame: framePng, overlays };
  }
  if (seg.kind === "card") {
    render([seg.card, String(seg.duration), JSON.stringify(seg.opts ?? {}), seg.id]);
    return { kind: "card", out: file, duration: seg.duration, file: path.join(CARDS, `${seg.id}.mp4`), overlays: [] };
  }
  throw new Error(`unknown segment kind ${seg.kind}`);
}

/** Runs compose.py on a spec; resolves when the segment is written. */
function compose(seg, file) {
  const specFile = path.join(SEGS, `${seg.id}.spec.json`);
  fs.writeFileSync(specFile, JSON.stringify(spec(seg, file), null, 1));
  return new Promise((resolve, reject) => {
    const p = spawn("python3", [path.join(HERE, "compose.py"), specFile], { stdio: ["ignore", "inherit", "inherit"] });
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`compose.py failed on ${seg.id}`))));
  });
}

/**
 * The call's sound with the two voices evened out: the recording keeps the bot's voice (Magpie, as
 * the page played it) and the caller's lines apart, so each gets its own level here.
 */
function callTrack() {
  if (!fs.existsSync(path.join(CLIPS, "call.wav"))) return null;
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

function segmentDuration(seg) {
  if (seg.kind === "screen" || seg.kind === "full") return clipTimeline(seg.pieces).duration;
  if (seg.kind === "call") return clipTimeline(callPieces(seg.ranges)).duration;
  return seg.duration;
}
const timelineOf = (seg) => (seg.kind === "call" ? clipTimeline(callPieces(seg.ranges)) : seg.pieces ? clipTimeline(seg.pieces) : null);

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
  const tl = timelineOf(p.seg);
  // A line at a time in the segment (`at`), or at a moment in its recording (`src`).
  for (const v of p.seg.vo ?? []) cues.push({ kind: "vo", file: path.join(VO, `${v.id}.wav`), at: p.start + (v.src !== undefined ? tl.map(v.src) : v.at), gain: (v.gain ?? 1) * (VO_GAIN ?? 1) });
  if (p.seg.kind === "call" && CALL_WAV) {
    for (const [k, s] of tl.spans.entries()) {
      const gain = p.seg.ranges[k][2] ?? p.seg.callGain ?? 1;
      if (gain > 0) cues.push({ kind: "call", file: CALL_WAV, at: p.start + s.at, from: s.from, to: s.to, gain });
    }
  }
  // Sound recorded with a take (what the desktop app heard), where each piece shows it.
  if (p.seg.audio) {
    for (const a of p.seg.audio) {
      const len = probeDur(a.file);
      for (const s of tl.spans) {
        if (s.freeze !== undefined) continue;
        const from = Math.max(s.from, a.at);
        const to = Math.min(s.to, a.at + len);
        if (to - from < 0.05) continue;
        const speed = s.rate;
        cues.push({ kind: "heard", file: a.file, at: p.start + s.at + (from - s.from) / speed, from: from - a.at, to: to - a.at, gain: s.gain ?? a.gain ?? 1, speed });
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
if (voTimes.at(-1) && voTimes.at(-1).b > total) clashes.push(`the last line runs past the end (${voTimes.at(-1).b.toFixed(2)} > ${total.toFixed(2)})`);
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

// 3. Each segment drawn on its own (missing ones, those named with --only, or all of them), a few at a time.
{
  const todo = placed.filter((p) => !fs.existsSync(p.file) || (only ? only.includes(p.seg.id) : !reuse));
  const started = Date.now();
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const p = todo[next++];
      const t0 = Date.now();
      await compose(p.seg, p.file);
      console.log(`${p.seg.id} (${p.dur.toFixed(2)} s) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, todo.length) }, worker));
  if (todo.length) console.log(`${todo.length} segments in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
console.log(`\ntimeline: ${placed.length} segments, ${total.toFixed(2)} s`);

// 4. The picture: hard cuts and crossfades.
const video = path.join(WORK, "demo-video.mp4");
// --sound-only keeps the picture from the last run (after changing only the music or the mix).
if (!(process.argv.includes("--sound-only") && fs.existsSync(video))) {
  const inputs = placed.flatMap((p) => ["-i", p.file]);
  // Every segment is 1920×1080 BT.709 at 60 fps already; the same clock for all.
  let graph = placed.map((_, i) => `[${i}:v]setsar=1,format=yuv420p,fps=${FPS},settb=1/${FPS * 256},setpts=PTS-STARTPTS[s${i}];`).join("");
  let last = "[s0]";
  let at = placed[0].dur;
  for (let i = 1; i < placed.length; i++) {
    const p = placed[i];
    const outLabel = `[x${i}]`;
    // Both joins keep the same clock, so the next crossfade accepts them.
    if (p.fade > 0) graph += `${last}[s${i}]xfade=transition=fade:duration=${p.fade}:offset=${(at - p.fade).toFixed(4)},settb=1/${FPS * 256}${outLabel};`;
    else graph += `${last}[s${i}]concat=n=2:v=1:a=0,settb=1/${FPS * 256}${outLabel};`;
    at = at - p.fade + p.dur;
    last = outLabel;
  }
  graph += `${last}format=yuv420p[v]`;
  ff([...inputs, "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-r", String(FPS), ...BT709, "-an", video]);
}

// 5. The sound: the cues mixed, the music under them.
const audio = path.join(WORK, "demo-mix.wav");
{
  const inputs = [];
  const parts = [];
  cues.forEach((c, i) => {
    inputs.push("-i", c.file);
    const trim = c.from !== undefined ? `atrim=start=${c.from}:end=${c.to},asetpts=PTS-STARTPTS,` : "";
    const tempo = c.speed && Math.abs(c.speed - 1) > 1e-3 ? `atempo=${c.speed},` : "";
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
