/**
 * Beat 4: Ask me first. Otto writes the professor an email from its own address and waits for a
 * tap before sending; the card turns into "Approved and done".
 *
 * Its own Otto (the Email channel needs an owner address: diego@example.com, a reserved domain that
 * can't receive mail; on the demo site the send is simulated anyway). Deleted afterwards.
 *   node video/demo/record/chat.mjs
 */
import { SITE, Take, actor, launch, sleep } from "./recorder.mjs";

const { browser, context, page } = await launch();
const a = actor(page, 23);
let botId = null;

try {
  const res = await context.request.post(`${SITE}/api/bots`, {
    headers: { origin: SITE },
    data: {
      avatar: "otto", color: "grape", name: "Otto", role: "tutor", jobs: ["school", "reminders"],
      brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: ["web_search", "wikipedia", "notes", "bot_inbox"], trust: "ask", channels: ["email"],
      contact: { email: "diego@example.com" }, ageConfirmed: true, timezone: "America/Chicago", ownerName: "Diego",
    },
  });
  if (!res.ok()) throw new Error(`create: ${res.status()} ${await res.text()}`);
  botId = (await res.json()).id;
  await page.goto(`${SITE}/app/bots/${botId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Make flashcards from my notes/ }).waitFor({ timeout: 60000 });
  await page.mouse.move(700, 600);
  const take = await new Take(page, "chat").start();
  await sleep(1200);
  await a.click(page.getByPlaceholder(/Message Otto/), { pause: 200 });
  await a.type("Email Professor Okafor at mokafor@example.edu that I'll miss office hours Wednesday, and ask if Friday works.");
  await sleep(500);
  await page.keyboard.press("Enter");
  take.mark("sent");
  const approve = page.getByRole("button", { name: "Approve" }).last();
  await approve.waitFor({ timeout: 90000 });
  take.mark("approval");
  await sleep(2200);
  await a.hover(approve);
  await sleep(900);
  await a.click(approve, { pause: 300 });
  await page.getByText(/Approved and done|Approved/).last().waitFor({ timeout: 60000 });
  take.mark("approved");
  await sleep(1800);
  await take.stop();
} catch (err) {
  if (botId) {
    const m = await (await context.request.get(`${SITE}/api/bots/${botId}/messages`)).json().catch(() => ({ messages: [] }));
    for (const x of m.messages.slice(-3)) console.log(`${x.role}: ${x.text.slice(0, 300)}\n  ${JSON.stringify(x.parts).slice(0, 300)}`);
  }
  throw err;
} finally {
  if (botId) await context.request.delete(`${SITE}/api/bots/${botId}`, { headers: { origin: SITE } }).catch(() => {});
  await browser.close();
}
