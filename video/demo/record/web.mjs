/**
 * Web search: Juno looks something up with Tavily and answers with its sources.
 *
 * Juno from the builder (video/out/demo/session.json), after the files scene.
 *   node video/demo/record/web.mjs ["the question"]
 */
import { SITE, Take, actor, composer, launch, loadSession, sleep } from "./recorder.mjs";

const QUESTION = process.argv[2] ?? "Find me three AI internships for summer 2027 that are still taking applications.";
const s = loadSession();
const { browser, page } = await launch({ storageState: s.storage });
const a = actor(page, 47);

try {
  await page.goto(`${SITE}/app/bots/${s.botId}`, { waitUntil: "load" });
  await composer(page).waitFor({ timeout: 30000 });
  await sleep(1500);
  await a.place(900, 560);
  const take = await new Take(page, "web").start();
  await sleep(900);
  await a.click(composer(page), { pause: 200 });
  await a.type(QUESTION);
  await sleep(450);
  await page.keyboard.press("Enter");
  take.mark("asked");
  // The search shows as work in the reply; the answer streams in after.
  await page.getByText(/Search(ed|ing)? the web|Searching/i).last().waitFor({ timeout: 60000 }).catch(() => {});
  take.mark("searching");
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') && !/Thinking|Searching/.test(document.querySelector("main")?.innerText.slice(-400) ?? ""), null, { timeout: 180000 }).catch(() => {});
  await sleep(1200);
  take.mark("answered");
  // A slow look down the answer.
  await a.moveTo(820, 420, 700);
  await a.scroll(-260, 900);
  await sleep(1200);
  await a.scroll(260, 900);
  await sleep(1800);
  await take.stop();
  const text = await page.locator("main").innerText();
  console.log(text.slice(-2500));
} finally {
  await browser.close();
}
