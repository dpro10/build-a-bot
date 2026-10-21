/**
 * What bounds the bill when anyone with the link can sign up: the allowance before an email is
 * confirmed, credit (lookups are paid from it at Tavily's price, and running out stops what costs
 * money), and the site-wide daily ceilings.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
delete process.env.DATABASE_URL;
delete process.env.TOKEN_FACTORY_API_KEY;

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { runTurn } = await import("@/lib/agent/run");
const { ensureConversation } = await import("@/lib/channels/outbound");
const { checkSpend, getUsage, recordUsage, ANONYMOUS_INCLUDED_MESSAGES } = await import("@/lib/billing/usage");
const { starterCreditMicros } = await import("@/lib/billing/credit");
const { config } = await import("@/lib/env");
const { underDailyCeiling } = await import("@/lib/billing/ceiling");
import type { Bot, User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;

async function person(id: string, confirmed: boolean): Promise<User> {
  const [user] = await db
    .insert(schema.users)
    .values(confirmed ? { id, email: `${id}@example.com`, emailVerifiedAt: new Date(), timezone: "UTC" } : { id, timezone: "UTC" })
    .returning();
  return user;
}

async function botFor(owner: User): Promise<Bot> {
  const res = await createBot(db, owner, {
    avatar: "otto",
    color: "grape",
    name: "Scout",
    jobs: ["research"],
    brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
    connectors: ["web_search"],
    trust: "ask",
    channels: [],
    contact: {},
    ageConfirmed: true,
    timezone: "UTC",
  });
  if (!res.ok) throw new Error(res.error);
  return res.bot;
}

async function say(bot: Bot, owner: User, text: string) {
  const conversation = await ensureConversation(db, bot.id, "web", "owner");
  const [fresh] = await db.select().from(schema.bots).where(eq(schema.bots.id, bot.id));
  return runTurn({ db, bot: fresh, owner, conversation, channelKind: "web", message: { text, author: "owner" } });
}

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
});

afterAll(async () => {
  delete process.env.INCLUDED_DAILY_LIMIT;
  delete process.env.SEARCH_DAILY_LIMIT;
  await resetDbForTests();
});

describe("limits when anyone can sign up", () => {
  it("an account without a confirmed email gets 5 messages, then is asked to sign in", async () => {
    expect(ANONYMOUS_INCLUDED_MESSAGES).toBe(5);
    const anon = await person("usr_anon", false);
    const bot = await botFor(anon);
    await recordUsage(db, anon.id, { messages: 4, includedMessages: 4 });
    expect((await say(bot, anon, "hi")).status).not.toBe("limited");
    const res = await say(bot, anon, "hi again");
    expect(res.status).toBe("limited");
    expect(res.text).toBe("You've used the 5 free messages you get before signing in. Sign in with your email (it's free) to keep going.");

    const confirmed = await person("usr_confirmed", true);
    await recordUsage(db, confirmed.id, { messages: ANONYMOUS_INCLUDED_MESSAGES, includedMessages: ANONYMOUS_INCLUDED_MESSAGES });
    expect((await say(await botFor(confirmed), confirmed, "hi")).status).not.toBe("limited");
  });

  it("a web lookup is paid from credit at Tavily's price, and running out stops what costs money", async () => {
    const user = await person("usr_searcher", true);
    const bot = await botFor(user);
    await recordUsage(db, user.id, { costMicros: starterCreditMicros() - 1 }); // a millionth of a dollar left
    config.tavily.apiKey = "tvly_test";
    vi.stubGlobal("fetch", async () =>
      Response.json({ answer: "Feed your starter twice a day.", results: [{ title: "Sourdough tips", url: "https://example.com/sourdough", content: "Feed it." }] }),
    );
    try {
      expect((await say(bot, user, "search the web for sourdough tips")).text).toMatch(/Here's what I found/);
      const usage = await getUsage(db, user.id);
      expect(usage.searches).toBe(1);
      expect(usage.costMicros).toBe(starterCreditMicros() - 1 + 8_000); // the demo brain costs nothing; the lookup, $0.008
      // Now below zero: lookups and the included brain wait for credit.
      const spend = await checkSpend(db, user, "lookup");
      expect(spend).toEqual({ ok: false, code: "no_credit", message: "You're out of credit. Add credit in Credit & usage to keep going." });
      const next = await say(bot, user, "search the web for rye bread");
      expect(next.status).toBe("limited");
      expect(next.text).toBe(
        "You're out of credit. Add credit in Credit & usage, or switch me to your own AI key in Settings → Brain (that's free here).",
      );
    } finally {
      config.tavily.apiKey = undefined;
      vi.unstubAllGlobals();
    }
  });

  it("stops paid lookups and the included brain for everyone at today's ceiling", async () => {
    await resetDbForTests();
    db = await getDb();
    process.env.SEARCH_DAILY_LIMIT = "1";
    process.env.INCLUDED_DAILY_LIMIT = "2"; // two turns today, then the ceiling
    const user = await person("usr_busy", true);
    const bot = await botFor(user);
    expect((await say(bot, user, "search the web for bagels")).text).toMatch(/Here's what I found/);
    expect((await say(bot, user, "search the web for pretzels")).text).toMatch(/today's limit for everyone/);
    const third = await say(bot, user, "hi");
    expect(third.status).toBe("limited");
    expect(third.text).toMatch(/have reached today's limit/);
  });

  it("a ceiling of 0 is off", async () => {
    process.env.SEARCH_DAILY_LIMIT = "0";
    for (let i = 0; i < 5; i++) expect(await underDailyCeiling(db, "search")).toBe(true);
  });
});
