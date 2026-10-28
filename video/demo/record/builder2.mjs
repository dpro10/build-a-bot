/**
 * The builder again, for the cut without a narrator (edit-voiceover.mjs). It runs on a second account
 * (record/signin.mjs with BAB_VIDEO_ACCOUNT=account2.json), so the Juno the other scenes use stays.
 * The same Juno (Nimbus in Grape, "Diego", Nemotron 3.5 Lightning, Ask me first), but the brain step
 * shows every brain there is (the providers for your own key, then all the open models on Nebius,
 * down to the last), and the apps are picked by hand: Gmail, Google Docs and Meeting notes.
 *   node video/demo/record/builder2.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { OUT, SITE, Take, actor, launch, loadAccount, sleep } from "./recorder.mjs";

const account = loadAccount(path.join(OUT, "account2.json"));
const { browser, context, page } = await launch({ storageState: account.storage });
const a = actor(page, 12);
const cont = () => page.getByRole("button", { name: /^Continue/ });

/** Scrolls the page to y (or as far as it goes), eased. */
async function scrollTo(y, ms) {
  await page.evaluate(
    ([y, ms]) =>
      new Promise((done) => {
        const el = document.scrollingElement;
        const from = el.scrollTop;
        const to = Math.min(y, el.scrollHeight - el.clientHeight);
        const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const t0 = performance.now();
        const step = (now) => {
          const t = Math.min(1, (now - t0) / ms);
          el.scrollTop = from + (to - from) * ease(t);
          if (t < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      }),
    [y, ms],
  );
}
/** Where something sits on the page (not the screen), for scrolling to it. */
const pageTop = (locator) => locator.evaluate((el) => Math.round(el.getBoundingClientRect().top + scrollY));
/** Hovers a target only if it's on screen, between the header and the bar at the bottom. */
async function glance(locator, opts = {}) {
  const b = await locator.boundingBox().catch(() => null);
  if (!b || b.y < 70 || b.y + b.height > 640) return false;
  await a.moveTo(b.x + b.width / 2 + (opts.dx ?? 0), b.y + b.height / 2 + (opts.dy ?? 0), opts.ms ?? 600);
  return true;
}

try {
  await page.goto(`${SITE}/build`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html { scroll-behavior: auto !important; }" });
  await a.place(980, 300);
  const take = await new Take(page, "builder2").start();
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

  // Brain: every one there is. Your own key first (the providers it works with), then the open
  // models on Nebius, all of them; Nemotron 3.5 Lightning stays picked.
  take.mark("brain");
  await sleep(800);
  await a.hover(page.getByRole("radio", { name: /Open models on Nebius/ }).first());
  await sleep(600);
  await a.click(page.getByRole("radio", { name: /Your own API key/ }).first(), { pause: 250 });
  take.mark("byok");
  await sleep(450);
  for (const p of [/Anthropic/, /OpenAI$/, /Gemini/, /OpenRouter/, /Mistral/, /xAI/, /Together AI/, /Cerebras/]) {
    await glance(page.getByRole("radio", { name: p }).first(), { ms: 300 });
    await sleep(110);
  }
  await sleep(350);
  await a.click(page.getByRole("radio", { name: /Open models on Nebius/ }).first(), { pause: 250 });
  take.mark("open-models");
  await sleep(600);
  await a.moveTo(450, 470, 450);
  const group = (name) => page.locator("main").getByText(name, { exact: true }).first();
  await scrollTo((await pageTop(group("Fast"))) - 90, 1100);
  take.mark("fast");
  await glance(page.getByRole("radio", { name: /Nemotron 3\.5 Lightning/ }).first(), { ms: 450 });
  await sleep(650);
  await scrollTo((await pageTop(group("Balanced"))) - 85, 1100);
  take.mark("balanced");
  await glance(page.getByRole("radio", { name: /Nemotron 3 Super/ }).first(), { ms: 450 });
  await sleep(650);
  await scrollTo(1e6, 1100);
  take.mark("smart");
  await glance(page.getByRole("radio", { name: /Nemotron 3 Ultra/ }).first(), { ms: 450 });
  await sleep(600);
  await glance(page.getByRole("radio", { name: /Hermes 4/ }).first(), { ms: 450 });
  await sleep(500);
  await a.click(cont(), { pause: 250 });

  // Apps, picked by hand: Gmail, Google Docs and Meeting notes. Then what's always there (web
  // search, files and the rest), and room for your own MCP servers.
  take.mark("apps");
  await sleep(800);
  await a.moveTo(450, 420, 500);
  const app = (name) => page.getByRole("button", { name: new RegExp(`^${name}`) }).first();
  await scrollTo((await pageTop(app("Gmail"))) - 140, 1300);
  take.mark("app-grid");
  await sleep(300);
  for (const name of ["Gmail", "Google Docs", "Meeting notes"]) {
    await a.click(app(name), { pause: 250, after: 550 });
  }
  await sleep(500);
  await scrollTo(1e6, 1400);
  take.mark("included");
  await glance(page.getByRole("button", { name: /Add by URL/ }).first(), { ms: 550 });
  await sleep(600);
  await glance(page.locator("main").getByText("Web search", { exact: true }).first(), { ms: 450 });
  await sleep(350);
  await glance(page.locator("main").getByText("Files", { exact: true }).first(), { ms: 450 });
  await sleep(600);
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
  fs.writeFileSync(path.join(OUT, "session2.json"), JSON.stringify({ site: SITE, botId, storage: await context.storageState(), at: new Date().toISOString() }, null, 2));
  console.log(`this Juno is ${botId} (saved to session2.json)`);
  await take.stop();
} finally {
  await browser.close();
}
