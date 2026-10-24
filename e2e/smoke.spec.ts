/**
 * Every page renders without a server error or a client crash, signed out and
 * signed in (an anonymous demo user with one bot, made through the API).
 */
import { expect, test, type Page } from "@playwright/test";

async function visit(page: Page, path: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const res = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(res?.status(), `${path} status`).toBeLessThan(400);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error|Unhandled Runtime Error/);
  expect(errors, `${path} page errors`).toEqual([]);
}

/**
 * Turns on meeting notes and takes one the way the desktop app does (a paired computer sends the
 * lines it heard), then stops it. Returns the meeting id.
 */
async function recordMeeting(page: Page, botId: string): Promise<string> {
  expect((await page.request.post(`/api/bots/${botId}/connections`, { data: { connectorId: "meetings" } })).ok()).toBeTruthy();
  const code = await (await page.request.post("/api/bridge/pairing-code")).json();
  const paired = await (await page.request.post("/api/bridge/pair", { data: { code: code.code, name: "Dana's Mac", platform: "desktop-darwin-arm64" } })).json();
  const app = { authorization: `Bearer ${paired.token}` };
  const started = await page.request.post(`/api/bots/${botId}/meetings`, { headers: app, data: { app: "meet" } });
  expect(started.status()).toBe(201);
  const { meeting } = await started.json();
  const heard = await page.request.post(`/api/bots/${botId}/meetings/${meeting.id}/audio?track=mic&chunk=0&startMs=0&durationMs=20000`, {
    headers: app,
    data: { heard: [{ startMs: 500, endMs: 4000, text: "Let's go through the launch plan. Sam, can you send the release notes by Friday?" }] },
  });
  expect(heard.ok()).toBeTruthy();
  expect((await page.request.post(`/api/bots/${botId}/meetings/${meeting.id}/finish`)).ok()).toBeTruthy();
  await expect
    .poll(async () => (await (await page.request.get(`/api/bots/${botId}/meetings/${meeting.id}`)).json()).meeting.status, { timeout: 30_000 })
    .toBe("ready");
  return meeting.id as string;
}

test("public pages render", async ({ page }) => {
  for (const path of ["/", "/pricing", "/safety", "/explore", "/r/inbox-zero", "/legal/terms", "/legal/privacy", "/login", "/build"]) {
    await visit(page, path);
  }
  const missing = await page.goto("/this-page-does-not-exist");
  expect(missing?.status()).toBe(404);
});

test("a missing recipe gets one friendly 404 page, inside the site's header and footer", async ({ page }) => {
  const res = await page.goto("/r/no-such-recipe");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /eight arms/ })).toBeVisible();
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("contentinfo")).toHaveCount(1);
});

test("every public page has a share image", async ({ page }) => {
  for (const path of ["/", "/pricing", "/safety", "/explore", "/legal/terms", "/legal/privacy", "/r/meeting-buddy"]) {
    const html = await (await page.request.get(path)).text();
    const og = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
    const x = html.match(/<meta name="twitter:image" content="([^"]+)"/)?.[1];
    expect(og, `${path} og:image`).toBeTruthy();
    expect(x, `${path} twitter:image`).toBeTruthy();
    const img = await page.request.get(new URL(og!).pathname + new URL(og!).search);
    expect(img.status(), `${path} share image`).toBe(200);
    expect(img.headers()["content-type"]).toContain("image/png");
  }
});

test("the landing page leads to the builder", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /build your bot/i }).first().click();
  await expect(page).toHaveURL(/\/build/);
  await expect(page.getByRole("heading", { name: "Pick a face" })).toBeVisible();
});

test("a recipe link prefills the builder", async ({ page }) => {
  await page.goto("/build?recipe=inbox-zero");
  await expect(page.getByText(/Making your own/)).toBeVisible();
  await expect(page.getByRole("radio", { name: /Nimbus/ })).toHaveAttribute("aria-checked", "true");
});

test("every dashboard page renders for a signed-in owner", async ({ page }) => {
  const created = await page.request.post("/api/bots", {
    data: {
      avatar: "blip",
      color: "ocean",
      name: "Smokey",
      jobs: ["inbox", "calendar", "reminders"],
      brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: ["gmail", "google_calendar", "github"],
      trust: "trusted",
      channels: ["discord", "email"],
      contact: { email: "owner@example.com" },
      ageConfirmed: true,
      timezone: "America/New_York",
      morningBrief: { time: "08:00" },
    },
  });
  expect(created.ok()).toBeTruthy();
  const { id } = await created.json();
  for (const tab of ["", "/meetings", "/memory", "/memory?tab=files", "/tools", "/tools?tab=channels", "/routines", "/settings", "/settings?tab=activity"]) {
    await visit(page, `/app/bots/${id}${tab}`);
  }
  // The tabs that moved: their old addresses land on the new ones, query and all.
  for (const [from, to] of [
    ["/library", "/memory?tab=files"],
    ["/channels?slack=added", "/tools?tab=channels&slack=added"],
    ["/activity?tab=deliveries", "/settings?tab=activity&view=deliveries"],
  ]) {
    await page.goto(`/app/bots/${id}${from}`);
    await expect(page).toHaveURL(`/app/bots/${id}${to}`);
  }
  // A meeting: notes on, what the desktop app heard, stop; then the meeting page and the chat that got the notes.
  const meetingId = await recordMeeting(page, id);
  await visit(page, `/app/bots/${id}/meetings`);
  await visit(page, `/app/bots/${id}/meetings/${meetingId}`);
  await visit(page, `/app/bots/${id}`);
  for (const path of ["/app?all=1", "/app/approvals", "/app/billing", "/app/desktop", "/app/account"]) {
    await visit(page, path);
  }
});

test("the desktop app's meeting buddy renders in every phase", async ({ page }) => {
  for (const phase of ["asking", "listening", "paused", "saving", "done", "error"]) {
    await visit(page, `/desktop/buddy?phase=${phase}&app=zoom&elapsed=754&caption=Others:Hi%20there&message=Something%20went%20wrong`);
  }
});
