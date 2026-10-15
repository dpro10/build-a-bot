/**
 * "Bring my memories" end to end: a new bot's chat offers it, the owner copies the message,
 * pastes the answer, unticks what they'd rather keep private, and saves. Then pins a basic.
 * Demo mode has no model to tidy the answer, so it's read line by line.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function noSeriousA11yIssues(page: Page, label: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("[data-sonner-toaster]")
    .exclude("nextjs-portal")
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help}`), label).toEqual([]);
}

test("bring my memories: copy, paste, untick, save, pin", async ({ page }) => {
  const res = await page.request.post("/api/bots", {
    data: {
      avatar: "otto",
      color: "grape",
      name: "Mimi",
      jobs: ["reminders"],
      brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: [],
      trust: "ask",
      channels: [],
      contact: {},
      ageConfirmed: true,
      timezone: "America/Chicago",
      ownerName: "Dana",
    },
  });
  expect(res.ok()).toBeTruthy();
  const id = (await res.json()).id as string;

  // A bot that barely knows its owner offers it right in the chat.
  await page.goto(`/app/bots/${id}`);
  await page.getByRole("link", { name: "Bring my memories from ChatGPT" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/bots/${id}/memory\\?import=1`));

  const paste = page.getByRole("dialog", { name: "Bring your memories" });
  await expect(paste).toBeVisible();
  await expect(paste.getByRole("button", { name: "Copy message" })).toBeVisible();
  await expect(paste.getByRole("link", { name: /ChatGPT/ })).toHaveAttribute("href", "https://chatgpt.com/");
  await noSeriousA11yIssues(page, "paste step");

  await paste
    .getByLabel("Paste its whole answer here")
    .fill("Here's what I remember about you:\n- You live in Lisbon\n- You have a cat named Miso\n- Your PIN is 1234\n- You prefer tea over coffee");
  await paste.getByRole("button", { name: "Continue" }).click();

  const review = page.getByRole("dialog", { name: "Here's what Mimi will remember" });
  await expect(review.getByText("Dana lives in Lisbon")).toBeVisible();
  await expect(review.getByText(/PIN/)).toHaveCount(0);
  await noSeriousA11yIssues(page, "review step");
  await review.getByRole("checkbox", { name: /tea over coffee/ }).uncheck();
  await review.getByRole("button", { name: "Save 2 memories" }).click();

  await expect(page.getByText("Mimi now knows 2 more things about you")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/app/bots/${id}/memory$`));
  await expect(page.getByText("Dana has a cat named Miso")).toBeVisible();
  await expect(page.getByText("Dana prefers tea over coffee")).toHaveCount(0);
  await expect(page.getByText("You brought this").first()).toBeVisible();

  // Pin a basic: always on Mimi's mind, listed first.
  await page.getByRole("button", { name: "Pin memory: Dana lives in Lisbon" }).click();
  await expect(page.getByText("Pinned: always on Mimi's mind")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("listitem").first()).toContainText("Dana lives in Lisbon");
  await expect(page.getByRole("listitem").first()).toContainText("Pinned");
});
