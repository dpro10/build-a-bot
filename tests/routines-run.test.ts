/**
 * A routine's result reaches the owner's web chat once: an owner with no other channel gets
 * exactly one message per run, from the scheduler and from "Run now" alike. With another channel
 * the result goes there too, still with one copy in the chat. A brain that fails is reported as
 * a failure, not as "the result is in your chat".
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, desc, eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
delete process.env.DATABASE_URL;
delete process.env.TOKEN_FACTORY_API_KEY;

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => session.user,
}));

// Switch on to make the (demo) brain fail the way a provider outage does.
const brain = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/llm/demo", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/llm/demo")>();
  const { LlmError } = await import("@/lib/llm/types");
  return {
    ...mod,
    createDemoProvider: () => {
      const real = mod.createDemoProvider();
      return {
        ...real,
        async *stream(req: Parameters<typeof real.stream>[0]) {
          if (brain.fail) throw new LlmError("upstream 503", 503, "unavailable");
          yield* real.stream(req);
        },
      };
    },
  };
});

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { runDueSchedules } = await import("@/lib/scheduler/tick");
const runRoute = await import("@/app/api/bots/[botId]/schedules/[scheduleId]/run/route");
import type { Bot, User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;

async function botWithBrief(name: string, brainInput: Parameters<typeof createBot>[2]["brain"] = { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" }) {
  const res = await createBot(db, owner, {
    avatar: "blip",
    color: "ocean",
    name,
    jobs: ["reminders"],
    brain: brainInput,
    connectors: [],
    trust: "ask",
    channels: [],
    contact: {},
    ageConfirmed: true,
    timezone: "America/Chicago",
    morningBrief: { time: "08:00" },
  });
  if (!res.ok) throw new Error(res.error);
  const [brief] = await db.select().from(schema.schedules).where(eq(schema.schedules.botId, res.bot.id));
  expect(brief.title).toBe("Morning brief");
  return { bot: res.bot, brief };
}

/** What the bot has said in its owner's web chat. */
async function chat(bot: Bot) {
  return db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.botId, bot.id), eq(schema.messages.channelKind, "web"), eq(schema.messages.role, "assistant")));
}

/** Messages the bot has said in the chat since `before`. */
async function newInChat(bot: Bot, before: { id: string }[]) {
  const seen = new Set(before.map((m) => m.id));
  return (await chat(bot)).filter((m) => !seen.has(m.id));
}

async function deliveries(bot: Bot) {
  return db.select().from(schema.deliveries).where(eq(schema.deliveries.botId, bot.id));
}

/** Due now, so the scheduler picks it up. */
async function makeDue(brief: { id: string }) {
  await db.update(schema.schedules).set({ nextRunAt: new Date(Date.now() - 60_000), active: true }).where(eq(schema.schedules.id, brief.id));
}

const runNow = (botId: string, scheduleId: string) =>
  runRoute.POST(new Request(`http://localhost/api/bots/${botId}/schedules/${scheduleId}/run`, { method: "POST" }), {
    params: Promise.resolve({ botId, scheduleId }),
  });

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner] = await db.insert(schema.users).values({ id: "usr_routines", email: "dana@example.com", emailVerifiedAt: new Date(), name: "Dana", timezone: "America/Chicago", plan: "pro" }).returning();
  session.user = owner;
});

afterAll(async () => {
  await resetDbForTests();
});

