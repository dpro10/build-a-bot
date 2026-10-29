/**
 * Building Juno, start to finish, signed in (record/site.mjs first), recorded frame by frame
 * (frames.mjs): Nimbus the cloud in Grape, "Juno", what to call you ("Diego"); every brain there
 * is (the providers for your own key, then all the open models on Nebius, down to the last;
 * Nemotron 3.5 Lightning stays picked); Gmail, Google Docs and Meeting notes picked by hand, and
 * what every bot gets (web search, files, any MCP server); Ask me first; the ways to talk; and
 * "Bring Juno to life" with its first message.
 *
 * Juno is the bot every later scene uses (video/out/demo/session.json, or BAB_VIDEO_SESSION); an
 * earlier run's Juno is deleted first.
 *   node video/demo/record/builder.mjs
 */
import fs from "node:fs";
import { SESSION, SITE, deletePreviousBot, loadAccount } from "./recorder.mjs";
import { Studio } from "./frames.mjs";

const account = loadAccount();
await deletePreviousBot();
const studio = await Studio.launch({ storageState: account.storage });
const { page, context } = studio;
const a = studio.actor(12);
const wait = (ms) => studio.sleep(ms);
const cont = () => page.getByRole("button", { name: /^Continue/ });
/** Hovers a target that's on screen, between the header and the bar at the bottom. */
const glance = (locator, opts = {}) => a.glance(locator, { top: 70, bottom: 640, ...opts });

try {
  await page.goto(`${SITE}/build`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await wait(1000);
  await a.place(980, 300);
  const take = await studio.take("builder");
  await wait(400);

  // A face of its own: Nimbus, in Grape. (Paced to the narration: every step about as long as
  // what's said over it.)
  take.mark("face");
  await a.click(page.getByRole("radio", { name: /Nimbus the cloud/ }), { pause: 200, ms: 620 });
  await wait(350);
  await a.moveTo(450, 560, 380);
  await a.scroll(230, 500);
  await wait(120);
  await a.click(page.getByRole("radio", { name: "Grape", exact: true }), { pause: 200, ms: 450 });
  await wait(400);
  await a.click(cont(), { pause: 200, ms: 650 });

  // Name: Juno, and what it should call you.
  take.mark("name");
  await wait(300);
  await a.click(page.getByPlaceholder(/e\.g\. /).first(), { pause: 160, ms: 520 });
  await a.type("Juno", { min: 45, max: 85 });
  await wait(250);
  await a.click(page.getByPlaceholder(/Your first name/), { pause: 160, ms: 450 });
  await a.type("Diego", { min: 45, max: 85 });
  await wait(350);
  await a.click(cont(), { pause: 200, ms: 620 });

  // Brain: every one there is. Your own key first (the providers it works with), then the open
  // models on Nebius, all of them; Nemotron 3.5 Lightning stays picked.
  take.mark("brain");
  await wait(450);
  await a.hover(page.getByRole("radio", { name: /Open models on Nebius/ }).first(), { ms: 500 });
  await wait(250);
  await a.click(page.getByRole("radio", { name: /Your own API key/ }).first(), { pause: 200, ms: 450 });
  take.mark("byok");
  await wait(250);
  for (const p of [/Anthropic/, /OpenAI$/, /Gemini/, /OpenRouter/, /Mistral/, /xAI/, /Together AI/, /Cerebras/]) {
    await glance(page.getByRole("radio", { name: p }).first(), { ms: 220 });
    await wait(60);
  }
  await wait(200);
  await a.click(page.getByRole("radio", { name: /Open models on Nebius/ }).first(), { pause: 200, ms: 450 });
  take.mark("open-models");
  await wait(900);
  await a.moveTo(450, 470, 380);
  const group = (name) => page.locator("main").getByText(name, { exact: true }).first();
  await studio.scrollTo((await studio.pageTop(group("Fast"))) - 90, 900);
  take.mark("fast");
  await glance(page.getByRole("radio", { name: /Nemotron 3\.5 Lightning/ }).first(), { ms: 380 });
  await wait(400);
  await studio.scrollTo((await studio.pageTop(group("Balanced"))) - 85, 900);
  take.mark("balanced");
  await glance(page.getByRole("radio", { name: /Nemotron 3 Super/ }).first(), { ms: 380 });
  await wait(400);
  await studio.scrollTo(1e6, 900);
  take.mark("smart");
  await glance(page.getByRole("radio", { name: /Nemotron 3 Ultra/ }).first(), { ms: 380 });
  await wait(350);
  await glance(page.getByRole("radio", { name: /Hermes 4/ }).first(), { ms: 380 });
  await wait(300);
  take.note({ radios: await page.locator("main").getByRole("radio").count() });
  await a.click(cont(), { pause: 200, ms: 600 });

  // Apps, picked by hand: Gmail, Google Docs and Meeting notes. Then what's always there (web
  // search, files and the rest), and room for your own MCP servers.
  take.mark("apps");
  await wait(450);
  await a.moveTo(450, 420, 380);
  const app = (name) => page.getByRole("button", { name: new RegExp(`^${name}`) }).first();
  await studio.scrollTo((await studio.pageTop(app("Gmail"))) - 140, 1000);
  take.mark("app-grid");
  await wait(200);
  for (const name of ["Gmail", "Google Docs", "Meeting notes"]) {
    take.mark(`app:${name}`);
    await a.click(app(name), { pause: 200, after: 380, ms: 420 });
  }
  await wait(250);
  await studio.scrollTo(1e6, 1000);
  take.mark("included");
  await glance(page.getByRole("button", { name: /Add by URL/ }).first(), { ms: 450 });
  await wait(350);
  await glance(page.locator("main").getByText("Web search", { exact: true }).first(), { ms: 380 });
  await wait(200);
  await glance(page.locator("main").getByText("Files", { exact: true }).first(), { ms: 380 });
  await wait(350);
  await a.click(cont(), { pause: 200, ms: 600 });

  // Trust: Ask me first, and what's enforced in code at every level.
  take.mark("trust");
  await wait(450);
  await a.hover(page.getByRole("radio", { name: /Ask me first/ }).first());
  await wait(1000);
  await a.hover(page.getByText(/enforced in code/).first());
  await wait(1100);
  await a.click(cont(), { pause: 200, ms: 600 });

  // Talk: the web app is always on; calls too.
  take.mark("talk");
  await wait(450);
  await a.hover(page.getByText("Phone calls", { exact: true }).first());
  await wait(1000);
  await a.click(cont(), { pause: 200, ms: 600 });

  // Review, 18+, and bring it to life.
  take.mark("review");
  await wait(700);
  const age = page.getByText("I'm 18 or older");
  await a.click(age, { pause: 200, dx: -70 });
  await wait(300);
  take.mark("go");
  await a.click(page.getByRole("button", { name: /Bring .* to life/ }), { pause: 260 });
  await page.waitForURL(/\/app\/bots\//, { timeout: 60000 });
  take.mark("born");
  // Its first message streams in.
  await page.locator("main").getByText(/Juno/).first().waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 90000 }).catch(() => {});
  await wait(1500);
  take.mark("greeted");
  await a.moveTo(1100, 600, 700);
  await wait(900);
  const botId = page.url().match(/bots\/([^/?#]+)/)[1];
  fs.writeFileSync(SESSION, JSON.stringify({ site: SITE, botId, storage: await context.storageState(), at: new Date().toISOString() }, null, 2));
  console.log(`Juno is ${botId} (saved to ${SESSION})`);
  await take.stop();
} finally {
  await studio.close();
}
