/**
 * Beat 5 (and 6's Library tab): the class files go to Otto, Otto makes flashcards and a practice
 * quiz from them, and they're studied right there.
 *
 * Makes its own Otto (tutor, purple, calls you Diego) with an empty chat, and saves it for the call
 * scene (video/out/demo/session.json): the call asks about the same files.
 *   node video/demo/record/library.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { PROPS, SESSION, SITE, Take, actor, composer, deletePreviousBot, launch, sleep } from "./recorder.mjs";

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
      const move = (e) => { g.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)"; };
      addEventListener("mousemove", move, true);
      this.stop = () => { removeEventListener("mousemove", move, true); g.remove(); };
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

await deletePreviousBot();
const { browser, context, page } = await launch();
await context.addInitScript(DRAG);
const a = actor(page, 31);

try {
  const res = await context.request.post(`${SITE}/api/bots`, {
    headers: { origin: SITE },
    data: {
      avatar: "otto", color: "grape", name: "Otto", role: "tutor", jobs: ["school", "reminders"],
      brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: ["web_search", "wikipedia", "notes"], trust: "ask", channels: [], contact: {},
      ageConfirmed: true, timezone: "America/Chicago", ownerName: "Diego",
    },
  });
  if (!res.ok()) throw new Error(`create: ${res.status()} ${await res.text()}`);
  const botId = (await res.json()).id;
  fs.writeFileSync(SESSION, JSON.stringify({ site: SITE, botId, storage: await context.storageState(), at: new Date().toISOString() }, null, 2));
  console.log(`Otto is ${botId}`);

  await page.goto(`${SITE}/app/bots/${botId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Make flashcards from my notes/ }).waitFor({ timeout: 60000 });
  await page.mouse.move(40, 330);
  const take = await new Take(page, "library").start();
  await sleep(1000);

  // The drag: from the left edge, across the chat, and drop.
  const payload = FILES.map((f) => ({ ...f, b64: fs.readFileSync(path.join(PROPS, f.name)).toString("base64") }));
  await page.evaluate((names) => window.__drag.show(names), FILES.map((f) => f.name));
  await page.evaluate(() => (window.__dt = null));
  await page.evaluate((list) => (window.__dt = window.__drag.files(list)), payload);
  await a.moveTo(330, 360, 650);
  await page.evaluate(() => window.__drag.fire("dragenter", 330, 360, window.__dt));
  take.mark("drag");
  for (const [x, y] of [[420, 380], [520, 390], [610, 385]]) {
    await a.moveTo(x, y, 260);
    await page.evaluate(([px, py]) => window.__drag.fire("dragover", px, py, window.__dt), [x, y]);
  }
  await sleep(700);
  await page.evaluate(() => {
    window.__drag.fire("drop", 610, 385, window.__dt);
    window.__drag.stop();
  });
  take.mark("dropped");
  await sleep(600);

  // Ask while they upload; sending waits until they're read.
  await a.click(composer(page), { pause: 200 });
  await a.type("Make me flashcards from these for my midterm.");
  const busy = page.locator('[aria-label="Attached files"] [role=status]').filter({ hasText: /Uploading|Reading|Getting ready/ });
  await busy.first().waitFor({ state: "detached", timeout: 120000 }).catch(() => {});
  await page.waitForFunction(() => ![...document.querySelectorAll('[aria-label="Attached files"] [role=status]')].some((s) => /Uploading|Reading|Getting ready/.test(s.textContent ?? "")), null, { timeout: 120000 });
  take.mark("files-ready");
  await sleep(700);
  await page.keyboard.press("Enter");
  take.mark("asked-cards");
  const study = page.getByRole("button", { name: "Study", exact: true }).last();
  await study.waitFor({ timeout: 180000 });
  take.mark("cards-made");
  await sleep(2200);

  // Study three cards.
  await a.click(study, { pause: 300 });
  await page.getByRole("button", { name: "Show answer" }).waitFor({ timeout: 30000 });
  take.mark("studying");
  await sleep(1800);
  for (const verdict of ["Got it", "Again", "Got it"]) {
    await a.click(page.getByRole("button", { name: "Show answer" }), { pause: 250 });
    await sleep(2300);
    await a.click(page.getByRole("button", { name: new RegExp(verdict) }), { pause: 300 });
    await sleep(900);
  }
  take.mark("studied");
  await page.keyboard.press("Escape");
  await sleep(900);

  // A practice quiz.
  await a.click(composer(page), { pause: 200 });
  await a.type("Now give me a practice quiz on the Calvin cycle.");
  await sleep(400);
  await page.keyboard.press("Enter");
  take.mark("asked-quiz");
  const start = page.getByRole("button", { name: "Start", exact: true }).last();
  await start.waitFor({ timeout: 180000 });
  take.mark("quiz-made");
  await sleep(2000);
  const sets = (await (await context.request.get(`${SITE}/api/bots/${botId}/study-sets`)).json()).sets ?? [];
  const quizId = sets.filter((s) => s.kind === "quiz").sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))[0]?.id;
  const quiz = (await (await context.request.get(`${SITE}/api/bots/${botId}/study-sets/${quizId}`)).json()).set;
  console.log(`quiz: ${quiz.title}, ${quiz.questions.length} questions`);
  await a.click(start, { pause: 300 });
  take.mark("quiz");
  await sleep(1500);
  const dialog = page.getByRole("dialog");
  const norm = (s) => String(s).trim().toLowerCase();
  for (const [n, q] of quiz.questions.entries()) {
    await sleep(1400);
    // Get the second one wrong: the explanation and the score show both sides.
    const wrong = n === 1;
    if (q.type === "short_answer") {
      await a.click(dialog.getByLabel("Your answer"), { pause: 200 });
      await a.type(wrong ? "In the thylakoids" : String(q.answer).split(/[.;(]/)[0].slice(0, 60));
      await sleep(400);
      await a.click(dialog.getByRole("button", { name: "Check" }), { pause: 250 });
      await sleep(1500);
      await a.click(dialog.getByRole("button", { name: wrong ? /Not quite/ : /I got it/ }), { pause: 250 });
    } else {
      const choices = q.choices ?? [];
      const right = choices.find((c) => norm(c) === norm(q.answer)) ?? choices[0];
      const pickIt = wrong ? choices.find((c) => c !== right) ?? right : right;
      await a.click(dialog.locator("button", { has: page.getByText(pickIt, { exact: true }) }).first(), { pause: 300 });
    }
    await sleep(wrong ? 3200 : 1800);
    take.mark(`answered-${n + 1}`);
    await a.click(dialog.getByRole("button", { name: /^(Next|See my score)/ }), { pause: 250 });
  }
  take.mark("score");
  await sleep(3500);
  await page.keyboard.press("Escape");
  await sleep(800);

  // The Library tab: the files, read, and the study sets.
  await a.click(page.getByRole("link", { name: "Library", exact: true }), { pause: 300 });
  await page.waitForURL(/\/library/);
  await page.waitForLoadState("networkidle");
  take.mark("library-tab");
  await sleep(1500);
  await a.moveTo(760, 420, 800);
  await a.scroll(300, 900);
  await sleep(1500);
  await a.scroll(-300, 700);
  await sleep(1200);
  await take.stop();
} finally {
  fs.writeFileSync(SESSION, JSON.stringify({ ...JSON.parse(fs.readFileSync(SESSION, "utf8")), storage: await context.storageState() }, null, 2));
  await browser.close();
}
