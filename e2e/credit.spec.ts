/**
 * Pay for what you use, at cost: the pricing page lists what things cost (no plans), and Credit &
 * usage shows the balance, adds credit (free in demo mode) and keeps a history.
 */
import { expect, test, type Locator } from "@playwright/test";

test("the pricing page shows what things cost, with no plans to pick", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: "Pay for what you use. At cost." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "$5.00 to start" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What things cost." })).toBeVisible();
  // A typical message on the default model: 5,000 tokens in at $0.06/M and 500 out at $0.24/M.
  const thinking = page.getByRole("region", { name: "Thinking, on the open models we run" });
  await expect(thinking.getByRole("listitem").filter({ hasText: "Nemotron 3.5 Lightning" }).getByText("≈ $0.00042")).toBeVisible();
  const free = page.getByRole("region", { name: "Free here" });
  await expect(free.getByRole("listitem").filter({ hasText: "Your own AI key" }).getByText("Free", { exact: true })).toBeVisible();
  await expect(page.getByText(/upgrade|most popular|billed yearly/i)).toHaveCount(0);
});

test("Credit & usage: the balance, adding credit (free in demo mode) and its history", async ({ page }) => {
  const res = await page.request.post("/api/bots", {
    data: {
      avatar: "otto",
      color: "grape",
      name: "Penny",
      jobs: [],
      brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: [],
      trust: "ask",
      channels: [],
      contact: {},
      ageConfirmed: true,
      timezone: "America/Chicago",
    },
  });
  expect(res.ok()).toBeTruthy();

  await page.goto("/app/billing");
  await expect(page.getByRole("heading", { name: "Credit & usage" })).toBeVisible();
  await expect(page.locator("#credit-balance")).toHaveText("$5.00");
  await expect(page.getByText("Starter credit, to try everything")).toBeVisible();
  await expect(page.getByText("Demo mode: credit is added instantly and nothing is charged (up to $20 an account).")).toBeVisible();

  await page.getByRole("button", { name: /Add \$10 of credit/ }).click();
  await expect(page.getByText("Added $10 of credit.")).toBeVisible();
  await expect(page.locator("#credit-balance")).toHaveText("$15.00");
  await expect(page.getByText("Demo credit (nothing charged)")).toBeVisible();

  // What things cost, and where the rest of the prices are.
  await expect(page.getByRole("heading", { name: "What things cost" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Every model and price" })).toHaveAttribute("href", "/pricing");

  await page.goto("/app/account");
  await expect(page.getByText("$15.00 left")).toBeVisible();
});

test("before signing in: a few messages on us, then a link to sign in that comes back to the chat", async ({ page, isMobile }) => {
  // No session: the bot is made on an account that hasn't signed in yet.
  const res = await page.request.post("/api/bots", {
    data: {
      avatar: "otto",
      color: "mint",
      name: "Pip",
      jobs: [],
      brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: [],
      trust: "ask",
      channels: [],
      contact: {},
      ageConfirmed: true,
      timezone: "America/Chicago",
    },
  });
  expect(res.ok()).toBeTruthy();
  const id = (await res.json()).id as string;
  // The sidebar (the menu, on a phone) counts free messages, not the starter dollar that goes further with an email.
  const sidebar = async (check: (side: Locator) => Promise<void>) => {
    if (!isMobile) return check(page.locator("body"));
    await page.getByRole("button", { name: "Open menu" }).click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    await check(menu);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  };
  await page.goto(`/app/bots/${id}`);
  await sidebar(async (side) => {
    await expect(side.getByRole("link", { name: /Credit & usage/ }).first()).toContainText(/\d free/);
    await expect(side.getByText(/of 5 free messages left/).first()).toBeVisible();
  });

  for (let i = 0; i < 6; i++) await page.request.post(`/api/bots/${id}/chat`, { data: { text: `Hello number ${i + 1}` } });
  await page.reload();
  const signIn = page.getByRole("link", { name: "Sign in with your email to keep going" }).last();
  await expect(signIn).toBeVisible();
  await expect(signIn).toHaveAttribute("href", `/login?next=${encodeURIComponent(`/app/bots/${id}`)}`);
  await sidebar(async (side) => {
    await expect(side.getByRole("link", { name: /Credit & usage/ }).first()).toContainText("0 free");
  });
  await page.goto("/app/billing");
  await expect(page.getByText(/Until you sign in, your bots answer 0 more messages/)).toBeVisible();
});
