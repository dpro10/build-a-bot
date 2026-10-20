/**
 * Records the real product for the demo video: Chrome's own screencast at 2× (2560×1440 for a
 * 1280×720 page), a visible cursor with click ripples, human-paced mouse moves and typing, and
 * markers ("waiting for the model") the edit uses to tighten long waits.
 *
 * With `mic: true`, the page also gets a microphone we can make talk (`say(wavPath)`), and a copy of
 * what the voice server sends back, so a real call is recorded with both voices (callAudio()).
 *
 * Output: video/out/demo/clips/<name>.mp4 (60 fps, H.264 CRF 15) and <name>.json (duration, marks).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, request } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(HERE, "..", "..", "..");
export const OUT = path.join(ROOT, "video", "out", "demo");
export const CLIPS = path.join(OUT, "clips");
export const PROPS = path.join(OUT, "props");
export const SITE = process.env.BAB_VIDEO_SITE ?? "https://build-a-bot.site";
export const VIEW = { width: 1280, height: 720 };
export const SCALE = 2;
fs.mkdirSync(CLIPS, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The cursor, and what's hidden while recording: the demo-mode strip and "Save your account"
 * (a guest account's nudge; real owners sign in and never see it).
 */
const OVERLAY = `(() => {
  if (window.top !== window) return;
  const KEY = "__videoCursor";
  let pos = { x: ${VIEW.width / 2}, y: ${VIEW.height / 2} };
  try { pos = JSON.parse(sessionStorage.getItem(KEY)) || pos; } catch {}
  const host = document.createElement("div");
  host.setAttribute("data-video-overlay", "");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = \`<style>
    .c{position:fixed;left:0;top:0;width:30px;height:30px;will-change:transform}
    .c svg{display:block;filter:drop-shadow(0 2px 3px rgba(20,16,40,.32));transform-origin:5px 4px;transition:transform .12s ease}
    .c.down svg{transform:scale(.84)}
    .r{position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:3px solid rgba(109,77,255,.6);background:rgba(109,77,255,.14);animation:r .55s ease-out forwards}
    @keyframes r{from{transform:scale(.25);opacity:1}to{transform:scale(1.3);opacity:0}}
  </style><div class="c"><svg width="30" height="30" viewBox="0 0 30 30"><path d="M5 3.5 L5 23.5 L10.2 18.6 L13.9 26.6 L17.6 25 L13.9 17.1 L21 17.1 Z" fill="#14121f" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg></div>\`;
  const cur = root.querySelector(".c");
  const place = () => { cur.style.transform = "translate(" + (pos.x - 5) + "px," + (pos.y - 4) + "px)"; };
  place();
  addEventListener("mousemove", (e) => { pos = { x: e.clientX, y: e.clientY }; place(); try { sessionStorage.setItem(KEY, JSON.stringify(pos)); } catch {} }, true);
  addEventListener("mousedown", (e) => {
    cur.classList.add("down");
    const r = document.createElement("div"); r.className = "r"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px";
    root.appendChild(r); setTimeout(() => r.remove(), 650);
  }, true);
  addEventListener("mouseup", () => cur.classList.remove("down"), true);
  const hide = document.createElement("style");
  hide.textContent = 'main > .bg-warning-soft, a[href="/login?next=/app"], a[href^="/login?next=/app/bots/"], div:has(> div > span + a[href^="/login?next=/app/bots/"]:last-child), nextjs-portal { display: none !important; }';
  const mount = () => {
    if (!document.documentElement) return;
    if (!host.isConnected) document.documentElement.appendChild(host);
    if (!hide.isConnected) (document.head || document.documentElement).appendChild(hide);
  };
  // After hydration (React owns <html> and <body> in the app router), and again if anything removes it.
  addEventListener("load", () => { mount(); new MutationObserver(mount).observe(document.documentElement, { childList: true }); });
  if (document.readyState === "complete") mount();
})();`;

