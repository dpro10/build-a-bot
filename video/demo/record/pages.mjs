/**
 * Short clips of Juno's pages that the narration points at (each its own take), recorded frame by
 * frame (frames.mjs):
 *   notes      The notes Juno wrote from the call the desktop app heard: summary, action items with
 *              who owns each, decisions (record/desktop.mjs meeting first: video/out/demo/meeting.json)
 *   activity   Settings › Activity: the receipt card and the newest receipts (the meeting)
 * Juno from the builder (video/out/demo/session.json, or BAB_VIDEO_SESSION): the one the desktop
 * app was paired to.
 *   node video/demo/record/pages.mjs [notes,activity]
 */
import fs from "node:fs";
import path from "node:path";
import { OUT, SITE, loadSession } from "./recorder.mjs";
import { Studio } from "./frames.mjs";

const only = process.argv[2]?.split(",");
const s = loadSession();
const studio = await Studio.launch({ storageState: s.storage });
const { page } = studio;
const a = studio.actor(53);
const wait = (ms) => studio.sleep(ms);

async function clip(name, url, act) {
  if (only && !only.includes(name)) return;
  await page.goto(`${SITE}${url}`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await wait(1500);
  await a.place(1000, 560);
  const take = await studio.take(name);
  try {
    await wait(600);
    await act(take);
  } finally {
    await take.stop();
  }
}

try {
  const meeting = JSON.parse(fs.readFileSync(path.join(OUT, "meeting.json"), "utf8"));
  if (meeting.botId !== s.botId) throw new Error(`The meeting (${meeting.meetingId}) is ${meeting.botId}'s, not this session's bot (${s.botId}).`);
  // Where the buddy's "Open" button lands: the notes, with the action items and who owns each.
  await clip("notes", `/app/bots/${s.botId}/meetings/${meeting.meetingId}`, async (take) => {
    take.mark("notes");
    await wait(800);
    await a.moveTo(560, 400, 900);
    await wait(800);
    await a.moveTo(955, 364, 900);
    take.mark("owners");
    await wait(600);
    await a.moveTo(948, 451, 600);
    await wait(600);
    await a.moveTo(955, 539, 600);
    await wait(800);
    await a.moveTo(600, 560, 800);
    await a.scroll(190, 1100);
    take.mark("decisions");
    await wait(2000);
  });
  // The receipt card, then the newest receipts: the meeting the desktop app just took notes in.
  // Stops before older takes' receipts (receipts can't be deleted).
  await clip("activity", `/app/bots/${s.botId}/settings?tab=activity`, async (take) => {
    await a.moveTo(640, 372, 900);
    take.mark("append-only");
    await wait(1200);
    await a.moveTo(700, 470, 700);
    await a.scroll(200, 1600);
    take.mark("receipts");
    await wait(2000);
  });
} finally {
  await studio.close();
}
