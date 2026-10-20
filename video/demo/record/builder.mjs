/**
 * Beat 3: building Otto. The landing page, then the builder start to finish with the ready-made
 * Tutor: a purple Otto, "Diego", the default brain (Nemotron 3.5 Lightning), the apps, Ask me
 * first, the ways to talk, and "Bring Otto to life" with its first message.
 *
 * Makes the guest account and bot every later scene uses (video/out/demo/session.json).
 *   node video/demo/record/builder.mjs
 */
import fs from "node:fs";
import { SESSION, SITE, Take, actor, deletePreviousBot, launch, sleep } from "./recorder.mjs";

await deletePreviousBot();
const { browser, context, page } = await launch();
const a = actor(page, 11);
const cont = () => page.getByRole("button", { name: /^Continue/ });

try {
  await page.goto(SITE, { waitUntil: "networkidle" });
  await page.mouse.move(980, 420);
  const take = await new Take(page, "builder").start();
  await sleep(1600);

  // The landing page, then "Build your bot".
  await a.click(page.locator("main").getByRole("link", { name: /Build your bot/ }).first(), { pause: 350 });
  await page.waitForURL(/\/build/);
  await page.waitForLoadState("networkidle");
  take.mark("builder");
  await sleep(1100);

  // Start from the ready-made Tutor.
  await a.click(page.getByRole("link", { name: /Tutor/ }).first(), { pause: 300 });
  await page.waitForURL(/recipe=tutor/);
  await page.waitForLoadState("networkidle");
  await sleep(900);
  take.mark("face");
  // Otto, in Grape.
  await a.hover(page.getByRole("radio", { name: /Otto the octopus/ }), { dy: -10 });
  await sleep(500);
  await a.click(page.getByRole("radio", { name: "Grape", exact: true }), { pause: 250 });
  await sleep(900);
  await a.click(cont(), { pause: 250 });

  // Name: "Otto" is filled in; what should it call you?
  take.mark("name");
  await sleep(700);
  await a.click(page.getByPlaceholder(/Your first name/), { pause: 200 });
  await a.type("Diego");
  await sleep(700);
  await a.click(cont(), { pause: 250 });

  // Brain: open models we run, Nemotron 3.5 Lightning by default.
  take.mark("brain");
  await sleep(900);
  await a.hover(page.getByRole("radio", { name: /Open models we run/ }).first());
  await sleep(700);
  await a.scroll(260, 650);
  await sleep(500);
  await a.hover(page.getByRole("radio", { name: /Nemotron 3.5 Lightning/ }).first());
  await sleep(1100);
  await a.click(cont(), { pause: 250 });

  // Apps: the tutor's are picked (web search, Wikipedia, notes); a look down the list of 190.
  take.mark("apps");
  await sleep(900);
  await a.moveTo(640, 520);
  await a.scroll(420, 900);
  await sleep(900);
  await a.scroll(-420, 700);
  await sleep(500);
  await a.click(cont(), { pause: 250 });

  // Trust: Ask me first.
  take.mark("trust");
  await sleep(800);
  await a.hover(page.getByRole("radio", { name: /Ask me first/ }).first());
  await sleep(1500);
  await a.click(cont(), { pause: 250 });

  // Talk: the ways to reach it (web and app always on; calls, texts, email, Telegram, Discord, Slack).
  take.mark("talk");
  await sleep(800);
  await a.hover(page.getByRole("button", { name: /Phone calls/ }).first());
  await sleep(1300);
  await a.click(cont(), { pause: 250 });

  // Review, 18+, and bring it to life.
  take.mark("review");
  await sleep(1000);
  await a.click(page.getByText("I'm 18 or older"), { pause: 250, dx: -60 });
  await sleep(500);
  await a.click(page.getByRole("button", { name: /Bring .* to life/ }), { pause: 300 });
  await page.waitForURL(/\/app\/bots\//, { timeout: 30000 });
  take.mark("born");
  // Its first message streams in; the starters show when it's done.
  await page.getByRole("button", { name: /Make flashcards from my notes/ }).waitFor({ timeout: 60000 });
  take.mark("greeted");
  await a.moveTo(1100, 640, 700);
  await sleep(2200);
  const botId = page.url().match(/bots\/([^/?#]+)/)[1];
  const storage = await context.storageState();
  fs.writeFileSync(SESSION, JSON.stringify({ site: SITE, botId, storage, at: new Date().toISOString() }, null, 2));
  console.log(`Otto is ${botId} (saved to ${SESSION})`);
  await take.stop();
} finally {
  await browser.close();
}