/** A microphone that says what we tell it, and a copy of everything the voice server sends. */
const MIC = `(() => {
  const log = (window.__callLog = { audio: [], events: [], said: [] });
  const NativeWS = window.WebSocket;
  window.WebSocket = class extends NativeWS {
    constructor(...a) {
      super(...a);
      this.addEventListener("message", (m) => {
        const t = performance.timeOrigin + performance.now();
        if (typeof m.data === "string") log.events.push({ t, data: m.data });
        else {
          const u = new Uint8Array(m.data); let s = "";
          for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
          log.audio.push({ t, b64: btoa(s) });
        }
      });
    }
  };
  let ctx, dest;
  navigator.mediaDevices.getUserMedia = async () => {
    ctx = new AudioContext({ sampleRate: 48000 });
    dest = ctx.createMediaStreamDestination();
    const noise = ctx.createBuffer(1, 48000, 48000); const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.0008;
    const n = ctx.createBufferSource(); n.buffer = noise; n.loop = true; n.connect(dest); n.start();
    return dest.stream;
  };
  window.__say = async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const buf = await ctx.decodeAudioData(bytes.buffer);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(dest);
    log.said.push({ t: performance.timeOrigin + performance.now(), dur: buf.duration });
    src.start();
    return buf.duration;
  };
})();`;

/**
 * Chrome's screencast captures the real window, not Playwright's emulated viewport, so the window
 * itself is sized to 1280×720 at 2× (headless Chrome keeps an invisible toolbar's height on top).
 */
let chromeTop = 87;
export async function launch({ mic = false, storageState, view = VIEW } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const browser = await chromium.launch({
      channel: "chrome",
      args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars", `--window-size=${view.width},${view.height + chromeTop}`, `--force-device-scale-factor=${SCALE}`],
    });
    const context = await browser.newContext({ viewport: null, colorScheme: "light", storageState, locale: "en-US", timezoneId: "America/Chicago" });
    await context.addInitScript(OVERLAY);
    if (mic) await context.addInitScript(MIC);
    const page = await context.newPage();
    await page.goto("about:blank");
    const [w, h, dpr] = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
    if (w === view.width && h === view.height && dpr === SCALE) {
      page.__view = view;
      return { browser, context, page };
    }
    chromeTop += view.height - h;
    await browser.close();
  }
  throw new Error("Couldn't size the browser window to 1280×720");
}

/** One recording: start(), mark("…"), stop() → the MP4 and its markers. */
export class Take {
  constructor(page, name) {
    this.page = page;
    this.name = name;
    this.marks = [];
  }

