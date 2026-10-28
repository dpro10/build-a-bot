/**
 * Short clips of Juno's pages that the narration points at (each its own take):
 *   activity   Settings › Activity: the receipt card and the newest receipts (the meeting)
 *   notes      The notes Juno wrote from the call the desktop app heard: summary, action items with
 *              who owns each, decisions (record/desktop.mjs meeting first: video/out/demo/meeting.json)
 * Juno from the builder (video/out/demo/session.json).
 *   node video/demo/record/pages.mjs [activity,notes]
 */
import fs from "node:fs";
import path from "node:path";
import { OUT, SITE, Take, actor, launch, loadSession, sleep } from "./recorder.mjs";

const only = process.argv[2]?.split(",");
const s = loadSession();
const { browser, page } = await launch({ storageState: s.storage });
const a = actor(page, 53);

async function clip(name, url, act) {
  if (only && !only.includes(name)) return;
  await page.goto(`${SITE}${url}`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(1500);
  await a.place(1000, 560);
  const take = await new Take(page, name).start();
  try {
    await sleep(700);
    await act(take);
  } finally {
    await take.stop();
  }
}

try {
  // The receipt card, then the newest receipts: the meeting the desktop app just took notes in.
  // Stops before older takes' receipts (receipts can't be deleted).
  await clip("activity", `/app/bots/${s.botId}/settings?tab=activity`, async (take) => {
    await a.moveTo(640, 372, 900);
    take.mark("append-only");
    await sleep(1300);
    await a.moveTo(700, 470, 700);
    await a.scroll(200, 1600);
    take.mark("receipts");
    await sleep(2200);
  });
  const meeting = JSON.parse(fs.readFileSync(path.join(OUT, "meeting.json"), "utf8"));
  // Where the buddy's "Open" button lands: the notes, with the action items and who owns each.
  await clip("notes", `/app/bots/${s.botId}/meetings/${meeting.meetingId}`, async (take) => {
    take.mark("notes");
    await sleep(900);
    await a.moveTo(560, 400, 900);
    await sleep(900);
    await a.moveTo(955, 364, 900);
    take.mark("owners");
    await sleep(700);
    await a.moveTo(948, 451, 600);
    await sleep(700);
    await a.moveTo(955, 539, 600);
    await sleep(900);
    await a.moveTo(600, 560, 800);
    await a.scroll(190, 1100);
    take.mark("decisions");
    await sleep(2200);
  });
} finally {
  await browser.close();
}
