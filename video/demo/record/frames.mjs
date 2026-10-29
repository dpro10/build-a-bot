/**
 * Records the real product frame by frame, for a perfectly even 60 frames a second. Chromium
 * (headless) draws a frame only when asked, on a clock of its own (virtual time) that moves exactly
 * 1/60 s per frame, and every frame is captured as it's drawn (2560×1440 for a 1280×720 page). So
 * each scroll, transition and cursor glide lands on its frame however long the computer takes to
 * draw it: nothing repeats or skips, and the page looks exactly as it does (blur and all).
 *
 * The page's clocks (timers, animations, Date) all follow virtual time; the network doesn't. A
 * frame takes about a tenth of a second to draw and capture, so replies from the server arrive
 * about six times sooner on screen than they did in real time: waits come out shorter.
 *
 * The cursor is drawn in the page (recorder.mjs's overlay) and moved here, frame by frame, with the
 * real mouse following it exactly, so hovers and clicks land where it is.
 *
 *   const studio = await Studio.launch({ storageState });
 *   const a = studio.actor(12);
 *   await studio.page.goto(url);
 *   const take = await studio.take("builder");    → clips/builder.mp4 (60 fps) and builder.json
 *   take.mark("brain"); await a.click(locator); await studio.sleep(800);
 *   await take.stop(); await studio.close();
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { CLIPS, OVERLAY, PROXY, ROOT, SCALE, VIEW } from "./recorder.mjs";

export const FPS = 60;
const IV = 1000 / FPS;

/** Headless Chromium drawing only on request, every stage of a frame done before it's shown. */
const ARGS = [
  "--deterministic-mode",
  "--enable-begin-frame-control",
  "--disable-new-content-rendering-timeout",
  "--run-all-compositor-stages-before-draw",
  "--disable-threaded-animation",
  "--disable-threaded-scrolling",
  "--disable-checker-imaging",
  "--disable-image-animation-resync",
  "--hide-scrollbars",
  "--force-color-profile=srgb",
  `--force-device-scale-factor=${SCALE}`,
  "--autoplay-policy=no-user-gesture-required",
];
// The same browser a visitor has, not "HeadlessChrome".
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
// Scrolls here are eased frame by frame; the page's own smooth scrolling would fight them.
const SMOOTH_OFF = `(() => {
  const s = document.createElement("style");
  s.textContent = "html { scroll-behavior: auto !important; }";
  const add = () => { if (!s.isConnected) (document.head || document.documentElement)?.appendChild(s); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
  addEventListener("load", add);
})();`;

/**
 * File uploads through XHR, as in browsers without request streams (Safari, Firefox): the Blob
 * client's streamed upload stalls when the page runs on virtual time. It checks for streams by
 * building a request with a ReadableStream body; one with a Content-Type header reads as "no".
 */
