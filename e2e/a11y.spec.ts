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
  for (const tab of ["", "/tools", "/channels", "/routines", "/activity", "/memory", "/settings"]) await scan(page, `/app/bots/${id}${tab}`);
  for (const path of ["/app/approvals", "/app/billing", "/app/bridge", "/app/account"]) await scan(page, path);
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
  for (const path of ["/", "/pricing", "/build", `/app/bots/${id}`, `/app/bots/${id}/tools`, `/app/bots/${id}/channels`, `/app/bots/${id}/settings`, "/app/billing", "/app/bridge"]) {
    await scan(page, path);
  }
});
