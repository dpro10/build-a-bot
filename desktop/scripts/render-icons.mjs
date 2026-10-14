/**
 * Renders the tray icons and the app icon from SVG to PNG with Playwright's Chromium
 * (uses the web app's Playwright: /home/user/build-a-bot/node_modules, or a local one).
 *
 *   node scripts/render-icons.mjs
 *
 * Output (committed):
 *   assets/tray/<state>Template.png, @2x   macOS menu bar (black + alpha "template" images)
 *   assets/tray/<state>.png, @2x           Windows / Linux (colored)
 *   assets/icon.png (256), build/icon.png (1024), src/renderer/pairing/icon.png (128)
 *   assets/svg/*.svg                       the sources
 * States: watching, recording, paused, off.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const out = (...p) => path.join(ROOT, ...p);

const PURPLE = "#6A4AF5";
const GRAY = "#8A8796";
const RED = "#E5484D";
const DARK = "#3C3A48";

/** The bot's head on a 32×32 grid. `mode`: template (black, holes) or color. */
function trayGlyph(state, mode) {
  const template = mode === "template";
  const head = template ? "#000" : state === "off" ? GRAY : PURPLE;
  const face = template ? "#000" : "#fff";
  const sleeping = state === "off";
  const badge = state === "recording" || state === "paused";
  // Template images: the face and the badge's ring are cut out of the head (mask).
  const holes = `
    ${sleeping ? `<path d="M9 18h5M18 18h5" stroke="#000" stroke-width="2.2" stroke-linecap="round"/>` : `<circle cx="11.5" cy="17.5" r="2.7" fill="#000"/><circle cx="20.5" cy="17.5" r="2.7" fill="#000"/>`}
    <path d="M12.5 22.6 Q16 25.2 19.5 22.6" stroke="#000" stroke-width="1.9" stroke-linecap="round" fill="none"/>
    ${badge ? `<circle cx="25" cy="25" r="8" fill="#000"/>` : ""}`;
  const headShape = `
    <circle cx="16" cy="4.4" r="2.6"/>
    <rect x="14.9" y="5" width="2.2" height="5" rx="1.1"/>
    <rect x="3.5" y="9" width="25" height="19.5" rx="7.5"/>`;
  const pauseBars = (fill) => `<rect x="22.2" y="21.4" width="2.1" height="7.2" rx="0.8" fill="${fill}"/><rect x="25.7" y="21.4" width="2.1" height="7.2" rx="0.8" fill="${fill}"/>`;
  if (template) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
    <rect width="32" height="32" fill="#fff"/>${holes}
  </mask></defs>
  <g fill="${head}" mask="url(#m)">${headShape}</g>
  ${state === "recording" ? `<circle cx="25" cy="25" r="5.6" fill="#000"/>` : ""}
  ${state === "paused" ? `<defs><mask id="p" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32"><rect width="32" height="32" fill="#fff"/>${pauseBars("#000")}</mask></defs><circle cx="25" cy="25" r="5.9" fill="#000" mask="url(#p)"/>` : ""}
</svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <g fill="${head}">${headShape}</g>
  ${sleeping ? `<path d="M9 18h5M18 18h5" stroke="${face}" stroke-width="2.2" stroke-linecap="round"/>` : `<circle cx="11.5" cy="17.5" r="2.7" fill="${face}"/><circle cx="20.5" cy="17.5" r="2.7" fill="${face}"/>`}
  <path d="M12.5 22.6 Q16 25.2 19.5 22.6" stroke="${face}" stroke-width="1.9" stroke-linecap="round" fill="none"/>
  ${state === "recording" ? `<circle cx="25" cy="25" r="6.2" fill="${RED}" stroke="#fff" stroke-width="2"/>` : ""}
  ${state === "paused" ? `<circle cx="25" cy="25" r="6.2" fill="${DARK}" stroke="#fff" stroke-width="2"/>${pauseBars("#fff")}` : ""}
</svg>`;
}

function appIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8B6DFF"/><stop offset="1" stop-color="#4A2FD0"/></linearGradient>
    <linearGradient id="face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#EDE8FF"/></linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="208" fill="url(#bg)"/>
  <circle cx="512" cy="232" r="52" fill="#7CF5D3"/>
  <rect x="490" y="250" width="44" height="120" rx="22" fill="#FFFFFF"/>
  <rect x="212" y="340" width="600" height="460" rx="170" fill="url(#face)"/>
  <circle cx="396" cy="548" r="58" fill="#2A1B7A"/>
  <circle cx="628" cy="548" r="58" fill="#2A1B7A"/>
  <circle cx="414" cy="528" r="18" fill="#FFFFFF"/>
  <circle cx="646" cy="528" r="18" fill="#FFFFFF"/>
  <path d="M430 676 Q512 736 594 676" stroke="#2A1B7A" stroke-width="34" stroke-linecap="round" fill="none"/>
  <circle cx="312" cy="640" r="34" fill="#FFB3CF" opacity="0.8"/>
  <circle cx="712" cy="640" r="34" fill="#FFB3CF" opacity="0.8"/>
</svg>`;
}

async function render(page, svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
fs.mkdirSync(out("assets", "svg"), { recursive: true });
for (const state of ["watching", "recording", "paused", "off"]) {
  const tpl = trayGlyph(state, "template");
  const col = trayGlyph(state, "color");
  fs.writeFileSync(out("assets", "svg", `tray-${state}-template.svg`), tpl);
  fs.writeFileSync(out("assets", "svg", `tray-${state}.svg`), col);
  await render(page, tpl, 18, out("assets", "tray", `${state}Template.png`));
  await render(page, tpl, 36, out("assets", "tray", `${state}Template@2x.png`));
  await render(page, col, 16, out("assets", "tray", `${state}.png`));
  await render(page, col, 32, out("assets", "tray", `${state}@2x.png`));
}
fs.writeFileSync(out("assets", "svg", "icon.svg"), appIcon());
await render(page, appIcon(), 1024, out("build", "icon.png"));
await render(page, appIcon(), 256, out("assets", "icon.png"));
await render(page, appIcon(), 128, out("src", "renderer", "pairing", "icon.png"));
await browser.close();
console.log("icons written");
