/**
 * The website as a first-time visitor sees it, then signing in, in one take: the landing page's
 * hero, "How it works" (the five choices), a run down the page to its recipes, the recipe gallery,
 * "Start from scratch", Sign in, the email typed, "Check your email". Recorded frame by frame
 * (frames.mjs).
 *
 * The sign-in link is in that inbox, so the script then waits for it in a file
 * (video/out/demo/signin-link.txt; paste it there), opens it in the same browser (sign-in links
 * work only in the browser that asked), and saves the signed-in cookies for the later scenes
 * (video/out/demo/account.json, or BAB_VIDEO_ACCOUNT).
 *
 *   BAB_VIDEO_EMAIL=you+demo@example.com node video/demo/record/site.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { ACCOUNT, OUT, SITE } from "./recorder.mjs";
import { Studio } from "./frames.mjs";

const EMAIL = process.env.BAB_VIDEO_EMAIL;
if (!EMAIL) throw new Error("Set BAB_VIDEO_EMAIL to the demo account's address.");
const LINK = path.join(OUT, "signin-link.txt");
fs.rmSync(LINK, { force: true });

const studio = await Studio.launch();
const { page, context } = studio;
const a = studio.actor(29);
const wait = (ms) => studio.sleep(ms);
/** The top of a heading on the page, so a scroll can bring its section under the sticky header. */
const sectionTop = (text) =>
  page.evaluate((text) => {
    const h = [...document.querySelectorAll("h1, h2")].find((e) => e.textContent.includes(text));
    return Math.round(h.getBoundingClientRect().top + scrollY);
  }, text);
const recipe = (name) => page.getByRole("link", { name: new RegExp(`the ${name} bot`) }).first();

try {
  await page.goto(`${SITE}/`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await wait(1200);
  await a.place(860, 470);
  const take = await studio.take("site");
  await wait(700);

  // The hero.
  take.mark("hero");
  await a.moveTo(430, 290, 1100);
  await wait(350);
  await a.hover(page.getByRole("link", { name: "Build your bot" }).nth(1), { ms: 650 });
  await wait(900);

  // How it works: the five choices.
  take.mark("how-scroll");
  await studio.scrollTo((await sectionTop("Five quick choices")) - 150, 1300);
  take.mark("how");
  for (const s of ["Pick a face", "Name it", "Give it a brain", "Apps & trust", "Talk anywhere"]) {
    await a.glance(page.getByText(s, { exact: true }).first(), { ms: 420 });
    await wait(260);
  }
  await wait(300);

  // Down the page, past the brains, the apps, the trust levels, calls, meetings and voice typing,
  // to the recipes.
  take.mark("run");
  await a.moveTo(640, 420, 500);
  await studio.scrollTo((await sectionTop("Start from a recipe")) - 140, 3400);
  take.mark("recipes");
  await wait(250);
  for (const r of ["tutor", "job applier", "inbox zero"]) {
    await a.glance(recipe(r), { dy: -60, ms: 480 });
    await wait(320);
  }

  // The recipe gallery, more of it, and "Start from scratch".
  take.mark("explore-click");
  await a.click(page.getByRole("link", { name: "Explore all recipes" }), { pause: 220 });
  await page.waitForURL(/\/explore/);
  await page.waitForLoadState("networkidle").catch(() => {});
  take.mark("explore");
  await wait(700);
  for (const r of ["tutor", "job applier"]) {
    await a.glance(recipe(r), { dy: -60, ms: 480 });
    await wait(300);
  }
  take.mark("more-scroll");
  const more = await page.evaluate(() => Math.round(document.querySelector('a[href*="/r/meeting-buddy"]').getBoundingClientRect().top + scrollY) - 110);
  await studio.scrollTo(more, 1200);
  for (const r of ["meeting buddy", "fitness coach"]) {
    await a.glance(recipe(r), { dy: -60, ms: 480 });
    await wait(300);
  }
  take.mark("scratch-scroll");
  const scratch = page.locator('a[href="/build"]').filter({ hasText: "Start from scratch" }).first();
  await studio.scrollTo((await studio.pageTop(scratch)) - 300, 1300);
  take.mark("scratch");
  await wait(300);
  await a.glance(scratch.getByText("Start from scratch").first(), { ms: 550 });
  await wait(800);

  // Sign in first, from the header (it stays at the top).
  take.mark("signin");
  await a.click(page.locator("header").getByRole("link", { name: "Sign in" }), { pause: 300 });
  await page.waitForURL(/\/login/);
  await page.waitForLoadState("networkidle").catch(() => {});
  take.mark("login");
  await wait(900);
  await a.click(page.getByPlaceholder("you@example.com"), { pause: 200 });
  take.mark("email");
  await a.type(EMAIL, { min: 30, max: 70 });
  await wait(350);
  // A rehearsal (BAB_VIDEO_DRY=1) stops here, before an email goes out.
  if (process.env.BAB_VIDEO_DRY) {
    await wait(1500);
    await take.stop();
    process.exit(0);
  }
  await a.click(page.getByRole("button", { name: "Email me a magic link" }), { pause: 250 });
  take.mark("sent");
  await page.getByText(/Check your email/i).first().waitFor({ timeout: 30000 });
  take.mark("check");
  await wait(1800);
  await take.stop();

  console.log(`Waiting for the sign-in link in ${LINK} …`);
  for (let i = 0; !fs.existsSync(LINK); i++) {
    if (i > 1200) throw new Error("No link after 20 minutes (links expire then).");
    await new Promise((r) => setTimeout(r, 1000));
  }
  const link = fs.readFileSync(LINK, "utf8").trim();
  if (!link.startsWith(SITE)) throw new Error(`That isn't a ${SITE} link: ${link.slice(0, 60)}`);
  await page.goto(link, { waitUntil: "load" });
  // Opened where it was asked for, the link signs in straight away (to /app, or the builder when
  // there's no bot yet); anywhere else it asks for a click first.
  const signedIn = async () => (await context.cookies(SITE)).some((c) => c.name === "bab_session");
  if (!(await signedIn()) && /\/auth\/confirm/.test(page.url())) {
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/auth/"), { timeout: 30000 });
  }
  if (!(await signedIn())) throw new Error(`Not signed in (at ${page.url()})`);
  fs.writeFileSync(ACCOUNT, JSON.stringify({ site: SITE, email: EMAIL, storage: await context.storageState(), at: new Date().toISOString() }, null, 2));
  console.log(`Signed in → ${path.relative(OUT, ACCOUNT)} (now at ${page.url()})`);
} finally {
  await studio.close();
}
