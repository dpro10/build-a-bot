/**
 * The Activity receipt for a settings change names what changed ("Keep transcripts: 30 days"),
 * not the group it was saved in ("Settings changed: limits").
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, desc, eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
delete process.env.DATABASE_URL;

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => session.user,
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { settingsChange } = await import("@/lib/bots/labels");
const botRoute = await import("@/app/api/bots/[botId]/route");

let db: Awaited<ReturnType<typeof getDb>>;

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("settings receipts", () => {
  it("one limit: what it's set to now", () => {
    expect(settingsChange({ limits: { transcriptDays: 30 } }, {})).toEqual({ title: "Keep transcripts: 30 days", changed: ["transcriptDays"] });
    expect(settingsChange({ limits: { transcriptDays: null } }, { transcriptDays: 30 }).title).toBe("Keep transcripts: forever");
    expect(settingsChange({ limits: { dailyActions: 5 } }, {}).title).toBe("Actions per day: 5");
  });

  it("the Limits card saves them all together; only the ones that changed are named", () => {
    // The spending cap was off and stays off (0 and unset are the same).
    expect(settingsChange({ limits: { spendCapUsd: 0, quietHours: { start: "22:00", end: "07:30" } } }, {})).toEqual({
      title: "Quiet hours: 10 PM to 7:30 AM",
      changed: ["quietHours"],
    });
    expect(settingsChange({ limits: { spendCapUsd: 25, quietHours: null } }, { quietHours: { start: "22:00", end: "07:00" } })).toEqual({
      title: "Settings changed: spending cap, quiet hours",
      changed: ["spendCapUsd", "quietHours"],
    });
  });

  it("other settings keep their own names", () => {
    expect(settingsChange({ trust: "trusted" }, {}).title).toBe("Settings changed: trust level");
    expect(settingsChange({ name: "Inky", limits: { dailyActions: 5 } }, {})).toEqual({ title: "Settings changed: name, actions per day", changed: ["name", "dailyActions"] });
  });

  it("changing “Keep transcripts” logs a receipt that says so", async () => {
    const [owner] = await db.insert(schema.users).values({ id: "usr_settings", email: "s@example.com", emailVerifiedAt: new Date(), timezone: "UTC" }).returning();
    session.user = owner;
    await db.insert(schema.bots).values({ id: "bot_settings", ownerId: owner.id, name: "Inky", avatar: "otto", color: "grape", handle: "inky-s1", brain: { kind: "included", provider: "nebius", model: "x" } });
    const res = await botRoute.PATCH(
      new Request("http://localhost/api/bots/bot_settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ limits: { transcriptDays: 30 } }) }),
      { params: Promise.resolve({ botId: "bot_settings" }) },
    );
    expect(res.status).toBe(200);
    const [latest] = await db
      .select()
      .from(schema.receipts)
      .where(and(eq(schema.receipts.botId, "bot_settings"), eq(schema.receipts.kind, "system")))
      .orderBy(desc(schema.receipts.createdAt))
      .limit(1);
    expect(latest.title).toBe("Keep transcripts: 30 days");
    expect(latest.detail).toMatchObject({ changed: ["transcriptDays"] });
  });
});
