/**
 * The website as a first-time visitor sees it (signed out): the landing page's hero, "How it works"
 * (the five choices), the brain (NVIDIA Nemotron on Nebius), its recipes, then the recipe gallery,
 * "Start from scratch", and Sign in (the sign-in take, record/signin.mjs, picks up from there). One
 * take, marked for the edit.
 *   node video/demo/record/site.mjs
 */
import { SITE, Take, actor, launch, sleep } from "./recorder.mjs";

const { browser, page } = await launch();
const a = actor(page, 29);

/** Scrolls the page (not an inner panel) to y, eased. */
async function scrollTo(y, ms) {
  await page.evaluate(
    ([y, ms]) =>
      new Promise((done) => {
        const el = document.scrollingElement;
        const from = el.scrollTop;
        const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const t0 = performance.now();
        const step = (now) => {
          const t = Math.min(1, (now - t0) / ms);
          el.scrollTop = from + (y - from) * ease(t);
          if (t < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      }),
    [y, ms],
  );
}
/** The top of a heading on the page, so a scroll can bring its section under the sticky header. */
const sectionTop = (text) =>
  page.evaluate((text) => {
    const h = [...document.querySelectorAll("h1, h2")].find((e) => e.textContent.includes(text));
    return Math.round(h.getBoundingClientRect().top + scrollY);
  }, text);
const smoothOff = () => page.addStyleTag({ content: "html { scroll-behavior: auto !important; }" });
/** Hovers a target only if it's already on screen (the actor would otherwise scroll it into view). */
async function glance(locator, opts = {}) {
  const b = await locator.boundingBox().catch(() => null);
  if (!b || b.y < 70 || b.y + b.height > 715) return false;
  await a.moveTo(b.x + b.width / 2 + (opts.dx ?? 0), b.y + b.height / 2 + (opts.dy ?? 0), opts.ms ?? 650);
  return true;
}

try {
  await page.goto(`${SITE}/`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await smoothOff();
  await sleep(1500);
  await a.place(860, 470);
  const take = await new Take(page, "site").start();
  await sleep(900);
  take.mark("hero");
  await a.moveTo(420, 300, 1200);
  await sleep(700);
  await a.hover(page.getByRole("link", { name: "Build your bot" }).nth(1));
  await sleep(900);

  // How it works: the five choices.
  take.mark("how-scroll");
  await scrollTo((await sectionTop("Five quick choices")) - 150, 1500);
  take.mark("how");
  await sleep(500);
  const steps = ["Pick a face", "Name it", "Give it a brain", "Apps & trust", "Talk anywhere"];
  for (const s of steps) {
    await glance(page.getByText(s, { exact: true }).first(), { ms: 520 });
    await sleep(380);
  }
  await sleep(500);

  // The brain: NVIDIA Nemotron and other open models on Nebius, at cost.
  take.mark("brain-scroll");
  await scrollTo((await sectionTop("Bring any brain")) - 150, 1300);
  take.mark("brain");
  await sleep(500);
  await glance(page.getByText("Included open models", { exact: true }).first());
  await sleep(900);
  await glance(page.getByText(/^Nemotron/).first());
  await sleep(1100);

  // A quick run down the page to the recipes.
  take.mark("recipes-scroll");
  await scrollTo((await sectionTop("Start from a recipe")) - 150, 2400);
  take.mark("recipes");
  await sleep(500);
  for (const r of ["tutor", "job applier", "inbox zero"]) {
    await glance(page.getByRole("link", { name: new RegExp(`the ${r} bot`) }).first(), { dy: -60, ms: 560 });
    await sleep(450);
  }
  await a.click(page.getByRole("link", { name: "Explore all recipes" }), { pause: 250 });
  await page.waitForURL(/\/explore/);
  await page.waitForLoadState("networkidle").catch(() => {});
  await smoothOff();
  take.mark("explore");
  await sleep(1300);
  for (const r of ["tutor", "job applier", "inbox zero"]) {
    await glance(page.getByRole("link", { name: new RegExp(`the ${r} bot`) }).first(), { dy: -60, ms: 560 });
    await sleep(500);
  }
  take.mark("more-scroll");
  await scrollTo(await page.evaluate(() => Math.round(document.querySelector('a[href*="/r/meeting-buddy"]').getBoundingClientRect().top + scrollY) - 110), 1300);
  for (const r of ["meeting buddy", "fitness coach", "deep researcher"]) {
    await glance(page.getByRole("link", { name: new RegExp(`the ${r} bot`) }).first(), { dy: -60, ms: 560 });
    await sleep(450);
  }
  take.mark("scratch-scroll");
  const scratch = page.locator('a[href="/build"]').filter({ hasText: "Start from scratch" }).first();
  await scrollTo(await scratch.evaluate((el) => Math.round(el.getBoundingClientRect().top + scrollY) - 300), 1500);
  take.mark("scratch");
  await sleep(700);
  await glance(scratch.getByText("Start from scratch").first(), { ms: 600 });
  await sleep(1000);
  // Sign in first, from the header (it stays at the top).
  take.mark("signin");
  await a.click(page.locator("header").getByRole("link", { name: "Sign in" }), { pause: 350 });
  await page.waitForURL(/\/login/);
  await page.waitForLoadState("networkidle").catch(() => {});
  take.mark("login");
  // Where the sign-in take starts, so the two join up.
  await a.moveTo(900, 520, 800);
  await sleep(1500);
  await take.stop();
} finally {
  await browser.close();
}
