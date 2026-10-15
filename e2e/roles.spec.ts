/**
 * Ready-made roles end to end: one tap on "Tutor" fills in the builder, the bot is born as a
 * tutor that asks what you're learning, and Settings can make it a general assistant again.
 * Demo mode: the demo brain writes the first message.
 */
import { expect, test } from "@playwright/test";

test("start with a ready-made tutor, meet it, then make it a general assistant", async ({ page }) => {
  await page.goto("/build");
  const readyMade = page.getByRole("navigation", { name: "Or start with a ready-made bot" });
  await expect(readyMade.getByRole("link", { name: /Job applier/ })).toBeVisible();
  await readyMade.getByRole("link", { name: /Tutor/ }).click();
  await expect(page).toHaveURL(/\/build\?recipe=tutor/);
  await expect(page.getByText(/Making your own\s+tutor/)).toBeVisible();
  // Starting from a recipe, the ready-made row steps aside.
  await expect(readyMade).toHaveCount(0);

  // Everything's filled in: straight through to the review.
  const footer = page.getByRole("contentinfo");
  for (let i = 0; i < 6; i++) await footer.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByRole("heading", { name: "Ready to meet Otto?" })).toBeVisible();
  await expect(page.getByText(/Tutor ·/).first()).toBeVisible();
  await page.getByText("I'm 18 or older").click();
  await footer.getByRole("button", { name: /Bring Otto to life/ }).click();
  await page.waitForURL(/\/app\/bots\/bot_/, { timeout: 30_000 });
  const botId = page.url().match(/bots\/(bot_[a-z0-9]+)/)![1];

  // It starts by asking what it needs, and offers tutor ideas.
  await expect(page.getByText(/I'm Otto, your new AI tutor\. To get started, tell me what you want to learn/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Quiz me on what we covered" })).toBeVisible();
  const wide = (page.viewportSize()?.width ?? 0) >= 640;
  if (wide) await expect(page.getByText("AI tutor", { exact: true })).toBeVisible();

  // Its routine came along.
  const schedules = await (await page.request.get(`/api/bots/${botId}/schedules`)).json();
  expect(schedules.schedules.map((x: { title: string }) => x.title)).toEqual(["Daily review"]);

  // Settings: back to a general assistant.
  await page.goto(`/app/bots/${botId}/settings`);
  const roles = page.getByRole("radiogroup", { name: "Role" });
  await expect(roles.getByRole("radio", { name: /Tutor/ })).toHaveAttribute("aria-checked", "true");
  await roles.getByRole("radio", { name: /General assistant/ }).click();
  await page.locator("#jobs").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Otto is a general assistant again.")).toBeVisible();
  if (wide) await expect(page.getByText("AI assistant", { exact: true }).first()).toBeVisible();
  const bot = await (await page.request.get(`/api/bots/${botId}`)).json();
  expect(bot.bot.role).toBeNull();
});
