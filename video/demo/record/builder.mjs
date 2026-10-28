/**
 * Building Juno, start to finish, signed in (record/signin.mjs first): a look at the ready-made
 * bots, then a custom one: Nimbus in Grape, "Juno", what to call you ("Diego"), the brain (Nemotron
 * 3.5 Lightning on Nebius Token Factory), what it helps with (school, meetings, research), Ask me
 * first, the ways to talk, and "Bring Juno to life" with its first message.
 *
 * Juno is the bot every later scene uses (video/out/demo/session.json); an earlier run's Juno is
 * deleted first.
 *   node video/demo/record/builder.mjs
 */
import fs from "node:fs";
import { SESSION, SITE, Take, actor, deletePreviousBot, launch, loadAccount, sleep } from "./recorder.mjs";

const account = loadAccount();
await deletePreviousBot();
const { browser, context, page } = await launch({ storageState: account.storage });
const a = actor(page, 11);
const cont = () => page.getByRole("button", { name: /^Continue/ });

try {
  await page.goto(`${SITE}/build`, { waitUntil: "networkidle" });
  await a.place(980, 300);
  const take = await new Take(page, "builder").start();
  await sleep(1000);

  // The ready-made bots, a look along the row.
  take.mark("recipes");
  for (const name of ["Tutor", "Job applier", "Language partner", "Fitness coach"]) {
    await a.hover(page.getByRole("link", { name: new RegExp(name) }).first());
    await sleep(380);
  }
  await a.hover(page.getByRole("link", { name: /More ideas/ }).first());
  await sleep(700);

  // A face of its own: Nimbus, in Grape.
  take.mark("face");
  await a.click(page.getByRole("radio", { name: /Nimbus the cloud/ }), { pause: 250 });
  await sleep(700);
  await a.moveTo(450, 560, 500);
  await a.scroll(230, 600);
  await sleep(300);
  await a.click(page.getByRole("radio", { name: "Grape", exact: true }), { pause: 250 });
  await sleep(900);
  await a.click(cont(), { pause: 250 });

  // Name: Juno, and what it should call you.
  take.mark("name");
  await sleep(600);
  await a.click(page.getByPlaceholder(/e\.g\. /).first(), { pause: 200 });
  await a.type("Juno");
  await sleep(450);
  await a.click(page.getByPlaceholder(/Your first name/), { pause: 200 });
  await a.type("Diego");
  await sleep(700);
  await a.click(cont(), { pause: 250 });

  // Brain: open models on Nebius, Nemotron 3.5 Lightning by default.
  take.mark("brain");
  await sleep(800);
  await a.hover(page.getByRole("radio", { name: /Open models on Nebius/ }).first());
  await sleep(900);
  await a.hover(page.getByText(/Served from Nebius Token Factory/).first(), { dx: -120 });
  await sleep(1100);
  await a.hover(page.getByRole("radio", { name: /Nemotron 3\.5 Lightning/ }).first());
  await sleep(1300);
  await a.click(cont(), { pause: 250 });

  // What it helps with: school, meetings, research (each turns on the tools that fit).
  take.mark("apps");
  await sleep(700);
  for (const chip of ["School", "Meetings", "Research"]) {
    await a.click(page.getByRole("button", { name: new RegExp(`^\\S*\\s*${chip}$`) }).first(), { pause: 200, after: 380 });
  }
  await sleep(900);
  await a.click(cont(), { pause: 250 });

  // Trust: Ask me first, and what's enforced in code at every level.
  take.mark("trust");
  await sleep(700);
  await a.hover(page.getByRole("radio", { name: /Ask me first/ }).first());
  await sleep(1300);
  await a.hover(page.getByText(/enforced in code/).first());
  await sleep(1300);
  await a.click(cont(), { pause: 250 });

  // Talk: the web app is always on; calls too.
  take.mark("talk");
  await sleep(700);
  await a.hover(page.getByText("Phone calls", { exact: true }).first());
  await sleep(1300);
  await a.click(cont(), { pause: 250 });

  // Review, 18+, and bring it to life.
  take.mark("review");
  await sleep(1100);
  const age = page.getByText("I'm 18 or older");
  await age.scrollIntoViewIfNeeded();
  await sleep(300);
  await a.click(age, { pause: 250, dx: -70 });
  await sleep(450);
  await a.click(page.getByRole("button", { name: /Bring .* to life/ }), { pause: 300 });
  await page.waitForURL(/\/app\/bots\//, { timeout: 30000 });
  take.mark("born");
  // Its first message streams in.
  await page.locator("main").getByText(/Juno/).first().waitFor({ timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 60000 }).catch(() => {});
  await sleep(2500);
  take.mark("greeted");
  await a.moveTo(1100, 600, 700);
  await sleep(1500);
  const botId = page.url().match(/bots\/([^/?#]+)/)[1];
  fs.writeFileSync(SESSION, JSON.stringify({ site: SITE, botId, storage: await context.storageState(), at: new Date().toISOString() }, null, 2));
  console.log(`Juno is ${botId} (saved to ${SESSION})`);
  await take.stop();
} finally {
  await browser.close();
}