describe("routine results", () => {
  it("a web-only owner gets exactly one message per scheduled run", async () => {
    const { bot, brief } = await botWithBrief("Pixel");
    const before = await chat(bot);
    await makeDue(brief);
    const res = await runDueSchedules(db, new Date(), 25, { scheduleId: brief.id });
    expect(res.runs).toEqual([{ scheduleId: brief.id, outcome: "ok" }]);

    const added = await newInChat(bot, before);
    expect(added).toHaveLength(1);
    expect(added[0].meta).toMatchObject({ proactive: true, trigger: "routine" });
    expect(await deliveries(bot)).toHaveLength(0);
  });

  it("“Run now” posts exactly one message per run too, and says it ran", async () => {
    const { bot, brief } = await botWithBrief("Pixie");
    const before = await chat(bot);
    for (let i = 1; i <= 2; i++) {
      const res = await runNow(bot.id, brief.id);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ran: 1, outcome: "ok" });
      expect(await newInChat(bot, before)).toHaveLength(i);
    }
  });

  it("with Telegram set up, the result goes there and the chat still gets one copy", async () => {
    const { bot, brief } = await botWithBrief("Teleo");
    await db.insert(schema.channels).values({ id: "chn_tg_teleo", botId: bot.id, kind: "telegram", status: "active", ownerAddress: "424242", ownerVerifiedAt: new Date() });
    const before = await chat(bot);
    const res = await runNow(bot.id, brief.id);
    expect(await res.json()).toMatchObject({ outcome: "ok" });

    expect(await newInChat(bot, before)).toHaveLength(1);
    const sent = await deliveries(bot);
    expect(sent).toHaveLength(1);
    // Demo mode with no Telegram token: recorded as simulated, never really sent.
    expect(sent[0]).toMatchObject({ channelKind: "telegram", to: "424242", status: "simulated" });
  });

  it("a brain that fails is reported as a failure, with the reason in the chat once", async () => {
    const { bot, brief } = await botWithBrief("Glitch");
    const before = await chat(bot);
    brain.fail = true;
    try {
      const res = await runNow(bot.id, brief.id);
      expect(await res.json()).toMatchObject({ ran: 1, outcome: "failed" });
    } finally {
      brain.fail = false;
    }
    const added = await newInChat(bot, before);
    expect(added).toHaveLength(1);
    expect(added[0].text).toMatch(/temporarily unavailable/);
    expect(added[0].meta).toMatchObject({ status: "error" });
    const [latest] = await db
      .select()
      .from(schema.receipts)
      .where(and(eq(schema.receipts.botId, bot.id), eq(schema.receipts.kind, "routine")))
      .orderBy(desc(schema.receipts.createdAt))
      .limit(1);
    expect(latest).toMatchObject({ status: "error", title: "Routine “Morning brief” didn't finish" });
  });

  it("a paused bot doesn't run, and “Run now” says so", async () => {
    const { bot, brief } = await botWithBrief("Sleepy");
    await db.update(schema.bots).set({ status: "paused" }).where(eq(schema.bots.id, bot.id));
    const before = await chat(bot);
    const res = await runNow(bot.id, brief.id);
    expect(await res.json()).toMatchObject({ ran: 0, outcome: "paused" });
    expect(await newInChat(bot, before)).toHaveLength(0);
  });

  it("the day's limit counts runs, not the notes about skipped ones", async () => {
    const { bot, brief } = await botWithBrief("Counter");
    const { receipt } = await import("@/lib/agent/run");
    for (let i = 0; i < 30; i++) await receipt(db, bot, "routine", "blocked", `Skipped “${brief.title}”: daily proactive limit reached`, { scheduleId: brief.id });
    await makeDue(brief);
    const res = await runDueSchedules(db, new Date(), 25, { scheduleId: brief.id });
    expect(res.runs).toEqual([{ scheduleId: brief.id, outcome: "ok" }]);
  });

  it("a routine turned off while the minute's list is being worked through stays off", async () => {
    const { brief } = await botWithBrief("Offswitch");
    await makeDue(brief);
    // Turned off after the list was read: the claim finds it inactive and leaves it.
    const [due] = await db.select().from(schema.schedules).where(eq(schema.schedules.id, brief.id));
    await db.update(schema.schedules).set({ active: false }).where(eq(schema.schedules.id, brief.id));
    const res = await runDueSchedules(db, new Date(), 25, { scheduleId: brief.id });
    expect(res.runs).toEqual([]);
    const [after] = await db.select().from(schema.schedules).where(eq(schema.schedules.id, brief.id));
    expect(after.active).toBe(false);
    expect(after.nextRunAt?.getTime()).toBe(due.nextRunAt?.getTime());
  });

  it("an account that hasn't signed in keeps its routines for when it does", async () => {
    const [guest] = await db.insert(schema.users).values({ id: "usr_routines_guest", timezone: "UTC" }).returning();
    const made = await createBot(db, guest, {
      avatar: "blip",
      color: "ocean",
      name: "Waiting",
      jobs: ["reminders"],
      brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: [],
      trust: "ask",
      channels: [],
      contact: {},
      ageConfirmed: true,
      timezone: "UTC",
      morningBrief: { time: "08:00" },
    });
    if (!made.ok) throw new Error(made.error);
    const [brief] = await db.select().from(schema.schedules).where(eq(schema.schedules.botId, made.bot.id));
    await makeDue(brief);
    expect((await runDueSchedules(db, new Date(), 25, { scheduleId: brief.id })).runs).toEqual([]);
    // Signed in: it runs at the next tick.
    await db.update(schema.users).set({ email: "waiting@example.com", emailVerifiedAt: new Date() }).where(eq(schema.users.id, guest.id));
    expect((await runDueSchedules(db, new Date(), 25, { scheduleId: brief.id })).runs).toEqual([{ scheduleId: brief.id, outcome: "ok" }]);
  });
});
