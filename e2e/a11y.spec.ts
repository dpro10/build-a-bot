/**
 * Accessibility: no serious or critical axe violations on the main pages,
 * signed out and signed in (WCAG 2.2 A/AA rules).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function scan(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" });
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
  for (const tab of ["", "/meetings", "/tools", "/channels", "/routines", "/activity", "/memory", "/settings"]) await scan(page, `/app/bots/${id}${tab}`);
  for (const path of ["/app/approvals", "/app/billing", "/app/bridge", "/app/account"]) await scan(page, path);
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
  const started = await page.request.post(`/api/bots/${id}/meetings`, { data: { app: "zoom" } });
  const { meeting } = await started.json();
  for (const [track, chunk] of [["mic", 0], ["system", 0], ["mic", 1]] as const) {
    await page.request.post(`/api/bots/${id}/meetings/${meeting.id}/audio?track=${track}&chunk=${chunk}&startMs=${chunk * 6000}&durationMs=6000`, {
      headers: { "content-type": "audio/webm" },
      data: Buffer.alloc(4000),
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
  for (const path of ["/", "/pricing", "/safety", "/build", `/app/bots/${id}`, `/app/bots/${id}/meetings`, `/app/bots/${id}/tools`, `/app/bots/${id}/channels`, `/app/bots/${id}/settings`, "/app/billing", "/app/bridge"]) {
    await scan(page, path);
  }
});
