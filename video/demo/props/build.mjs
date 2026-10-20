/**
 * The class files Otto studies from in the demo video (original content, made up for it):
 * a syllabus and a lecture deck as PDFs, and a photo of handwritten notes.
 *
 *   node video/demo/props/build.mjs   → video/out/demo/props/
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "..", "out", "demo", "props");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();

await page.goto(`file://${path.join(HERE, "syllabus.html")}`);
await page.pdf({ path: path.join(OUT, "BIO 101 Syllabus - Fall 2026.pdf"), format: "Letter", printBackground: true, preferCSSPageSize: true });

await page.goto(`file://${path.join(HERE, "slides.html")}`);
await page.pdf({ path: path.join(OUT, "Lecture 9 - Photosynthesis.pdf"), printBackground: true, preferCSSPageSize: true });

const photo = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1.6 });
await photo.goto(`file://${path.join(HERE, "notes.html")}`);
await photo.evaluate(() => document.fonts.ready);
await photo.screenshot({ path: path.join(OUT, "Calvin cycle notes.jpg"), type: "jpeg", quality: 86 });

await browser.close();
for (const f of fs.readdirSync(OUT)) console.log(`${f}  ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0)} KB`);
