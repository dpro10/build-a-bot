/**
 * What the site claims matches what it does. Here (as on build-a-bot.site) the server has no
 * speech-to-text, so the audio of voice typing and meeting notes never leaves the computer; the
 * bot can hide for a screen share, so it doesn't promise to stay on screen; the chat has no
 * microphone; and calls show what they're charged.
 */
import { expect, test } from "@playwright/test";

test("the landing page says what thinks, above the fold and in its description", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/give it your apps and a brain: NVIDIA Nemotron and other open models on Nebius, at cost/)).toBeVisible();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /NVIDIA Nemotron and other open models on Nebius/);
  // Meeting notes: you can always see it's listening (it can hide for a screen share).
  await expect(page.getByText("You can see it's listening", { exact: true })).toBeVisible();
  await expect(page.getByText(/whole time it listens|stays on your screen the whole/)).toHaveCount(0);
});

test("the safety page and the privacy policy describe the audio, your files and calls as they are", async ({ page }) => {
  await page.goto("/safety");
  await expect(page.getByText("You can always see it's listening.", { exact: true })).toBeVisible();
  await expect(page.getByText("The audio stays on your computer.")).toBeVisible();
  await expect(page.getByText(/website never listens/)).toHaveCount(0);

  await page.goto("/legal/privacy");
  await expect(page.getByText("The audio never reaches our servers.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your files", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Calls", exact: true })).toBeVisible();
  await expect(page.getByText(/Calls with your bot aren.t recorded/)).toBeVisible();
  // No speech-to-text service here, so none is listed; nothing that's never called is listed either.
  await expect(page.getByText(/Speech-to-text:/)).toHaveCount(0);
  await expect(page.getByText("Google News")).toHaveCount(0);
});

test("pricing shows each kind of call at the price it's charged", async ({ page }) => {
  await page.goto("/pricing");
  const calls = page.getByRole("region", { name: "Texts and calls" });
  await expect(calls.getByRole("listitem").filter({ hasText: "A call to your bot" }).getByText("$0.0129")).toBeVisible();
  await expect(calls.getByRole("listitem").filter({ hasText: "A call your bot makes to you" }).getByText("$0.02")).toBeVisible();
  await expect(page.getByText(/cost exactly what the services charge/)).toHaveCount(0);
});

test("the web chat has no microphone: voice typing lives in the desktop app", async ({ page }) => {
  const res = await page.request.post("/api/bots", {
    data: {
      avatar: "otto",
      color: "mint",
      name: "Quill",
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
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/app/bots/${id}`);
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Dictate/ })).toHaveCount(0);
});
