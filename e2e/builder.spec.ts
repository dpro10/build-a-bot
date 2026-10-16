/**
 * The core journey in demo mode: build a bot in the builder, meet it in chat,
 * ask for something that needs a tap, approve it, and pause it with STOP.
 */
import { expect, test, type Page } from "@playwright/test";

const footer = (page: Page) => page.getByRole("contentinfo");

async function buildBot(page: Page, name: string) {
  await page.goto("/build");
  await expect(page.getByRole("heading", { name: "Pick a face" })).toBeVisible();

  // Face
  await page.getByRole("radio", { name: /Nimbus/ }).click();
  await page.getByRole("radio", { name: "Mint" }).click();
  await footer(page).getByRole("button", { name: /Continue/ }).click();

  // Name
  await expect(page.getByRole("heading", { name: "Name it" })).toBeVisible();
  await page.getByLabel("Bot name").fill(name);
  await page.getByLabel(/call you/).fill("Dana");
  await footer(page).getByRole("button", { name: /Continue/ }).click();

  // Brain: the included model is preselected
  await expect(page.getByRole("heading", { name: "Choose its brain" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Open models we run/ })).toHaveAttribute("aria-checked", "true");
  await footer(page).getByRole("button", { name: /Continue/ }).click();

  // Apps: pick a job, then Gmail from the catalog
  await expect(page.getByRole("heading", { name: "Give it your apps" })).toBeVisible();
  await page.getByRole("button", { name: /Inbox/ }).first().click();
  await page.getByLabel("Search apps").fill("gmail");
  await page.getByRole("button", { name: /^Gmail/ }).click();
  await expect(page.getByRole("button", { name: "Remove Gmail" })).toBeVisible();
  await footer(page).getByRole("button", { name: /Continue/ }).click();

  // Trust: keep "Ask me first"
  await expect(page.getByRole("radio", { name: /Ask me first/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/prompt-injection/i).first()).toBeVisible();
  await footer(page).getByRole("button", { name: /Continue/ }).click();

  // Channels: Telegram
  await expect(page.getByRole("heading", { name: "How do you want to talk?" })).toBeVisible();
  await page.getByRole("button", { name: /Telegram/ }).first().click();
  await footer(page).getByRole("button", { name: /Continue/ }).click();

  // Review: the morning brief is on by default; can't create before confirming age
  await expect(page.getByRole("heading", { name: `Ready to meet ${name}?` })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Morning brief" })).toBeChecked();
  await page.getByText("I'm 18 or older").click();
  await footer(page).getByRole("button", { name: new RegExp(`Bring ${name} to life`) }).click();
  await page.waitForURL(/\/app\/bots\/bot_/, { timeout: 30_000 });
}

test("build a bot, chat, approve an action, then STOP", async ({ page }) => {
  const name = `Juniper${Math.floor(Math.random() * 1000)}`;
  await buildBot(page, name);

  // The bot greets first.
  await expect(page.getByText(new RegExp(`I'm ${name}, your new AI assistant`))).toBeVisible({ timeout: 30_000 });

  // The morning brief became a real routine.
  const botId = page.url().match(/bots\/(bot_[a-z0-9]+)/)![1];
  const schedules = await (await page.request.get(`/api/bots/${botId}/schedules`)).json();
  expect(schedules.schedules.map((x: { title: string }) => x.title)).toContain("Morning brief");

  // A send needs the owner's tap under "Ask me first".
  const box = page.getByLabel("Message");
  await box.fill("reply to sam saying yes, 12:30 works");
  await page.getByRole("button", { name: "Send" }).click();
  const approve = page.getByRole("button", { name: /Approve/ }).last();
  await expect(approve).toBeVisible({ timeout: 30_000 });
  await approve.click();
  await expect(page.getByText(/Approved/).last()).toBeVisible({ timeout: 30_000 });

  // STOP pauses the bot from the header.
  await page.getByRole("button", { name: "Stop everything" }).click();
  await expect(page.getByText("Paused").first()).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText("Online").first()).toBeVisible();
});

test("the builder keeps a draft and never stores the API key", async ({ page }) => {
  await page.goto("/build");
  await footer(page).getByRole("button", { name: /Continue/ }).click();
  await page.getByLabel("Bot name").fill("Draftly");
  await footer(page).getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("radio", { name: /Your own API key/ }).click();
  await page.getByLabel("API key").fill("sk-test-not-a-real-key-1234567890");
  await page.waitForTimeout(500);
  const draft = await page.evaluate(() => localStorage.getItem("bab-builder-v1") ?? "");
  expect(draft).toContain("Draftly");
  expect(draft).not.toContain("sk-test-not-a-real-key");

  await page.reload();
  await expect(page.getByText("Picked up where you left off")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose its brain" })).toBeVisible();
});

test("typing an API key and pressing Continue checks it and moves on in one click", async ({ page }) => {
  await page.goto("/build");
  await footer(page).getByRole("button", { name: /Continue/ }).click();
  await page.getByLabel("Bot name").fill("Keyed");
  await footer(page).getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("radio", { name: /Your own API key/ }).click();
  await page.getByRole("radio", { name: /Custom$/ }).click();
  // .invalid never resolves, so the demo server saves it without a live check (no network needed).
  await page.getByLabel("Base URL").fill("https://llm.example.invalid/v1");
  await page.getByLabel("Model").fill("my-model");
  await page.getByLabel("API key").fill("sk-test-not-a-real-key-1234567890");
  // The click blurs the key field, which starts a check; the click must wait for it, not get lost.
  await footer(page).getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByRole("heading", { name: "Give it your apps" })).toBeVisible({ timeout: 20_000 });
});

test("a recipe brings its apps, its jobs' tools and its routines along", async ({ page }) => {
  await page.goto("/r/meeting-buddy");
  await page.getByRole("link", { name: /Make this bot/ }).first().click();
  await expect(page.getByText(/Making your own/)).toBeVisible();
  await page.getByRole("button", { name: /Skip to the brain/ }).click();
  await footer(page).getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByRole("button", { name: /Meetings/ }).first()).toHaveAttribute("aria-pressed", "true");
  for (const app of ["Meeting notes", "Google Calendar", "Notion", "Notes & lists"]) {
    await expect(page.getByRole("button", { name: `Remove ${app}` })).toBeVisible();
  }
  await footer(page).getByRole("button", { name: /Continue/ }).click();
  await footer(page).getByRole("button", { name: /Continue/ }).click();
  // The recipe talks by email, and an email address is the one thing a recipe can't bring.
  await page.getByLabel("Your email").fill("owner@example.com");
  await footer(page).getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByRole("heading", { name: "Ready to meet Otto?" })).toBeVisible();
  await expect(page.getByText("Routines from the recipe")).toBeVisible();
  await expect(page.getByText("Friday follow-ups")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Morning brief" })).not.toBeChecked();
  await page.getByText("I'm 18 or older").click();
  await footer(page).getByRole("button", { name: /Bring Otto to life/ }).click();
  await page.waitForURL(/\/app\/bots\/bot_/, { timeout: 30_000 });
  const botId = page.url().match(/bots\/(bot_[a-z0-9]+)/)![1];
  const { connections } = await (await page.request.get(`/api/bots/${botId}`)).json();
  const ids = connections.map((c: { connectorId: string }) => c.connectorId);
  for (const id of ["meetings", "google_calendar", "notion", "notes"]) expect(ids).toContain(id);
  const { schedules } = await (await page.request.get(`/api/bots/${botId}/schedules`)).json();
  expect(schedules.map((x: { title: string }) => x.title)).toEqual(["Friday follow-ups"]);
});

