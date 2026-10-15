/**
 * Voice typing on the web, end to end in demo mode (no speech-to-text key: the demo "hears"
 * sample sentences): the Voice typing page, holding the mic to talk with Chromium's fake
 * microphone, clicking for hands-free, "Hey Otto" asking the bot, the dictionary, and the
 * landing and pricing pages telling people about it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/** The demo's sample lines, as typed (src/lib/dictation/demo.ts). */
const TYPED = [
  "I was thinking we could move the team meeting to Friday at 3.",
  "Hey, can you send me the slides from yesterday's call?\nThanks so much!",
  "I'll pick up eggs, milk and bread on the way home. Should be there around 6:30.",
  "Quick update: the beta has about 200 people and the feedback is mostly positive.",
];

/** A steady, voice-like sound for the fake microphone (Chromium's own only beeps once a second). */
function toneWav(): string {
  const file = path.join(os.tmpdir(), "bab-voice-tone.wav");
  const rate = 48000;
  const n = rate * 6;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const v = 0.3 * (0.55 + 0.45 * Math.sin(2 * Math.PI * 3 * t)) * (Math.sin(2 * Math.PI * 180 * t) + 0.4 * Math.sin(2 * Math.PI * 360 * t));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
  return file;
}

test.use({
  launchOptions: {
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${toneWav()}`],
  },
});

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

const typedOne = (value: string) => TYPED.some((t) => value.includes(t));

test("talk in the browser: hold to type, click for hands-free, and ask your bot", async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["microphone"]);
  const id = await newBot(page, "Otto");

  await page.goto("/app/voice");
  await expect(page.getByRole("heading", { name: "Voice typing", level: 1 })).toBeVisible();
  await expect(page.getByText("It doesn't hear you yet: it types sample sentences.")).toBeVisible();
  const box = page.getByLabel("Try it here");
  const mic = page.getByRole("button", { name: /Hold to talk/ });

  // Hold to talk.
  await mic.hover();
  await page.mouse.down();
  await expect(page.getByText("Listening. Let go to type it.")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await expect.poll(async () => typedOne(await box.inputValue()), { timeout: 20_000 }).toBe(true);
  await expect(page.getByText("You said", { exact: true })).toBeVisible();
  await expect(page.getByText("It typed", { exact: true })).toBeVisible();
  const first = await box.inputValue();

  // Click once to keep listening, click again to finish: the words land after the first ones.
  await mic.click();
  await expect(page.getByText("Listening. Click to finish.")).toBeVisible();
  await page.waitForTimeout(1300);
  await page.getByRole("button", { name: "Finish and type it" }).click();
  await expect.poll(async () => (await box.inputValue()).length, { timeout: 20_000 }).toBeGreaterThan(first.length + 10);
  expect((await box.inputValue()).startsWith(first)).toBe(true);
  await expect(page.getByText(/^\d+ of 8,000 words this month$/)).toBeVisible();

  // "Hey Otto, …" goes to the bot, and lands in its chat.
  await page.getByRole("button", { name: "Try “Hey Otto”" }).click();
  await expect(page.getByText("“Remind me to call Mom tomorrow at 5.”")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: /It's in your chat with Otto/ })).toBeVisible({ timeout: 30_000 });
  const chat = await (await page.request.get(`/api/bots/${id}/messages`)).json();
  expect(chat.messages.some((m: { role: string; text: string; meta?: { via?: string } }) => m.role === "user" && m.meta?.via === "voice")).toBe(true);
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

  // Signed out, "Try voice typing" goes to sign-in, which then comes back to the Voice typing page.
  await page.goto("/");
  await page.getByRole("link", { name: "Try voice typing" }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fvoice$/);
  await page.getByLabel("Email").fill(`voice-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Email me a magic link" }).click();
  await page.getByRole("link", { name: "Open the sign-in link" }).click();
  await expect(page).toHaveURL(/\/app\/voice$/);
  await expect(page.getByRole("heading", { name: "Voice typing", level: 1 })).toBeVisible();
});
