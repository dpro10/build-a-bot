/**
 * Sign-in links opened somewhere other than the browser that asked for them: the confirm page
 * names the account and signs in only on a click, and the bots made in the asking browser stay
 * there. (Opened in the same browser, a link signs in at once: e2e/voice.spec.ts.)
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("a link opened in another browser asks first, then signs in to that email's account only", async ({ page, browser }) => {
  // The browser that asks has a bot already (built before signing in).
  const made = await page.request.post("/api/bots", {
    data: { avatar: "otto", color: "grape", name: "Pip", jobs: [], brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" }, connectors: [], trust: "ask", channels: [], contact: {}, ageConfirmed: true, timezone: "UTC" },
  });
  expect(made.ok()).toBe(true);
  const email = `elsewhere-${Date.now()}@example.com`;
  const asked = await page.request.post("/api/auth/magic", { data: { email } });
  const { demoLink } = (await asked.json()) as { demoLink: string };

  const other = await browser.newContext();
  const phone = await other.newPage();
  await phone.goto(demoLink);
  await expect(phone).toHaveURL(/\/auth\/confirm\?token=/);
  await expect(phone.getByRole("heading", { name: "Sign in to Build-a-bot" })).toBeVisible();
  await expect(phone.getByText(email)).toBeVisible();
  const results = await new AxeBuilder({ page: phone }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

  await phone.getByRole("button", { name: "Sign in" }).click();
  // A new account with no bots yet goes on to the builder.
  await expect(phone).toHaveURL(/\/build$/);
  // Signed in as that email, without the other browser's bot.
  await phone.goto("/app/account");
  await expect(phone.getByText(email).first()).toBeVisible();
  const names = async (p: typeof page) => ((await (await p.request.get("/api/bots")).json()) as { bots: { bot: { name: string } }[] }).bots.map((b) => b.bot.name);
  expect(await names(phone)).toEqual([]);
  await other.close();

  // The asking browser still has its bot.
  expect(await names(page)).toEqual(["Pip"]);
});
