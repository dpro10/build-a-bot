/**
 * Meeting notes on the website, end to end in demo mode. Notes are taken in the desktop app, which
 * hears the call on the owner's computer (NVIDIA Parakeet) and sends only the lines; here a paired
 * computer's token stands in for the app. The website shows the meetings and their notes, can stop
 * a recording, and can't record itself.
 */
import { expect, test, type Page } from "@playwright/test";

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

/** Pair a "computer" the way the desktop app does; returns its device token's header. */
async function pairComputer(page: Page): Promise<Record<string, string>> {
  const code = await page.request.post("/api/bridge/pairing-code");
  expect(code.ok()).toBeTruthy();
  const paired = await page.request.post("/api/bridge/pair", { data: { code: (await code.json()).code, name: "Dana's Mac", platform: "desktop-darwin-arm64" } });
  expect(paired.ok()).toBeTruthy();
  return { authorization: `Bearer ${(await paired.json()).token}` };
}

/** What the app heard in each 20-second piece of the call ("mic" is the owner, "system" everyone else). */
const PIECES: { track: "mic" | "system"; chunk: number; heard: { startMs: number; endMs: number; text: string }[] }[] = [
  { track: "mic", chunk: 0, heard: [{ startMs: 400, endMs: 4200, text: "Thanks for joining, everyone. Let's go through the launch plan for the new onboarding." }] },
  { track: "system", chunk: 0, heard: [{ startMs: 5000, endMs: 9800, text: "Quick update first: the beta has about two hundred people now." }] },
  { track: "mic", chunk: 1, heard: [{ startMs: 1000, endMs: 6000, text: "Sam, can you have the new signup screens ready by Thursday?" }] },
  { track: "system", chunk: 1, heard: [{ startMs: 7000, endMs: 12_000, text: "Sure. I'll send the release notes by Friday." }] },
];

test("the Meetings tab gets you the desktop app; the website itself doesn't record", async ({ page }) => {
  const id = await newBot(page, "Inky");
  await page.goto(`/app/bots/${id}/meetings`);
  await expect(page.getByRole("heading", { name: "Meetings", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Turn on meeting notes" }).click();
  await expect(page.getByRole("heading", { name: /The desktop app/ })).toBeVisible();
  await expect(page.getByText(/turns the call into text right on your computer/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Get the desktop app/ })).toHaveAttribute("href", "/app/bridge#desktop");
  // Nothing on the page records.
  await expect(page.getByRole("button", { name: /Start taking notes/ })).toHaveCount(0);
  const start = await page.request.post(`/api/bots/${id}/meetings`, { data: { app: "zoom" } });
  expect(start.status()).toBe(403);
  expect(await start.json()).toMatchObject({ code: "app_only", error: "Meeting notes are taken in the desktop app." });
});

test("a meeting the desktop app heard: live transcript, stopped from the website, notes, tick, search, chat, delete", async ({ page }) => {
  test.setTimeout(120_000);
  const id = await newBot(page, "Inky");
  expect((await page.request.post(`/api/bots/${id}/connections`, { data: { connectorId: "meetings" } })).ok()).toBeTruthy();
  const app = await pairComputer(page);
  const started = await page.request.post(`/api/bots/${id}/meetings`, { headers: app, data: { app: "zoom" } });
  expect(started.status()).toBe(201);
  const { meeting } = await started.json();

  // The Meetings tab shows the app is taking notes, and opens it.
  await page.goto(`/app/bots/${id}/meetings`);
  await expect(page.getByText("Inky is taking notes with the desktop app")).toBeVisible();
  await page.getByRole("link", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/meetings/${meeting.id}$`));

  // The lines come in as the app hears them, and show up live.
  for (const p of PIECES) {
    const res = await page.request.post(`/api/bots/${id}/meetings/${meeting.id}/audio?track=${p.track}&chunk=${p.chunk}&startMs=${p.chunk * 20_000}&durationMs=20000`, {
      headers: app,
      data: { heard: p.heard },
    });
    expect(res.ok()).toBeTruthy();
  }
  await expect(page.getByText(/the beta has about two hundred people/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Sam, can you have the new signup screens ready/)).toBeVisible();

  // Stopped from the website: the notes get written.
  await page.getByRole("button", { name: "Stop and write notes" }).first().click();
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
