/**
 * Voice typing's web side, end to end in demo mode. Voice typing itself happens in the desktop app
 * (like Wispr Flow): the Voice typing page explains it, gets you the app and pairs it, and keeps
 * your words; the website never listens, and its voice endpoints answer only the app. Also: asking
 * the bot by voice, as the app does, shows in the chat with the text that was selected; and the
 * landing and pricing pages tell people about it.
 */
import { expect, test, type Page } from "@playwright/test";

async function newBot(page: Page, name: string): Promise<string> {
  const res = await page.request.post("/api/bots", {
    data: {
      avatar: "otto",
      color: "mint",
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

/** Pairs a computer the way the desktop app does (a code from the page, then the app redeems it): its token. */
async function pairComputer(page: Page): Promise<string> {
  const code = await page.request.post("/api/bridge/pairing-code");
  expect(code.ok()).toBeTruthy();
  const paired = await page.request.post("/api/bridge/pair", { data: { code: (await code.json()).code, name: "Dana's Mac", platform: "desktop-darwin-arm64" } });
  expect(paired.ok()).toBeTruthy();
  return (await paired.json()).token as string;
}

test("the Voice typing page gets you the desktop app; the website itself doesn't listen", async ({ page }) => {
  await newBot(page, "Otto");
  await page.goto("/app/voice");
  await expect(page.getByRole("heading", { name: "Voice typing", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Get the desktop app" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pair this computer" })).toBeVisible();
  await expect(page.getByText("Right Option (⌥)")).toBeVisible();
  // No microphone on the page, and nothing for it to listen with.
  await expect(page.getByRole("button", { name: /Hold to talk/ })).toHaveCount(0);
  await expect(page.getByText("Try it here")).toHaveCount(0);
  const talk = await page.request.post("/api/voice/dictate?durationMs=2000", { headers: { "content-type": "application/json" }, data: { heard: "Test, test, test." } });
  expect(talk.status()).toBe(403);
  expect(await talk.json()).toMatchObject({ code: "app_only", error: "Voice typing works in the desktop app." });
});

test("asking the bot about selected text, from the app: the chat shows it with the request", async ({ page }) => {
  const id = await newBot(page, "Otto");
  const token = await pairComputer(page);
  const res = await page.request.post("/api/voice/ask", {
    headers: { authorization: `Bearer ${token}` },
    data: { botId: id, text: "Remind me about this tomorrow at 9.", selection: "Team lunch Friday at 12:30 at Tartine." },
  });
  expect(res.ok()).toBeTruthy();
  await res.text();
  await page.goto(`/app/bots/${id}`);
  await expect(page.getByText("Remind me about this tomorrow at 9.")).toBeVisible();
  await expect(page.getByText("With the text you selected")).toBeVisible();
  await expect(page.getByText("Team lunch Friday at 12:30 at Tartine.")).toBeVisible();
});

test("your words: add one with how it's misheard, and it's used", async ({ page }) => {
  await newBot(page, "Blip");
  await page.goto("/app/voice#dictionary");
  const words = page.getByRole("list", { name: "Your words" });
  await page.getByLabel("Word", { exact: true }).fill("Friday");
  await page.getByLabel("It writes instead (optional)").fill("Thursday");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(words.getByText("Friday")).toBeVisible();
  await expect(words.getByText("(not “Thursday”)")).toBeVisible();

  await page.getByLabel("When I say").fill("my booking link");
  await page.getByLabel("Type this").fill("https://cal.com/dana");
  await page.getByRole("button", { name: "Add snippet" }).click();
  await expect(page.getByRole("list", { name: "Your snippets" }).getByText("https://cal.com/dana")).toBeVisible();

  // Saved to the account (the desktop app uses the same list).
  await page.reload();
  await expect(page.getByRole("list", { name: "Your words" }).getByText("Friday")).toBeVisible();
  const list = await (await page.request.get("/api/voice/dictionary")).json();
  expect(list.entries.map((e: { text: string }) => e.text).sort()).toEqual(["Friday", "https://cal.com/dana"]);

  await page.getByRole("button", { name: "Remove Friday" }).click();
  await expect(page.getByRole("list", { name: "Your words" }).getByText("Friday")).toHaveCount(0);
});

test("the site tells people about it", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Talk instead of type. In any app." })).toBeVisible();
  await expect(page.getByText("8,000 words a month free. Unlimited on Plus and Pro.")).toBeVisible();
  await page.goto("/pricing");
  await expect(page.getByText("Unlimited voice typing").first()).toBeVisible();
  await expect(page.getByText("8,000 words of voice typing a month").first()).toBeVisible();

  // Signed out, "Get the desktop app" goes to sign-in, which then comes back to the Voice typing page.
  await page.goto("/");
  await page.getByRole("link", { name: "Get the desktop app" }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fvoice$/);
  await page.getByLabel("Email").fill(`voice-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Email me a magic link" }).click();
  await page.getByRole("link", { name: "Open the sign-in link" }).click();
  await expect(page).toHaveURL(/\/app\/voice$/);
  await expect(page.getByRole("heading", { name: "Voice typing", level: 1 })).toBeVisible();
});
