/**
 * The fair-use limit on routines (200 switched on, per bot; there are no plans) holds when a
 * routine is switched back on, not only when one is created (outside demo mode).
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
const { FAIR_USE } = await import("@/lib/billing/prices");
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
  it("switching a routine back on counts against the fair-use limit", async () => {
    expect(FAIR_USE.routines).toBe(200);
    const [owner] = await db.insert(schema.users).values({ id: "usr_busy", email: "busy@example.com", emailVerifiedAt: new Date(), timezone: "UTC" }).returning();
    session.user = owner;
    await db.insert(schema.bots).values({ id: "bot_busy", ownerId: owner.id, name: "Busybee", avatar: "blip", color: "grape", handle: "busybee-x1", brain: { kind: "included", provider: "nebius", model: "x" } });
    const routine = (id: string, active: boolean) => ({
      id,
      botId: "bot_busy",
      kind: "routine",
      title: id,
      prompt: "Say hi.",
      schedule: { type: "daily" as const, time: "08:00" },
      timezone: "UTC",
      active,
      nextRunAt: active ? new Date(Date.now() + 3600_000) : null,
    });
    // As many on as one bot can have, and one off.
    const on = Array.from({ length: FAIR_USE.routines }, (_, i) => routine(`sch_${i}`, true));
    await db.insert(schema.schedules).values([...on, routine("sch_off", false)]);

    const over = await patch("bot_busy", "sch_off", { active: true });
    expect(over.status).toBe(409);
    expect(await over.json()).toEqual({ error: "A bot can have up to 200 routines on. Turn one off to make room.", code: "fair_use" });

    // Turning one off makes room.
    expect((await patch("bot_busy", "sch_0", { active: false })).status).toBe(200);
    const ok = await patch("bot_busy", "sch_off", { active: true });
    expect(ok.status).toBe(200);
    expect((await ok.json()).schedule.active).toBe(true);
  });
});
