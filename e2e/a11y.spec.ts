/**
 * Accessibility: no serious or critical axe violations on the main pages,
 * signed out and signed in (WCAG 2.2 A/AA rules).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function scan(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" });
  await scanHere(page, path);
}

/** Scan the page as it is now (after letting entrance animations finish). */
async function scanHere(page: Page, path: string) {
  // Resting state: no button left hovered by the last click.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(600);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    // Toasts and the dev-tools button are not part of the page.
    .exclude("[data-sonner-toaster]")
    .exclude("nextjs-portal")
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n  ")}`).join("\n");
  expect(serious, `${path}\n${report}`).toEqual([]);
}

test("public pages", async ({ page }) => {
  for (const path of ["/", "/pricing", "/safety", "/explore", "/login", "/build"]) await scan(page, path);
});

test("dashboard pages", async ({ page }) => {
  const res = await page.request.post("/api/bots", {
    data: {
      avatar: "nimbus",
      color: "sky",
      name: "Ally",
      jobs: ["inbox", "reminders"],
      brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: ["gmail"],
      trust: "ask",
      channels: ["telegram"],
      contact: {},
      ageConfirmed: true,
      timezone: "UTC",
    },
  });
  const { id } = await res.json();
  // A request by voice with text the owner selected, so the chat shows one. It comes from the
  // desktop app: a computer paired the way the app does it.
  const code = await (await page.request.post("/api/bridge/pairing-code")).json();
  const { token } = await (await page.request.post("/api/bridge/pair", { data: { code: code.code, name: "Ally's Mac", platform: "desktop-darwin-arm64" } })).json();
  const asked = await page.request.post("/api/voice/ask", {
    headers: { authorization: `Bearer ${token}` },
    data: { botId: id, text: "Remind me about this tomorrow at 9.", selection: "Team lunch Friday at 12:30." },
  });
  expect(asked.ok()).toBeTruthy();
  await asked.text();
  for (const tab of ["", "/meetings", "/tools", "/channels", "/routines", "/activity", "/memory", "/settings"]) await scan(page, `/app/bots/${id}${tab}`);
  for (const path of ["/app/approvals", "/app/billing", "/app/voice", "/app/desktop", "/app/account"]) await scan(page, path);
});

test("meeting notes pages", async ({ page }) => {
  const res = await page.request.post("/api/bots", {
    data: {
      avatar: "otto",
      color: "grape",
      name: "Inky",
      jobs: ["reminders"],
      brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: ["meetings"],
      trust: "ask",
      channels: [],
      contact: {},
      ageConfirmed: true,
      timezone: "America/Chicago",
    },
  });
  const { id } = await res.json();
  await page.request.post(`/api/bots/${id}/connections`, { data: { connectorId: "meetings" } });
  // Taken the way the desktop app does: a paired computer sends the lines it heard.
  const code = await (await page.request.post("/api/bridge/pairing-code")).json();
  const paired = await (await page.request.post("/api/bridge/pair", { data: { code: code.code, name: "Dana's Mac", platform: "desktop-darwin-arm64" } })).json();
  const app = { authorization: `Bearer ${paired.token}` };
  const started = await page.request.post(`/api/bots/${id}/meetings`, { headers: app, data: { app: "zoom" } });
  const { meeting } = await started.json();
  const lines = [
    "Thanks for joining. Let's go through the launch plan.",
    "Quick update first: the beta has about two hundred people now.",
    "Sam, can you have the new signup screens ready by Thursday?",
  ];
  for (const [i, [track, chunk]] of ([["mic", 0], ["system", 0], ["mic", 1]] as const).entries()) {
    await page.request.post(`/api/bots/${id}/meetings/${meeting.id}/audio?track=${track}&chunk=${chunk}&startMs=${chunk * 20_000}&durationMs=20000`, {
      headers: app,
      data: { heard: [{ startMs: 1000, endMs: 5000, text: lines[i] }] },
    });
  }
  await page.request.post(`/api/bots/${id}/meetings/${meeting.id}/finish`);
  await expect.poll(async () => (await (await page.request.get(`/api/bots/${id}/meetings/${meeting.id}`)).json()).meeting.status, { timeout: 30_000 }).toBe("ready");
  for (const path of [`/app/bots/${id}/meetings`, `/app/bots/${id}/meetings/${meeting.id}`, `/app/bots/${id}`]) await scan(page, path);
  for (const phase of ["asking", "listening", "done"]) await scan(page, `/desktop/buddy?phase=${phase}&app=zoom&elapsed=754&caption=Others:Hi%20there`);
});

test("dark mode", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("bab-theme", "dark"));
  const res = await page.request.post("/api/bots", {
    data: {
      avatar: "ember",
      color: "coral",
      name: "Night",
      jobs: ["inbox"],
      brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: ["gmail", "slack"],
      trust: "trusted",
      channels: ["telegram"],
      contact: {},
      ageConfirmed: true,
      timezone: "UTC",
    },
  });
  const { id } = await res.json();
  // A request by voice with selected text: the quote in the owner's bubble is checked in dark too.
  await (await page.request.post("/api/voice/ask", { data: { botId: id, text: "Remind me about this tomorrow at 9.", selection: "Team lunch Friday at 12:30." } })).text();
  for (const path of ["/", "/pricing", "/safety", "/build", `/app/bots/${id}`, `/app/bots/${id}/meetings`, `/app/bots/${id}/tools`, `/app/bots/${id}/channels`, `/app/bots/${id}/settings`, "/app/billing", "/app/desktop"]) {
    await scan(page, path);
  }
});

/** Walks the whole builder, opening the parts that only show after a choice, and scans every step. */
async function scanBuilder(page: Page, theme: string) {
  const next = () => page.getByRole("contentinfo").getByRole("button", { name: /Continue/ }).click();
  await page.goto("/build", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /Otto/ }).click();
  await scanHere(page, `${theme} build: face`);
  await next();
  await page.getByLabel("Bot name").fill("Inky");
  await scanHere(page, `${theme} build: name`);
  await next();
  await scanHere(page, `${theme} build: brain (included)`);
  await page.getByRole("radio", { name: /Your own API key/ }).click();
  await scanHere(page, `${theme} build: brain (own key)`);
  await page.getByRole("radio", { name: /Open models on Nebius/ }).click();
  await next();
  await page.getByRole("button", { name: /Meetings/ }).first().click();
  await scanHere(page, `${theme} build: apps`);
  await next();
  await page.getByRole("radio", { name: /Full faith/ }).click();
  await scanHere(page, `${theme} build: trust`);
  await next();
  await page.getByRole("button", { name: /Text messages/ }).click();
  await page.getByRole("button", { name: /^Email/ }).click();
  await page.getByRole("button", { name: /WhatsApp/ }).click();
  await page.getByLabel("Your mobile number").fill("+1 512 555 0123");
  await page.getByLabel("Your email").fill("owner@example.com");
  await scanHere(page, `${theme} build: channels`);
  await next();
  await page.getByText("I'm 18 or older").click();
  await scanHere(page, `${theme} build: review`);
  // No sideways scrolling on any step (checked here on the last one; phones run this too).
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test("every builder step, light", async ({ page }) => {
  await scanBuilder(page, "light");
});

test("every builder step, dark", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("bab-theme", "dark"));
  await scanBuilder(page, "dark");
});