export const XHR_UPLOADS = `(() => {
  const Native = window.Request;
  window.Request = new Proxy(Native, {
    construct(target, args) {
      const req = Reflect.construct(target, args);
      const init = args[1];
      if (init && init.body instanceof ReadableStream && Object.getOwnPropertyDescriptor(init, "duplex")?.get) {
        try { req.headers.set("content-type", "text/plain"); } catch {}
      }
      return req;
    },
  });
})();`;

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Seeded randomness, so a re-record moves the same way. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export class Studio {
  /** A browser on virtual time, its page `view` big (1280×720) at 2×, frames already running. */
  static async launch({ storageState, view = VIEW, init = [] } = {}) {
    const browser = await chromium.launch({ headless: true, proxy: PROXY, args: [...ARGS, `--window-size=${view.width},${view.height}`] });
    const context = await browser.newContext({ viewport: null, storageState, locale: "en-US", timezoneId: "America/Chicago", colorScheme: "light", userAgent: UA });
    await context.addInitScript("window.__cursorNoStore = true;");
    await context.addInitScript(OVERLAY);
    await context.addInitScript(SMOOTH_OFF);
    for (const s of init) await context.addInitScript(s);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const studio = new Studio(browser, context, page, cdp, view);
    await studio.#start();
    const [w, h, dpr] = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
    if (w !== view.width || h !== view.height || dpr !== SCALE) {
      await studio.close();
      throw new Error(`The page came out ${w}×${h} at ${dpr}×, not ${view.width}×${view.height} at ${SCALE}×`);
    }
    return studio;
  }

  constructor(browser, context, page, cdp, view) {
    Object.assign(this, { browser, context, page, cdp, view });
    /** Virtual time (ms since launch) and frames drawn. */
    this.vt = 0;
    this.frame = 0;
    this.sleepers = [];
    this.cursor = { x: view.width / 2, y: view.height / 2, anim: null, sent: null };
    this.recording = null;
  }

  async #start() {
    const { virtualTimeTicksBase } = await this.cdp.send("Emulation.setVirtualTimePolicy", { policy: "pause" });
    this.base = virtualTimeTicksBase;
    this.pump = this.#loop();
  }

  /** Frames, one after another, until close(): the cursor moved, 1/60 s of virtual time, a frame drawn (and captured, in a take). */
  async #loop() {
    let failures = 0;
    while (!this.closed) {
      try {
        await this.#frame();
        failures = 0;
      } catch (e) {
        if (this.closed) break;
        if (++failures > 50) {
          this.failed = e;
          for (const s of this.sleepers.splice(0)) s.reject(e);
          throw e;
        }
        await new Promise((r) => setTimeout(r, 40));
      }
    }
  }

  async #frame() {
    const t = this.vt + IV;
    await this.#placeCursor(t);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.cdp.off("Emulation.virtualTimeBudgetExpired", done);
        reject(new Error("virtual time stopped"));
      }, 20000);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      this.cdp.once("Emulation.virtualTimeBudgetExpired", done);
      this.cdp.send("Emulation.setVirtualTimePolicy", { policy: "advance", budget: IV }).catch((e) => {
        clearTimeout(timer);
        this.cdp.off("Emulation.virtualTimeBudgetExpired", done);
        reject(e);
      });
    });
    this.vt = this.vt + (await this.#elapsed());
    const rec = this.recording && !this.recording.skipping ? this.recording : null;
    const r = await this.cdp.send("HeadlessExperimental.beginFrame", { frameTimeTicks: this.base + this.vt, interval: IV, screenshot: rec ? { format: "jpeg", quality: 100 } : undefined });
    this.frame++;
    if (rec) await rec.write(r.screenshotData);
    const due = this.sleepers.filter((s) => s.at <= this.vt + 0.01);
    this.sleepers = this.sleepers.filter((s) => s.at > this.vt + 0.01);
    for (const s of due) s.resolve();
  }

  /**
   * How far the page's clock moved this frame: 1/60 s, unless something in the page moved virtual
   * time on (storage writes do, 10 ms each). Frame times follow the page's clock, or animations
   * driven by frame times and timers would drift apart.
   */
  async #elapsed() {
    let doc, now;
    try {
      ({ value: [doc, now] = [] } = (await this.cdp.send("Runtime.evaluate", { expression: "[(window.__vtDoc ??= Math.random()), performance.now()]", returnByValue: true })).result);
    } catch {}
    const last = this.clock;
    this.clock = typeof now === "number" ? { doc, now } : null;
    if (!last || !this.clock || last.doc !== doc) return IV;
    const d = now - last.now;
    return d > 0 && d < 1000 ? d : IV;
  }

  /** Where the cursor is on frame time t (gliding, or still), drawn there, with the mouse there too. */
  async #placeCursor(t) {
    const c = this.cursor;
    if (c.anim) {
      const { from, to, t0, dur, arc } = c.anim;
      const k = Math.min(1, (t - t0) / dur);
      const e = ease(k);
      const bow = Math.sin(Math.PI * k) * arc;
      const dist = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      const nx = -(to.y - from.y) / dist;
      const ny = (to.x - from.x) / dist;
      c.x = from.x + (to.x - from.x) * e + nx * bow;
      c.y = from.y + (to.y - from.y) * e + ny * bow;
      if (k >= 1) c.anim = null;
    }
    // Drawn every frame (a page that's just loaded would start it in the middle).
    await this.cdp.send("Runtime.evaluate", { expression: `window.__cursor?.set(${c.x}, ${c.y})` }).catch(() => {});
    const key = `${c.x.toFixed(2)},${c.y.toFixed(2)}`;
    if (key === c.sent) return;
    c.sent = key;
    // Not awaited: the page takes moves in with the next frame.
    this.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: c.x, y: c.y, buttons: c.down ? 1 : 0 }).catch(() => {});
  }

  /** Waits ms of virtual time (a whole number of frames). */
  sleep(ms) {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => this.sleepers.push({ at: this.vt + Math.max(ms, 0), resolve, reject }));
  }

  /** Starts capturing frames into clips/<name>.mp4. */
  async take(name) {
    const t = new Take(this, name);
    await t.start();
    return t;
  }

  /** Scrolls the page (not an inner panel) to y, or as far as it goes, eased. */
  scrollTo(y, ms) {
    return this.page.evaluate(
      ([y, ms]) =>
        new Promise((done) => {
          const el = document.scrollingElement;
          const from = el.scrollTop;
          const to = Math.max(0, Math.min(y, el.scrollHeight - el.clientHeight));
          const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
          requestAnimationFrame((t0) => {
            const step = (now) => {
              const t = Math.min(1, (now - t0) / ms);
              el.scrollTop = from + (to - from) * ease(t);
              if (t < 1) requestAnimationFrame(step);
              else done();
            };
            step(t0);
          });
        }),
      [y, ms],
    );
  }

  /** Where something sits on the page (not the screen), for scrolling to it. */
  pageTop(locator) {
    return locator.evaluate((el) => Math.round(el.getBoundingClientRect().top + scrollY));
  }

  async close() {
    // A take still running (the script failed partway) is kept, for a look at what went wrong.
    if (this.recording) await this.recording.stop().catch(() => {});
    this.closed = true;
    await this.pump?.catch(() => {});
    await this.browser.close().catch(() => {});
  }

  /** A person at the mouse and keyboard, on the frames' clock. */
  actor(seed = 7) {
    const studio = this;
    const { page, cdp } = this;
    const rand = rng(seed);
    const c = this.cursor;

    async function moveTo(x, y, ms) {
      const dist = Math.hypot(x - c.x, y - c.y);
      if (dist < 0.5) return;
      const dur = ms ?? Math.min(900, 280 + dist * 0.6);
      const arc = Math.min(30, dist * 0.06) * (rand() < 0.5 ? -1 : 1);
      c.anim = { from: { x: c.x, y: c.y }, to: { x, y }, t0: studio.vt, dur, arc };
      await studio.sleep(dur + IV);
    }

    /**
     * A point on screen: {x, y}, or a locator's middle (dx, dy from it). A locator that's off screen,
     * or under something (a sticky header or bar), is scrolled to the middle of the page first, eased.
     */
    async function point(target, { dx = 0, dy = 0 } = {}) {
      if (typeof target.x === "number") return { x: target.x + dx, y: target.y + dy };
      const at = async () => {
        const b = await target.boundingBox();
        if (!b) throw new Error("not on screen");
        const p = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        const shown = p.y > 0 && p.y < studio.view.height && (await target.evaluate((el, [x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return !!hit && (hit === el || el.contains(hit));
        }, [p.x, p.y]));
        return { p, b, shown };
      };
      let { p, b, shown } = await at();
      if (!shown) {
        const y = await page.evaluate(() => scrollY);
        await studio.scrollTo(y + b.y + b.height / 2 - studio.view.height / 2, 700);
        ({ p } = await at());
      }
      return { x: p.x + dx, y: p.y + dy };
    }

    const button = async (type) => {
      c.down = type === "mousePressed";
      await cdp.send("Input.dispatchMouseEvent", { type, x: c.x, y: c.y, button: "left", buttons: c.down ? 1 : 0, clickCount: 1 });
    };

    return {
      get pos() {
        return { x: c.x, y: c.y };
      },
      moveTo,
      point,
      /** Put the cursor somewhere without a glide (before a take starts). */
      place(x, y) {
        c.anim = null;
        c.x = x;
        c.y = y;
        return studio.sleep(IV * 2);
      },
      async hover(target, opts = {}) {
        const p = await point(target, opts);
        await moveTo(p.x, p.y, opts.ms);
      },
      async click(target, { pause = 150, after = 220, ms, ...opts } = {}) {
        const p = await point(target, opts);
        await moveTo(p.x, p.y, ms);
        await studio.sleep(pause);
        await button("mousePressed");
        await studio.sleep(85);
        await button("mouseReleased");
        await studio.sleep(after);
      },
      /** Hovers a target only if it's on screen between top and bottom (no scrolling). */
      async glance(locator, { dx = 0, dy = 0, ms = 600, top = 70, bottom = 715 } = {}) {
        const b = await locator.boundingBox().catch(() => null);
        if (!b || b.y < top || b.y + b.height > bottom) return false;
        await moveTo(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, ms);
        return true;
      },
      /** Types like a person: 38–92 ms a key, a beat longer after spaces and punctuation. */
      async type(text, { min = 38, max = 92 } = {}) {
        for (const ch of text) {
          await page.keyboard.type(ch);
          await studio.sleep(min + rand() * (max - min) + (/[ ,.!?]/.test(ch) ? 45 : 0));
        }
      },
      async press(key, after = 120) {
        await page.keyboard.press(key);
        await studio.sleep(after);
      },
      /** Scrolls whatever scrolls under the cursor (the page or an inner panel) by dy, eased. */
      scroll(dy, ms = 700) {
        return page.evaluate(
          ([x, y, dy, ms]) =>
            new Promise((done) => {
              let el = document.elementFromPoint(x, y);
              const scrolls = (e) => {
                const o = getComputedStyle(e).overflowY;
                return (o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight + 1;
              };
              while (el && el !== document.body && !scrolls(el)) el = el.parentElement;
              if (!el || el === document.body) el = document.scrollingElement;
              const from = el.scrollTop;
              const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
              requestAnimationFrame((t0) => {
                const step = (now) => {
                  const t = Math.min(1, (now - t0) / ms);
                  el.scrollTop = from + dy * ease(t);
                  if (t < 1) requestAnimationFrame(step);
                  else done();
                };
                step(t0);
              });
            }),
          [c.x, c.y, dy, ms],
        );
      },
    };
  }
}

/** One recording: the frames from start() to stop(), with marks in seconds from its start. */
class Take {
  constructor(studio, name) {
    this.studio = studio;
    this.name = name;
    this.marks = [];
    this.frames = 0;
    this.cuts = [];
  }

  async start() {
    this.file = path.join(CLIPS, `${this.name}.mp4`);
    // The captures are JPEGs at full quality; kept as near-lossless H.264 (the edit scales them),
    // in Matroska while recording (readable even if the script dies), an MP4 once it stops.
    this.raw = path.join(CLIPS, `${this.name}.rec.mkv`);
    this.ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "10", "-pix_fmt", "yuv420p", "-color_range", "tv", this.raw], { stdio: ["pipe", "ignore", "inherit"] });
    this.closed = new Promise((r) => this.ff.on("close", r));
    const ff = this.ff;
    process.once("exit", () => ff.exitCode === null && ff.kill("SIGKILL"));
    this.studio.recording = this;
    this.startedAt = Date.now();
    return this;
  }

  async write(b64) {
    // A frame with nothing new to show comes back without a picture: the last one again.
    const buf = b64 ? Buffer.from(b64, "base64") : this.last;
    if (!buf) return;
    this.last = buf;
    this.frames++;
    if (!this.ff.stdin.write(buf)) await new Promise((r) => this.ff.stdin.once("drain", r));
  }

  /** Where the clip is now, in seconds (frames captured so far ÷ 60). */
  get t() {
    return this.frames / FPS;
  }

  /** A moment in the clip (the edit cuts on these). */
  mark(label) {
    this.marks.push({ label, t: Number(this.t.toFixed(3)), frame: this.frames });
    return this;
  }

  /** Anything else the edit should know (where a panel is on screen, …). */
  note(extra) {
    this.extra = { ...this.extra, ...extra };
    return this;
  }

  /**
   * Stops capturing while the page waits (frames still run, quicker without pictures) and picks up
   * again with resume(): the clip jumps there, and the marks say where.
   */
  skip(label = "skip") {
    this.skipping = true;
    this.skipFrom = { label, t: this.t, vt: this.studio.vt };
  }
  resume() {
    if (!this.skipping) return;
    this.skipping = false;
    this.cuts.push({ label: this.skipFrom.label, t: Number(this.skipFrom.t.toFixed(3)), skipped: Number(((this.studio.vt - this.skipFrom.vt) / 1000).toFixed(3)) });
  }

  async stop() {
    this.studio.recording = null;
    this.ff.stdin.end();
    await this.closed;
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", this.raw, "-c", "copy", "-movflags", "+faststart", this.file]);
    fs.rmSync(this.raw, { force: true });
    const v = this.studio.view;
    const info = { name: this.name, fps: FPS, frames: this.frames, duration: Number(this.t.toFixed(3)), size: [v.width * SCALE, v.height * SCALE], marks: this.marks, cuts: this.cuts, ...this.extra };
    fs.writeFileSync(path.join(CLIPS, `${this.name}.json`), JSON.stringify(info, null, 2));
    console.log(`${this.name}: ${info.duration.toFixed(1)} s, ${this.frames} frames in ${((Date.now() - this.startedAt) / 1000).toFixed(0)} s → ${path.relative(ROOT, this.file)}`);
    return info;
  }
}
