/**
 * The plan's routine limit holds when a routine is switched back on, not only when
 * one is created (outside demo mode, where plans are enforced).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "0";
delete process.env.DATABASE_URL;

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => session.user,
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const route = await import("@/app/api/bots/[botId]/schedules/[scheduleId]/route");

let db: Awaited<ReturnType<typeof getDb>>;

const patch = (botId: string, scheduleId: string, body: unknown) =>
  route.PATCH(new Request(`http://localhost/api/bots/${botId}/schedules/${scheduleId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ botId, scheduleId }),
  });

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("routine limit", () => {
  it("switching a routine back on counts against the plan", async () => {
    const [owner] = await db.insert(schema.users).values({ id: "usr_free", email: "free@example.com", emailVerifiedAt: new Date(), timezone: "UTC", plan: "free" }).returning();
    session.user = owner;
    await db.insert(schema.bots).values({ id: "bot_free", ownerId: owner.id, name: "Freebie", avatar: "blip", color: "grape", handle: "freebie-x1", brain: { kind: "included", provider: "nebius", model: "x" } });
    const routine = (id: string, active: boolean) => ({
      id,
      botId: "bot_free",
      kind: "routine",
      title: id,
      prompt: "Say hi.",
      schedule: { type: "daily" as const, time: "08:00" },
      timezone: "UTC",
      active,
      nextRunAt: active ? new Date(Date.now() + 3600_000) : null,
    });
    // Free includes 2 routines: two on, one off.
    await db.insert(schema.schedules).values([routine("sch_a", true), routine("sch_b", true), routine("sch_c", false)]);

    const over = await patch("bot_free", "sch_c", { active: true });
    expect(over.status).toBe(402);

    // Turning one off makes room.
    expect((await patch("bot_free", "sch_a", { active: false })).status).toBe(200);
    const ok = await patch("bot_free", "sch_c", { active: true });
    expect(ok.status).toBe(200);
    expect((await ok.json()).schedule.active).toBe(true);
  });
});
