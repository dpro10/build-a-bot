/**
 * Renders the promo's frames with headless Chromium: the stage draws frame t, we screenshot it.
 *   node video/scripts/render.mjs stills 4.5,12,30            -> video/out/stills/*.png
 *   node video/scripts/render.mjs events                       -> video/out/events.json (for the soundtrack)
 *   node video/scripts/render.mjs video [--fps 60] [--from 0] [--to 60] [--scale 1] [--workers 4] [--out file]
 * Video frames go straight into ffmpeg (lossless FFV1 per worker, then joined), no frame files on disk.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const V = path.join(root, "video");
const OUT = path.join(V, "out");
const TL = JSON.parse(fs.readFileSync(path.join(V, "timeline.json"), "utf8"));
const VO = JSON.parse(fs.readFileSync(path.join(V, "audio/vo/vo.json"), "utf8"));

function args() {
  const a = process.argv.slice(2);
  const o = { mode: a[0], list: a[1] };
  for (let i = 1; i < a.length; i++) if (a[i].startsWith("--")) o[a[i].slice(2)] = a[i + 1];
  return o;
}

async function open(scale = 1) {
  fs.mkdirSync(path.join(V, "stage/generated"), { recursive: true });
  fs.writeFileSync(path.join(V, "stage/generated/data.js"), `window.TL = ${JSON.stringify(TL)};\nwindow.VO = ${JSON.stringify(VO)};\n`);
  // PW_CHANNEL=chrome uses the installed Chrome when Playwright's own Chromium isn't there. Its
  // screenshots are cut to the real window, so the window itself is sized (no viewport emulation).
  const channel = process.env.PW_CHANNEL || undefined;
  const args = ["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text", "--hide-scrollbars"];
  let browser, page;
  for (let top = 87, i = 0; ; i++) {
    browser = await chromium.launch({ channel, args: channel ? [...args, `--window-size=${TL.width},${TL.height + top}`, `--force-device-scale-factor=${scale}`] : args });
    page = await browser.newPage(channel ? { viewport: null } : { viewport: { width: TL.width, height: TL.height }, deviceScaleFactor: scale });
    if (!channel) break;
    const h = await page.evaluate(() => innerHeight);
    if (h === TL.height || i > 2) break;
    top += TL.height - h;
    await browser.close();
  }
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && console.error("[stage]", m.text()));
  page.on("pageerror", (e) => console.error("[stage error]", e.message));
  await page.goto(pathToFileURL(path.join(V, "stage/index.html")).href);
  await page.evaluate(() => window.STAGE.init());
  // Lossless PNG, but Chromium's fast path (about 2.5x quicker than page.screenshot).
  const cdp = await page.context().newCDPSession(page);
  return { browser, page, cdp };
}

async function shot({ page, cdp }, t) {
  await page.evaluate((t) => window.STAGE.render(t), t);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, captureBeyondViewport: false });
  return Buffer.from(data, "base64");
}

async function stills(list, scale) {
  const s = await open(scale);
  fs.mkdirSync(path.join(OUT, "stills"), { recursive: true });
  for (const t of list.split(",").map(Number)) {
    const buf = await shot(s, t);
    fs.writeFileSync(path.join(OUT, "stills", `t${t.toFixed(2).padStart(6, "0")}.png`), buf);
    process.stdout.write(`${t} `);
  }
  console.log();
  await s.browser.close();
}

async function events() {
  const { browser, page } = await open();
  const ev = await page.evaluate(() => window.STAGE.events);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "events.json"), JSON.stringify(ev, null, 1));
  console.log(`${ev.length} events -> video/out/events.json`);
  await browser.close();
}

async function worker(frames, fps, file, scale) {
  const s = await open(scale);
  const w = Math.round(TL.width * scale), h = Math.round(TL.height * scale);
  const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-", "-s", `${w}x${h}`, "-c:v", "ffv1", "-level", "3", "-pix_fmt", "bgr0", file], { stdio: ["pipe", "inherit", "inherit"] });
  let n = 0;
  for (const f of frames) {
    const buf = await shot(s, f / fps);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (++n % 60 === 0) process.stdout.write(`.`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  await s.browser.close();
}

async function video(o) {
  const fps = Number(o.fps ?? TL.fps), from = Number(o.from ?? 0), to = Number(o.to ?? TL.duration);
  const scale = Number(o.scale ?? 1), workers = Number(o.workers ?? 4);
  const out = o.out ?? path.join(OUT, "frames.mkv");
  const all = [];
  for (let f = Math.round(from * fps); f < Math.round(to * fps); f++) all.push(f);
  fs.mkdirSync(path.join(OUT, "parts"), { recursive: true });
  const per = Math.ceil(all.length / workers);
  const parts = [];
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: workers }, (_, i) => {
      const frames = all.slice(i * per, (i + 1) * per);
      const file = path.join(OUT, "parts", `part${i}.mkv`);
      parts.push(file);
      return frames.length ? worker(frames, fps, file, scale) : Promise.resolve();
    }),
  );
  const list = path.join(OUT, "parts", "list.txt");
  fs.writeFileSync(list, parts.filter((p) => fs.existsSync(p)).map((p) => `file '${p}'`).join("\n"));
  await new Promise((r, j) => spawn("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out], { stdio: "inherit" }).on("close", (c) => (c ? j(new Error("concat")) : r())));
  console.log(`\n${all.length} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${out}`);
}

const o = args();
if (o.mode === "stills") await stills(o.list, Number(o.scale ?? 1));
else if (o.mode === "events") await events();
else if (o.mode === "video") await video(o);
else console.log("usage: render.mjs stills|events|video ...");
