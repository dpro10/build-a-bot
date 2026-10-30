/**
 * Files: the class files go to Juno (dragged onto the chat), Juno reads every page and makes
 * flashcards from them, each with the page it came from, and one gets studied right there. Recorded
 * frame by frame (frames.mjs); the wait while Juno reads and writes is all there, for the edit to
 * speed through.
 *
 * Juno from the builder (video/out/demo/session.json, or BAB_VIDEO_SESSION). The call scene asks
 * about the same files.
 *   node video/demo/record/files.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { PROPS, SITE, composer, loadSession } from "./recorder.mjs";
import { Studio, XHR_UPLOADS } from "./frames.mjs";

const FILES = [
  { name: "BIO 101 Syllabus - Fall 2026.pdf", type: "application/pdf" },
  { name: "Lecture 9 - Photosynthesis.pdf", type: "application/pdf" },
  { name: "Calvin cycle notes.jpg", type: "image/jpeg" },
];

/** A drag from the desktop: file cards that follow the cursor, then a real drop of the real files. */
const DRAG = `(() => {
  window.__drag = {
    show(names) {
      const g = document.createElement("div");
      g.id = "__video-drag";
      g.style.cssText = "position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;will-change:transform;";
      g.innerHTML = names.map((n, i) => {
        const pdf = /\\.pdf$/i.test(n);
        return '<div style="position:absolute;left:' + (14 + i * 7) + 'px;top:' + (12 + i * 7) + 'px;width:230px;display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:14px;background:#fff;box-shadow:0 10px 30px -8px rgba(30,20,60,.35),0 0 0 1px rgba(30,20,60,.08);transform:rotate(' + (i - 1) * 3 + 'deg);font:500 12.5px Inter,system-ui,sans-serif;color:#1b1830">' +
          '<span style="flex:none;width:30px;height:36px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font:700 9px Inter,system-ui;background:' + (pdf ? '#E5484D' : '#3E8EF7') + '">' + (pdf ? 'PDF' : 'JPG') + '</span>' +
          '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + n + '</span></div>';
      }).reverse().join("") + '<span style="position:absolute;left:226px;top:2px;min-width:24px;height:24px;border-radius:12px;background:#6d4dff;color:#fff;font:700 12px Inter,system-ui;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 10px rgba(109,77,255,.5)">' + names.length + '</span>';
      document.documentElement.appendChild(g);
      // The cards ride with the drawn cursor.
      let on = true;
      const follow = () => { if (!on) return; const p = window.__cursor.get(); g.style.transform = "translate(" + p.x + "px," + p.y + "px)"; requestAnimationFrame(follow); };
      follow();
      this.stop = () => { on = false; g.remove(); };
    },
    files(list) {
      const dt = new DataTransfer();
      for (const f of list) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
      return dt;
    },
    fire(type, x, y, dt) {
      const el = document.elementFromPoint(x, y);
      el?.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    },
  };
})();`;

const s = loadSession();
const studio = await Studio.launch({ storageState: s.storage, init: [DRAG, XHR_UPLOADS] });
const { page } = studio;
const a = studio.actor(31);
const wait = (ms) => studio.sleep(ms);

try {
  await page.goto(`${SITE}/app/bots/${s.botId}`, { waitUntil: "load" });
  await composer(page).waitFor({ timeout: 60000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  // A draft left by an earlier run starts the box empty again.
  await composer(page).fill("");
  await wait(1200);
  await a.place(40, 380);
  const take = await studio.take("files");
  await wait(800);

  // The drag: from the left edge, across the chat, and drop.
  const payload = FILES.map((f) => ({ ...f, b64: fs.readFileSync(path.join(PROPS, f.name)).toString("base64") }));
  await page.evaluate((names) => window.__drag.show(names), FILES.map((f) => f.name));
  await page.evaluate((list) => (window.__dt = window.__drag.files(list)), payload);
  take.mark("drag");
  await a.moveTo(520, 420, 700);
  await page.evaluate(() => window.__drag.fire("dragenter", 520, 420, window.__dt));
  for (const [x, y] of [[640, 430], [760, 440], [840, 435]]) {
    await a.moveTo(x, y, 240);
    await page.evaluate(([px, py]) => window.__drag.fire("dragover", px, py, window.__dt), [x, y]);
  }
  await wait(500);
  await page.evaluate(() => {
    window.__drag.fire("drop", 840, 435, window.__dt);
    window.__drag.stop();
  });
  take.mark("dropped");
  await wait(500);

  // Ask while they upload; sending waits until they're read.
  await a.click(composer(page), { pause: 180 });
  take.mark("typing");
  await a.type("Make me flashcards for my midterm.", { min: 32, max: 70 });
  await page.waitForFunction(() => ![...document.querySelectorAll('[aria-label="Attached files"] [role=status]')].some((s) => /Uploading|Reading|Getting ready/.test(s.textContent ?? "")), null, { timeout: 240000 });
  take.mark("files-ready");
  await wait(500);
  await a.press("Enter");
  take.mark("asked");
  const study = page.getByRole("button", { name: "Study", exact: true }).last();
  await study.waitFor({ timeout: 300000 });
  take.mark("cards-made");
  await wait(900);
  // Down to the card, and a look at where the cards came from.
  await a.moveTo(820, 470, 600);
  take.mark("sources");
  await wait(1200);

  // Study one: the question, then its answer and the page it came from.
  await a.click(study, { pause: 240 });
  await page.getByRole("button", { name: "Show answer" }).waitFor({ timeout: 30000 });
  take.mark("studying");
  await wait(1100);
  await a.click(page.getByRole("button", { name: "Show answer" }), { pause: 220 });
  take.mark("flipped");
  await wait(2400);
  await a.click(page.getByRole("button", { name: /Got it/ }), { pause: 240 });
  await wait(600);
  take.mark("studied");
  await a.press("Escape");
  await wait(800);
  await take.stop();
} finally {
  await studio.close();
}
