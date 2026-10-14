/**
 * A turn that can't be answered says why once: in its reply (which channels get too), never
 * again in a notice beside it. The "done" status still tells the chat it wasn't answered.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
delete process.env.DATABASE_URL;
delete process.env.TOKEN_FACTORY_API_KEY;

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { runTurn } = await import("@/lib/agent/run");
const { ensureConversation } = await import("@/lib/channels/outbound");
const { recordUsage } = await import("@/lib/billing/usage");
const { PLANS } = await import("@/lib/billing/plans");
import type { AgentEvent } from "@/lib/agent/run";
import type { Bot, User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;

async function makeBot(name: string, brain: Parameters<typeof createBot>[2]["brain"]): Promise<Bot> {
  const res = await createBot(db, owner, {
    avatar: "ember",
    color: "grape",
    name,
    jobs: [],
    brain,
    connectors: [],
    trust: "ask",
    channels: [],
    contact: {},
    ageConfirmed: true,
    timezone: "UTC",
  });
  if (!res.ok) throw new Error(res.error);
  return res.bot;
}

async function say(bot: Bot, text = "hi") {
  const events: AgentEvent[] = [];
  const conversation = await ensureConversation(db, bot.id, "web", "owner");
  const res = await runTurn({ db, bot, owner, conversation, channelKind: "web", message: { text, author: "owner" }, emit: (e) => events.push(e) });
  const done = events.find((e): e is Extract<AgentEvent, { type: "done" }> => e.type === "done");
  return { res, done, notices: events.filter((e) => e.type === "notice") };
}

const ownKey = { kind: "byok" as const, provider: "openai", model: "gpt-6.1-sol", apiKey: "sk-test-not-a-real-key-1234567890" };

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner] = await db.insert(schema.users).values({ id: "usr_fails", email: "fails@example.com", emailVerifiedAt: new Date(), timezone: "UTC", plan: "pro" }).returning();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.INCLUDED_DAILY_LIMIT;
});

afterAll(async () => {
  await resetDbForTests();
});

describe("a turn that can't be answered", () => {
  it("no brain (its API key is gone): one reply, no notice", async () => {
    const bot = await makeBot("Keyless", ownKey);
    await db.delete(schema.credentials).where(eq(schema.credentials.id, bot.brain.credentialId!));
    const { res, done, notices } = await say(bot);
    expect(res.status).toBe("unavailable");
    expect(res.text).toBe("I can't think right now. This bot's API key is missing. Add it again in Settings → Brain.");
    expect(done).toMatchObject({ status: "unavailable", text: res.text });
    expect(notices).toEqual([]);
  });

  it("a brain error (the key was rejected): one reply, no notice, and the chat hears it failed", async () => {
    const bot = await makeBot("Rejected", ownKey);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { message: "Incorrect API key" } }), { status: 401 }));
    const { res, done, notices } = await say(bot);
    expect(res.status).toBe("error");
    expect(res.text).toBe("The brain's API key was rejected. Check the key in Settings → Brain.");
    expect(done).toMatchObject({ status: "error", text: res.text });
    expect(notices).toEqual([]);
  });

  it("the plan's monthly messages are used up: one reply, no notice", async () => {
    const bot = await makeBot("Chatty", { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" });
    const used = PLANS.pro.limits.includedMessages;
    await recordUsage(db, owner.id, { messages: used, includedMessages: used });
    const { res, done, notices } = await say(bot);
    expect(res.status).toBe("limited");
    expect(done).toMatchObject({ status: "limited", text: res.text });
    expect(notices).toEqual([]);
  });

  it("the free brain is at today's limit for everyone: one reply, no notice", async () => {
    await resetDbForTests();
    db = await getDb();
    [owner] = await db.insert(schema.users).values({ id: "usr_fails", email: "fails@example.com", emailVerifiedAt: new Date(), timezone: "UTC", plan: "pro" }).returning();
    process.env.INCLUDED_DAILY_LIMIT = "1";
    const bot = await makeBot("Busy", { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" });
    expect((await say(bot)).res.status).toBe("ok");
    const { res, notices } = await say(bot);
    expect(res.status).toBe("limited");
    expect(res.text).toMatch(/reached its daily limit/);
    expect(notices).toEqual([]);
  });
});
