/**
 * Signs in the demo account the way a person does, and records it: the sign-in page, the email
 * typed, "Email me a magic link", "Check your email". The link is in that inbox, so the script waits
 * for it in a file (video/out/demo/signin-link.txt; paste it there), opens it in the same browser
 * (sign-in links work only in the browser that asked), confirms, and saves the signed-in cookies
 * for every later scene (video/out/demo/account.json).
 *
 *   BAB_VIDEO_EMAIL=you+demo@example.com node video/demo/record/signin.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { ACCOUNT, OUT, SITE, Take, actor, launch, sleep } from "./recorder.mjs";

const EMAIL = process.env.BAB_VIDEO_EMAIL;
if (!EMAIL) throw new Error("Set BAB_VIDEO_EMAIL to the demo account's address.");
const LINK = path.join(OUT, "signin-link.txt");
fs.rmSync(LINK, { force: true });

const { browser, context, page } = await launch();
const a = actor(page, 5);
try {
  await page.goto(`${SITE}/login`, { waitUntil: "networkidle" });
  await a.place(900, 520);
  const take = await new Take(page, "signin").start();
  await sleep(900);
  await a.click(page.getByPlaceholder("you@example.com"), { pause: 200 });
  await a.type(EMAIL, { min: 30, max: 70 });
  await sleep(350);
  await a.click(page.getByRole("button", { name: "Email me a magic link" }), { pause: 250 });
  take.mark("sent");
  await page.getByText(/Check your email/i).first().waitFor({ timeout: 20000 });
  take.mark("check");
  await sleep(1800);
  await take.stop();

  console.log(`Waiting for the sign-in link in ${LINK} …`);
  for (let i = 0; !fs.existsSync(LINK); i++) {
    if (i > 1200) throw new Error("No link after 20 minutes (links expire then).");
    await sleep(1000);
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
  console.log(`Signed in as ${EMAIL} → ${ACCOUNT} (now at ${page.url()})`);
} finally {
  await browser.close();
}