  async start() {
    this.dir = path.join(CLIPS, `${this.name}.frames`);
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    this.frames = [];
    this.pending = [];
    this.client = await this.page.context().newCDPSession(this.page);
    this.stopped = false;
    this.client.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      if (this.stopped) return;
      this.client.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      const file = path.join(this.dir, `${String(this.frames.length).padStart(6, "0")}.jpg`);
      this.frames.push({ t: metadata.timestamp ?? Date.now() / 1000, file });
      this.pending.push(fs.promises.writeFile(file, Buffer.from(data, "base64")));
    });
    this.view = this.page.__view ?? VIEW;
    await this.client.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: this.view.width * SCALE, maxHeight: this.view.height * SCALE, everyNthFrame: 1 });
    this.startedAt = Date.now() / 1000;
    // Make sure there's a first frame even on a still page.
    await this.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
    return this;
  }

  /** Anything else the edit should know (where a panel is on screen, …). */
  note(extra) {
    this.extra = { ...this.extra, ...extra };
    return this;
  }

  /** A moment in the clip, in seconds from its start (the edit cuts on these). */
  mark(label) {
    this.marks.push({ label, t: Date.now() / 1000 });
    return this;
  }

  async stop() {
    const end = Date.now() / 1000;
    this.stopped = true;
    await this.client.send("Page.stopScreencast").catch(() => {});
    await Promise.all(this.pending);
    if (!this.frames.length) throw new Error(`${this.name}: no frames`);
    const t0 = this.frames[0].t;
    const list = this.frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.001, (this.frames[i + 1]?.t ?? end) - f.t).toFixed(4)}`);
    list.push(`file '${this.frames.at(-1).file}'`);
    const listFile = path.join(this.dir, "list.txt");
    fs.writeFileSync(listFile, list.join("\n") + "\n");
    const mp4 = path.join(CLIPS, `${this.name}.mp4`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", "fps=60,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-movflags", "+faststart", mp4]);
    const info = { name: this.name, t0, duration: end - t0, size: [this.view.width * SCALE, this.view.height * SCALE], frames: this.frames.length, marks: this.marks.map((m) => ({ label: m.label, t: Number((m.t - t0).toFixed(3)) })), ...this.extra };
    fs.writeFileSync(path.join(CLIPS, `${this.name}.json`), JSON.stringify(info, null, 2));
    fs.rmSync(this.dir, { recursive: true, force: true });
    console.log(`${this.name}: ${info.duration.toFixed(1)} s, ${info.frames} frames (${(info.frames / info.duration).toFixed(1)} fps) → ${path.relative(ROOT, mp4)}`);
    return info;
  }
}

/** Seeded randomness, so a re-record moves the same way. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** A person at the mouse and keyboard. */
export function actor(page, seed = 7) {
  const rand = rng(seed);
  let pos = { x: VIEW.width / 2, y: VIEW.height / 2 };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  async function moveTo(x, y, ms) {
    const dist = Math.hypot(x - pos.x, y - pos.y);
    if (dist < 1) return;
    const dur = ms ?? Math.min(950, 260 + dist * 0.65);
    const steps = Math.max(8, Math.round(dur / 16));
    const nx = -(y - pos.y) / dist;
    const ny = (x - pos.x) / dist;
    const arc = Math.min(36, dist * 0.07) * (rand() < 0.5 ? -1 : 1);
    const from = { ...pos };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = ease(t);
      const bow = Math.sin(Math.PI * t) * arc;
      await page.mouse.move(from.x + (x - from.x) * e + nx * bow, from.y + (y - from.y) * e + ny * bow);
      await sleep(dur / steps);
    }
    pos = { x, y };
  }

  async function point(target, { dx = 0, dy = 0 } = {}) {
    if (typeof target.x === "number") return { x: target.x + dx, y: target.y + dy };
    await target.scrollIntoViewIfNeeded().catch(() => {});
    const b = await target.boundingBox();
    if (!b) throw new Error("not on screen");
    return { x: b.x + b.width / 2 + dx, y: b.y + b.height / 2 + dy };
  }

  return {
    get pos() {
      return pos;
    },
    sleep,
    moveTo,
    async hover(target, opts) {
      const p = await point(target, opts);
      await moveTo(p.x, p.y);
    },
    async click(target, { pause = 150, after = 220, ...opts } = {}) {
      const p = await point(target, opts);
      await moveTo(p.x, p.y);
      await sleep(pause);
      await page.mouse.down();
      await sleep(80);
      await page.mouse.up();
      await sleep(after);
    },
    /** Types like a person: 35–90 ms a key, a beat longer after spaces and punctuation. */
    async type(text, { min = 38, max = 92 } = {}) {
      for (const ch of text) {
        await page.keyboard.type(ch);
        await sleep(min + rand() * (max - min) + (/[ ,.!?]/.test(ch) ? 45 : 0));
      }
    },
    /** A smooth scroll of the element under the cursor. */
    async scroll(dy, ms = 700) {
      const steps = Math.max(10, Math.round(ms / 16));
      let done = 0;
      for (let i = 1; i <= steps; i++) {
        const target = Math.round(dy * ease(i / steps));
        await page.mouse.wheel(0, target - done);
        done = target;
        await sleep(ms / steps);
      }
    },
  };
}

/** The call's audio, rebuilt exactly as the page played it: the bot's voice and the caller's lines. */
export async function callAudio(page, take, sayFiles) {
  const log = await page.evaluate(() => window.__callLog);
  const ready = log.events.map((e) => ({ ...e, j: JSON.parse(e.data) })).find((e) => e.j.type === "ready");
  const rate = ready?.j.outputRate ?? 22050;
  const t0 = take.frames[0].t * 1000;
  const lastAudio = log.audio.at(-1)?.t ?? t0;
  const total = Math.ceil(((Math.max(lastAudio, Date.now()) - t0) / 1000 + 10) * rate);
  const bot = new Float32Array(total);
  // Play each piece back to back, as useVoiceCall does: at max(next, arrival + 60 ms); "clear" cuts.
  let next = 0;
  const cuts = log.events.map((e) => ({ t: e.t, j: JSON.parse(e.data) })).filter((e) => e.j.type === "clear" || e.j.type === "interrupted");
  const pieces = log.audio.map((a) => ({ t: a.t, pcm: new Int16Array(Uint8Array.from(Buffer.from(a.b64, "base64")).buffer) }));
  const timeline = [...pieces.map((p) => ({ kind: "pcm", ...p })), ...cuts.map((c) => ({ kind: "cut", t: c.t }))].sort((a, b) => a.t - b.t);
  const placed = [];
  for (const ev of timeline) {
    const at = (ev.t - t0) / 1000;
    if (ev.kind === "cut") {
      // Everything scheduled after this moment never played.
      for (const p of placed) if (p.end > at) p.end = Math.max(p.start, at);
      next = at;
      continue;
    }
    const start = Math.max(next, at + 0.06);
    const dur = ev.pcm.length / rate;
    placed.push({ start, end: start + dur, pcm: ev.pcm });
    next = start + dur;
  }
  for (const p of placed) {
    const s = Math.round(p.start * rate);
    const n = Math.min(p.pcm.length, Math.round((p.end - p.start) * rate));
    for (let i = 0; i < n && s + i < total; i++) bot[s + i] = p.pcm[i] / 32768;
  }
  const botWav = path.join(CLIPS, `${take.name}.bot.wav`);
  writeWav(botWav, bot, rate);
  // The caller's lines at the moments they were said.
  const said = log.said.map((s, i) => ({ at: (s.t - t0) / 1000, file: sayFiles[i] })).filter((s) => s.file);
  const inputs = said.flatMap((s) => ["-i", s.file]);
  const delays = said.map((s, i) => `[${i + 1}:a]aresample=48000,adelay=${Math.round(s.at * 1000)}:all=1[c${i}]`);
  const mixIn = ["[0:a]aresample=48000[b]", ...delays].join(";");
  const labels = ["[b]", ...said.map((_, i) => `[c${i}]`)].join("");
  const wav = path.join(CLIPS, `${take.name}.wav`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", botWav, ...inputs, "-filter_complex", `${mixIn};${labels}amix=inputs=${said.length + 1}:normalize=0[out]`, "-map", "[out]", "-ac", "1", wav]);
  console.log(`${take.name}: call audio → ${path.relative(ROOT, wav)} (bot ${placed.length} pieces, caller ${said.length} lines)`);
  return wav;
}

function writeWav(file, samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, buf);
}

/** The bot, the guest account it belongs to, and its cookies, shared by the scenes. */
export const SESSION = path.join(OUT, "session.json");
export function loadSession() {
  if (!fs.existsSync(SESSION)) throw new Error("Record the builder first (node video/demo/record/builder.mjs): it makes Otto.");
  return JSON.parse(fs.readFileSync(SESSION, "utf8"));
}

/** Delete the Otto an earlier run of these scripts made (its guest account's cookies are in the session file). */
export async function deletePreviousBot() {
  if (!fs.existsSync(SESSION)) return;
  const old = JSON.parse(fs.readFileSync(SESSION, "utf8"));
  if (!old.botId || old.site !== SITE) return;
  const ctx = await request.newContext({ baseURL: SITE, storageState: old.storage, extraHTTPHeaders: { origin: SITE } });
  const res = await ctx.delete(`/api/bots/${old.botId}`).catch(() => null);
  console.log(`deleted the last run's Otto (${old.botId}): ${res?.status() ?? "unreachable"}`);
  await ctx.dispose();
  fs.rmSync(SESSION, { force: true });
}

/** The chat's message box (its placeholder changes once files are attached). */
export const composer = (page) => page.locator("main textarea").last();

