/**
 * Short clips of pages the narration points at (each its own take):
 *   credit     Credit & usage: "$1.00, about 2,400 messages on Nemotron 3.5 Lightning" (beat 3)
 *   download   the desktop app's download page (beat 6)
 *   voice      the Voice typing page, "you say / it types" (beat 8, until Diego's own recording)
 *   meetings   the Meetings tab, "Let Otto take notes in your calls" (beat 9, until Diego's own)
 * In a fresh guest account with its own Otto, deleted afterwards.
 *   node video/demo/record/pages.mjs [credit,download,voice,meetings]
 */
import { SITE, Take, actor, launch, sleep } from "./recorder.mjs";

const only = process.argv[2]?.split(",");
const { browser, context, page } = await launch();
const a = actor(page, 53);
let botId = null;

async function clip(name, url, act) {
  if (only && !only.includes(name)) return;
  await page.goto(`${SITE}${url}`, { waitUntil: "networkidle" });
  await sleep(800);
  const take = await new Take(page, name).start();
  await sleep(700);
  await act();
  await take.stop();
}

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
  botId = (await res.json()).id;

  await clip("credit", "/app/billing", async () => {
    await a.moveTo(330, 420, 700);
    await a.hover(page.getByText(/About 2,400 messages/).first(), { dy: -2 });
    await sleep(2600);
  });
  await clip("download", "/download", async () => {
    await a.hover(page.getByRole("link", { name: /Download for Mac/ }).first());
    await sleep(1500);
    await a.hover(page.getByRole("link", { name: /Download for Windows/ }).first());
    await sleep(1600);
  });
  await clip("voice", "/app/voice", async () => {
    await a.moveTo(900, 470, 900);
    await sleep(7000);
  });
  await clip("meetings", `/app/bots/${botId}/meetings`, async () => {
    await a.hover(page.getByText("It asks first, every time"));
    await sleep(1400);
    await a.hover(page.getByText(/Your call is heard on your computer/));
    await sleep(2200);
  });
} finally {
  if (botId) await context.request.delete(`${SITE}/api/bots/${botId}`, { headers: { origin: SITE } }).catch(() => {});
  await browser.close();
}
