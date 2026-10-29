/**
 * Renders a card from cards.html frame by frame (each card is a pure function of time), straight
 * into ffmpeg: 1920×1080 at 60 fps, H.264 CRF 14.
 *   node video/demo/cards/render.mjs built 13.2
 *   node video/demo/cards/render.mjs todo 9 '{"title":"Voice typing","body":"…"}' todo-voice
 *   node video/demo/cards/render.mjs built --still 6        (one PNG, to check it)
 *   node video/demo/cards/render.mjs caption '{"who":"otto","text":"…"}' --png cap1.png   (transparent overlay)
 *   node video/demo/cards/render.mjs stage '{"win":{…}}' --png stage.png --scale 2      (at 3840×2160)
 * Needs the promo's exported assets first: npx tsx video/scripts/export-assets.tsx
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "..", "out", "demo", "cards");
fs.mkdirSync(OUT, { recursive: true });
// name, then in any order: a duration, {options}, an output name, --still t, --png file.
const argv = process.argv.slice(2);
const name = argv[0];
const flagged = new Set(["--still", "--png", "--scale"].flatMap((f) => (argv.includes(f) ? [argv.indexOf(f), argv.indexOf(f) + 1] : [])));
const rest = argv.slice(1).filter((a, i) => !flagged.has(i + 1));
const dur = rest.find((a) => /^\d+(\.\d+)?$/.test(a));
const opts = JSON.parse(rest.find((a) => a.startsWith("{")) ?? "{}");
const outName = rest.find((a) => a !== dur && !a.startsWith("{")) ?? name;
const still = process.argv.indexOf("--still");
const FPS = 60;
// --scale 2 draws at twice the size (3840×2160), for a picture the video zooms into.
const SCALE = argv.includes("--scale") ? Number(argv[argv.indexOf("--scale") + 1]) : 1;

// Installed Chrome cuts screenshots to its real window, so the window is sized to 1920×1080 itself.
let browser, page;
for (let top = 87, i = 0; ; i++) {
  browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text", "--hide-scrollbars", `--window-size=1920,${1080 + top}`, `--force-device-scale-factor=${SCALE}`] });
  page = await browser.newPage({ viewport: null });
  const h = await page.evaluate(() => innerHeight);
  if (h === 1080 || i > 2) break;
  top += 1080 - h;
  await browser.close();
}
page.on("pageerror", (e) => console.error("[card]", e.message));
await page.goto(pathToFileURL(path.join(HERE, "cards.html")).href);
// Fonts load when text first lays out (font-display: block hides it meanwhile): load them first.
await page.evaluate(async () => {
  await Promise.all(['700 84px "Bricolage Grotesque Variable"', '400 25px "Inter Variable"', '700 22px "Inter Variable"'].map((f) => document.fonts.load(f)));
  await document.fonts.ready;
});
const cdp = await page.context().newCDPSession(page);
const shot = async (t) => {
  await page.evaluate(([n, tt, o]) => window.CARD.render(n, tt, o), [name, t, opts]);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, captureBeyondViewport: false });
  return Buffer.from(data, "base64");
};

const png = process.argv.indexOf("--png");
if (png > 0) {
  // A transparent overlay (the call's frame, a caption): one frame, no background.
  const file = path.isAbsolute(process.argv[png + 1]) ? process.argv[png + 1] : path.join(OUT, process.argv[png + 1]);
  await page.addStyleTag({ content: "html, body { background: transparent !important; }" });
  await page.evaluate(([n, o]) => window.CARD.render(n, 10, o), [name, opts]);
  await page.screenshot({ path: file, omitBackground: true, type: "png" });
  console.log(file);
} else if (still > 0) {
  const t = Number(process.argv[still + 1]);
  const file = path.join(OUT, `${outName}-${t}.png`);
  fs.writeFileSync(file, await shot(t));
  console.log(file);
} else {
  const file = path.join(OUT, `${outName}.mp4`);
  const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
  const frames = Math.round(Number(dur) * FPS);
  for (let f = 0; f < frames; f++) {
    const buf = await shot(f / FPS);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  console.log(`${frames} frames → ${path.relative(path.join(HERE, "..", "..", ".."), file)}`);
}
await browser.close();
