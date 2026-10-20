/**
 * Dashboard details that are easy to break: STOP typed in chat shows up in the header
 * right away, routines stay in place when switched off, the phone menu behaves like
 * a dialog, and the desktop app's pairing code fits on a phone.
 */
import { expect, test, type Page } from "@playwright/test";

async function newBot(page: Page, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await page.request.post("/api/bots", {
    data: {
      avatar: "sprout",
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
      ...extra,
    },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).id as string;
}

test("STOP and START typed in chat show in the header right away", async ({ page }) => {
  const id = await newBot(page, "Sage");
  await page.goto(`/app/bots/${id}`);
  const box = page.getByLabel("Message");
  await expect(page.getByRole("button", { name: "Stop everything" })).toBeVisible();

  await box.fill("stop");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/Paused\. I've stopped everything/)).toBeVisible({ timeout: 20_000 });
  // Well before the chat's regular check-in (every few seconds).
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible({ timeout: 3_000 });
  await expect(box).toHaveAttribute("placeholder", "Paused — say START to wake Sage");

  await box.fill("start");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("I'm back! What do you need?")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Stop everything" })).toBeVisible({ timeout: 3_000 });
});

test("a routine you switch off stays where it was", async ({ page }) => {
  const id = await newBot(page, "Rowan", { morningBrief: { time: "08:00" } });
  for (const [title, time] of [
    ["Evening wind-down", "21:30"],
    ["Lunch check-in", "12:15"],
  ] as const) {
    const res = await page.request.post(`/api/bots/${id}/schedules`, {
      data: { kind: "routine", title, prompt: `${title}: a short note.`, schedule: { type: "daily", time }, deliverOn: "auto" },
    });
    expect(res.ok()).toBeTruthy();
  }
  await page.goto(`/app/bots/${id}/routines`);
  const switches = page.getByRole("switch");
  await expect(switches).toHaveCount(3);
  const names = async () => (await switches.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""))).map((n) => n.replace(/: (on|off)$/, ""));
  const before = await names();

  await switches.first().click();
  await expect(page.getByText(`“${before[0]}” is off`)).toBeVisible();
  expect(await names()).toEqual(before);
  // Undo with the same switch: the same routine comes back on.
  await switches.first().click();
  await expect(page.getByText(`“${before[0]}” is on`)).toBeVisible();
  expect(await names()).toEqual(before);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the menu is a dialog: Escape closes it and focus goes back", async ({ page }) => {
    const id = await newBot(page, "Moss");
    await page.goto(`/app/bots/${id}`);
    const button = page.getByRole("button", { name: "Open menu" });
    await button.click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("link", { name: /Moss/ })).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();

    await button.click();
    await menu.getByRole("link", { name: "Approvals" }).click();
    await expect(page).toHaveURL(/\/app\/approvals$/);
    await expect(menu).toBeHidden();
  });

  test("a pairing code for the desktop app fits on the screen", async ({ page }) => {
    await newBot(page, "Fern");
    await page.goto("/app/bridge"); // the old address, which older desktop apps still open
    await expect(page).toHaveURL(/\/app\/desktop$/);
    await page.getByRole("button", { name: "Get a pairing code" }).first().click();
    await expect(page.getByText("Your pairing code")).toBeVisible();
    const [scrollWidth, clientWidth] = await page.locator("#app-scroll").evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});