test("steps skipped with the step bar are still checked before the bot is made", async ({ page, isMobile }) => {
  test.skip(isMobile, "phones have no step bar to jump with");
  // Study buddy talks by text, so it needs a phone number, which a recipe can't bring.
  await page.goto("/build?recipe=study-buddy");
  await page.getByRole("navigation", { name: "Builder steps" }).getByRole("button", { name: /Go/ }).click();
  await expect(page.getByRole("heading", { name: "Ready to meet Sprout?" })).toBeVisible();
  await page.getByText("I'm 18 or older").click();
  await footer(page).getByRole("button", { name: /to life/ }).click();
  await expect(page.getByRole("heading", { name: "How do you want to talk?" })).toBeVisible();
  await expect(footer(page).getByText("Add your mobile number for texts and calls")).toBeVisible();
  await expect(page).toHaveURL(/\/build/);
});

test("the browser's Back and Forward move between builder steps", async ({ page }) => {
  await page.goto("/build");
  await footer(page).getByRole("button", { name: /Continue/ }).click();
  await page.getByLabel("Bot name").fill("Hopper");
  await footer(page).getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByRole("heading", { name: "Choose its brain" })).toBeVisible();
  await expect(page).toHaveURL(/\?step=brain$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Name it" })).toBeVisible();
  await expect(page.getByLabel("Bot name")).toHaveValue("Hopper");
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Choose its brain" })).toBeVisible();
  // A refresh keeps the step, and Back still goes one step back.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Choose its brain" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Name it" })).toBeVisible();
});
