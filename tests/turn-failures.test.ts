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
const { starterCreditMicros } = await import("@/lib/billing/credit");
import type { AgentEvent } from "@/lib/agent/run";
import type { Bot, User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;

async function makeBot(name: string, brain: Parameters<typeof createBot>[2]["brain"], who: User = owner): Promise<Bot> {
  const res = await createBot(db, who, {
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
  [owner] = await db.insert(schema.users).values({ id: "usr_fails", email: "fails@example.com", emailVerifiedAt: new Date(), timezone: "UTC" }).returning();
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

  it("out of credit: one reply, and a link to add some under it (in the web chat, where credit can be added)", async () => {
    const bot = await makeBot("Chatty", { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" });
    await recordUsage(db, owner.id, { costMicros: starterCreditMicros() + 1 }); // the starter credit, and then some
    const { res, done, notices } = await say(bot);
    expect(res.status).toBe("limited");
    expect(done).toMatchObject({ status: "limited", text: res.text });
    const link = { type: "notice", tone: "info", text: "Add credit", href: "/app/billing" };
    expect(notices).toEqual([link]);
    // Kept with the reply, so it's still there after a reload.
    const [saved] = await db.select().from(schema.messages).where(eq(schema.messages.id, res.messageId!));
    expect(saved.parts).toEqual([link]);
  });

  it("past the free messages before signing in: one reply, and a link to sign in that comes back to this chat", async () => {
    const [guest] = await db.insert(schema.users).values({ id: "usr_guest", timezone: "UTC" }).returning();
    const bot = await makeBot("Guesty", { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" }, guest);
    await recordUsage(db, guest.id, { messages: 5, includedMessages: 5 });
    const events: AgentEvent[] = [];
    const conversation = await ensureConversation(db, bot.id, "web", "owner");
    const res = await runTurn({ db, bot, owner: guest, conversation, channelKind: "web", message: { text: "one more?", author: "owner" }, emit: (e) => events.push(e) });
    expect(res.status).toBe("limited");
    expect(res.text).toMatch(/free messages you get before signing in/);
    expect(events.filter((e) => e.type === "notice")).toEqual([
      { type: "notice", tone: "info", text: "Sign in with your email to keep going", href: `/login?next=${encodeURIComponent(`/app/bots/${bot.id}`)}` },
    ]);
    // Elsewhere (Telegram, texts) the reply says it in words: no link to show.
    const tg = await ensureConversation(db, bot.id, "telegram", "owner");
    const other: AgentEvent[] = [];
    await runTurn({ db, bot, owner: guest, conversation: tg, channelKind: "telegram", message: { text: "hi", author: "owner" }, emit: (e) => other.push(e) });
    expect(other.filter((e) => e.type === "notice")).toEqual([]);
  });

  it("out of credit, a routine says so once a day instead of every time it runs", async () => {
    const bot = await makeBot("Routinely", { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" });
    const conversation = await ensureConversation(db, bot.id, "web", "owner");
    const routine = () => runTurn({ db, bot, owner, conversation, channelKind: "web", message: null, directive: "Run your scheduled routine “Brief” now.", trigger: "routine" });
    const first = await routine();
    expect(first).toMatchObject({ status: "limited" });
    expect(first.text).toMatch(/^You're out of credit\. /);
    const second = await routine();
    expect(second).toEqual({ status: "limited", text: "", messageId: null, approvals: [] });
    const said = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, conversation.id));
    expect(said.filter((m) => m.author === "bot" && m.text.startsWith("You're out of credit."))).toHaveLength(1);
    // The owner writing still gets an answer every time.
    expect((await say(bot)).res.text).toMatch(/^You're out of credit\. /);
  });

  it("the open models we run are at today's limit for everyone: one reply, no notice", async () => {
    await resetDbForTests();
    db = await getDb();
    [owner] = await db.insert(schema.users).values({ id: "usr_fails", email: "fails@example.com", emailVerifiedAt: new Date(), timezone: "UTC" }).returning();
    process.env.INCLUDED_DAILY_LIMIT = "1";
    const bot = await makeBot("Busy", { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" });
    expect((await say(bot)).res.status).toBe("ok");
    const { res, notices } = await say(bot);
    expect(res.status).toBe("limited");
    expect(res.text).toMatch(/have reached today's limit/);
    expect(notices).toEqual([]);
  });
});
