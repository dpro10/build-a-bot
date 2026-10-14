/**
 * Every page renders without a server error or a client crash, signed out and
 * signed in (an anonymous demo user with one bot, made through the API).
 */
import { expect, test, type Page } from "@playwright/test";

async function visit(page: Page, path: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const res = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(res?.status(), `${path} status`).toBeLessThan(400);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error|Unhandled Runtime Error/);
  expect(errors, `${path} page errors`).toEqual([]);
}

test("public pages render", async ({ page }) => {
  for (const path of ["/", "/pricing", "/safety", "/explore", "/r/inbox-zero", "/legal/terms", "/legal/privacy", "/login", "/build"]) {
    await visit(page, path);
  }
  const missing = await page.goto("/this-page-does-not-exist");
  expect(missing?.status()).toBe(404);
});

test("the landing page leads to the builder", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /build your bot/i }).first().click();
  await expect(page).toHaveURL(/\/build/);
  await expect(page.getByRole("heading", { name: "Pick a face" })).toBeVisible();
});

test("a recipe link prefills the builder", async ({ page }) => {
  await page.goto("/build?recipe=inbox-zero");
  await expect(page.getByText(/Making your own/)).toBeVisible();
  await expect(page.getByRole("radio", { name: /Nimbus/ })).toHaveAttribute("aria-checked", "true");
});

test("every dashboard page renders for a signed-in owner", async ({ page }) => {
  const created = await page.request.post("/api/bots", {
    data: {
      avatar: "blip",
      color: "ocean",
      name: "Smokey",
      jobs: ["inbox", "calendar", "reminders"],
      brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: ["gmail", "google_calendar", "github"],
      trust: "trusted",
      channels: ["telegram", "email"],
      contact: { email: "owner@example.com" },
      ageConfirmed: true,
      timezone: "America/New_York",
      morningBrief: { time: "08:00" },
    },
  });
  expect(created.ok()).toBeTruthy();
  const { id } = await created.json();
  for (const tab of ["", "/activity", "/tools", "/channels", "/routines", "/memory", "/settings"]) {
    await visit(page, `/app/bots/${id}${tab}`);
  }
  for (const path of ["/app?all=1", "/app/approvals", "/app/billing", "/app/bridge", "/app/account"]) {
    await visit(page, path);
  }
});
