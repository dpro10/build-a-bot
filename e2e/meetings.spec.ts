/**
 * Meeting notes in the browser, end to end in demo mode: turn the app on, take notes
 * with Chromium's fake microphone (one microphone in the room), watch the scripted
 * transcript arrive, stop, read the notes, tick an action item, delete the meeting.
 *
 * The browser recorder only listens while its floating window (Document
 * Picture-in-Picture) is open; headless Chromium opens it like a real one, as a new page.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.use({
  launchOptions: {
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});

async function newBot(page: Page, name: string): Promise<string> {
  const res = await page.request.post("/api/bots", {
    data: {
      avatar: "otto",
      color: "grape",
      name,
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
  return (await res.json()).id as string;
}

/** Consent (first time), then "In person", then Start: returns the floating window. */
async function startInPerson(page: Page, context: BrowserContext) {
  await page.getByRole("button", { name: "Start taking notes" }).click();
  const consent = page.getByRole("dialog", { name: "Before I take notes on calls" });
  if (await consent.isVisible().catch(() => false)) {
    await expect(consent.getByRole("button", { name: "Got it" })).toBeDisabled();
    await consent.getByRole("checkbox").check();
    await consent.getByRole("button", { name: "Got it" }).click();
  }
  const sheet = page.getByRole("dialog", { name: "Take notes in this browser" });
  await sheet.getByRole("radio", { name: /In person/ }).click();
  await sheet.getByRole("button", { name: "Copy" }).click();
  await expect(sheet.getByRole("button", { name: "Copied" })).toBeVisible();
  const floating = context.waitForEvent("page");
  await sheet.getByRole("button", { name: "Start taking notes" }).click();
  const pip = await floating;
  await expect(page.getByRole("heading", { name: /is taking notes/ })).toBeVisible({ timeout: 20_000 });
  return pip;
}

test("take notes in the browser, then read, tick and delete them", async ({ page, context }) => {
  test.setTimeout(150_000);
  await context.grantPermissions(["microphone"]);
  const id = await newBot(page, "Inky");

  await page.goto(`/app/bots/${id}/meetings`);
  await expect(page.getByRole("heading", { name: "Meetings", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Turn on meeting notes" }).click();
  await expect(page.getByRole("button", { name: "Start taking notes" })).toBeEnabled();

  const pip = await startInPerson(page, context);
  // The floating bot is on screen the whole time it listens.
  await expect(pip.getByText("Taking notes", { exact: true })).toBeVisible();

  // Demo transcription: one scripted line per 6-second piece of audio.
  const live = page.getByLabel("Live transcript");
  await expect(live.getByText(/Okay, thanks everyone for joining/)).toBeVisible({ timeout: 30_000 });
  await expect(live.getByText(/Sam, can you have the new signup screens ready/)).toBeVisible({ timeout: 30_000 });
  await expect(live.getByText("Room").first()).toBeVisible();

  await page.getByRole("button", { name: "Stop and write notes" }).first().click();
  await expect(page).toHaveURL(/\/meetings\/mtg_/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Launch plan for the new onboarding" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Went through the launch plan/)).toBeVisible();

  // Action items: tick one, and it sticks.
  const item = page.getByRole("checkbox", { name: /get the new signup screens ready/i });
  await item.check();
  await expect(page.getByText(/^1 of \d+ done$/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /get the new signup screens ready/i })).toBeChecked();

  // The transcript is searchable.
  await page.getByLabel("Search the transcript").fill("thursday");
  await expect(page.getByText(/1 line match/)).toBeVisible();

  // The notes also landed in chat, with a link back here.
  await page.goto(`/app/bots/${id}`);
  await expect(page.getByText("Meeting notes", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Open notes/ }).click();
  await expect(page.getByRole("heading", { name: "Launch plan for the new onboarding" })).toBeVisible();

  // Delete it.
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitem", { name: "Delete meeting" }).click();
  await page.getByRole("dialog", { name: "Delete this meeting?" }).getByRole("button", { name: "Delete meeting" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/bots/${id}/meetings$`));
  await expect(page.getByText("No meetings yet")).toBeVisible();
});

test("stop and delete throws away everything from the call", async ({ page, context }) => {
  test.setTimeout(90_000);
  await context.grantPermissions(["microphone"]);
  const id = await newBot(page, "Blip");
  await page.request.post(`/api/bots/${id}/connections`, { data: { connectorId: "meetings" } });
  await page.goto(`/app/bots/${id}/meetings`);

  await startInPerson(page, context);
  await page.getByRole("button", { name: "Stop and delete", exact: true }).click();
  await page.getByRole("dialog", { name: "Stop and delete everything?" }).getByRole("button", { name: "Stop and delete", exact: true }).click();
  await expect(page.getByText("Stopped and deleted. Nothing from this call was kept.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Start taking notes" })).toBeVisible();
  const list = await (await page.request.get(`/api/bots/${id}/meetings`)).json();
  expect(list.meetings).toEqual([]);
});

test("browsers that can't keep the bot on screen don't record", async ({ page }) => {
  // Like Safari: no Document Picture-in-Picture.
  await page.addInitScript(() => {
    try {
      delete (Window.prototype as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture;
    } catch {
      /* not configurable */
    }
    Object.defineProperty(window, "documentPictureInPicture", { value: undefined, configurable: true });
  });
  const id = await newBot(page, "Nimbus");
  await page.request.post(`/api/bots/${id}/connections`, { data: { connectorId: "meetings" } });
  await page.goto(`/app/bots/${id}/meetings`);
  await expect(page.getByText(/Use Chrome or Edge on a computer, or the desktop app/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start taking notes" })).toBeDisabled();
});
