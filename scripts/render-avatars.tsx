/**
 * Renders PNGs of every character × colorway (for Telegram/Slack/Discord bot
 * photos, emails and social cards) and the app icons, with headless Chromium.
 *   npx tsx scripts/render-avatars.tsx
 * Output: public/avatars/{avatar}-{color}.jpg (512×512, colorway tint, ready for
 * a circular crop) and public/{icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png.
 */
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { Avatar } from "../src/components/avatar/Avatar";
import { LogoMark } from "../src/components/brand/Logo";
import { AVATAR_IDS, COLORWAY_IDS, COLORWAYS } from "../src/lib/avatars";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.join(root, "public", "avatars");

function page(inner: string, size: number, background: string, radius = "0") {
  return `<!doctype html><html><body style="margin:0;background:transparent">
<div id="c" style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${background};border-radius:${radius};overflow:hidden">${inner}</div>
</body></html>`;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const tab = await ctx.newPage();

  const shoot = async (html: string, file: string) => {
    await tab.setContent(html);
    const jpeg = file.endsWith(".jpg");
    await tab.locator("#c").screenshot({ path: file, ...(jpeg ? { type: "jpeg" as const, quality: 88 } : {}) });
  };

  for (const avatar of AVATAR_IDS) {
    for (const color of COLORWAY_IDS) {
      const c = COLORWAYS[color];
      const svg = renderToStaticMarkup(createElement(Avatar, { avatar, color, size: 430, animated: false }));
      const bg = `radial-gradient(circle at 50% 38%, #ffffff 0%, ${c.tint} 58%, ${c.light}66 100%)`;
      await shoot(page(`<div style="margin-top:28px">${svg}</div>`, 512, bg), path.join(outDir, `${avatar}-${color}.jpg`));
    }
    process.stdout.write(`${avatar} `);
  }

  const logo = (size: number) => renderToStaticMarkup(createElement(LogoMark, { size }));
  const pub = path.join(root, "public");
  await shoot(page(logo(150), 192, "#ffffff", "0"), path.join(pub, "icon-192.png"));
  await shoot(page(logo(400), 512, "#ffffff", "0"), path.join(pub, "icon-512.png"));
  // Maskable: the mark inside the 80% safe zone on brand violet.
  await shoot(page(`<div style="background:#fbf9f6;border-radius:50%;width:330px;height:330px;display:flex;align-items:center;justify-content:center">${logo(250)}</div>`, 512, "#6d4dff"), path.join(pub, "icon-maskable-512.png"));
  await shoot(page(logo(140), 180, "#ffffff"), path.join(pub, "apple-touch-icon.png"));

  await browser.close();
  console.log("\nDone:", fs.readdirSync(outDir).length, "avatars + 4 icons");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
