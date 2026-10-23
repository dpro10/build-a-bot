/**
 * No one can use up a day's ceiling for everyone: each account gets a share of it, accounts that
 * haven't signed in get a share between them and only so much from one network, and a turn that
 * doesn't fit counts against nothing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
delete process.env.DATABASE_URL;
delete process.env.TOKEN_FACTORY_API_KEY;

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { roomToday, spenderOf } = await import("@/lib/billing/ceiling");
const { createBot } = await import("@/lib/bots/create");
const { runTurn } = await import("@/lib/agent/run");
const { ensureConversation } = await import("@/lib/channels/outbound");

let db: Awaited<ReturnType<typeof getDb>>;

const signedIn = (id: string) => ({ userId: id, guest: false });
const guest = (id: string, network: string | null = null) => ({ userId: id, guest: true, network });

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
});

beforeEach(async () => {
  await db.delete(schema.rateLimits).where(like(schema.rateLimits.key, "ceiling:%"));
  process.env.INCLUDED_DAILY_LIMIT = "1000"; // shares: an account 100, guests 250, a guest network 50
});

afterAll(async () => {
  delete process.env.INCLUDED_DAILY_LIMIT;
  await resetDbForTests();
});

describe("today's shares of a ceiling", () => {
  it("an account gets a tenth of it; the next account is unaffected", async () => {
    expect(await roomToday(db, "included", signedIn("usr_a"), 100)).toBe("ok");
    expect(await roomToday(db, "included", signedIn("usr_a"))).toBe("account");
    expect(await roomToday(db, "included", signedIn("usr_b"))).toBe("ok");
  });

  it("accounts that haven't signed in share a quarter, and 50 a day from one network", async () => {
    expect(await roomToday(db, "included", guest("usr_g1", "203.0.113.9"), 50)).toBe("ok");
    // Another cookie on the same network gets nothing more today…
    expect(await roomToday(db, "included", guest("usr_g2", "203.0.113.9"))).toBe("network");
    // …a guest elsewhere does, until guests together reach their share…
    for (let i = 0; i < 4; i++) expect(await roomToday(db, "included", guest(`usr_far${i}`, `198.51.100.${i}`), 50)).toBe("ok");
    expect(await roomToday(db, "included", guest("usr_far9", "192.0.2.7"))).toBe("guests");
    // …and people who signed in still have the rest.
    expect(await roomToday(db, "included", signedIn("usr_member"))).toBe("ok");
  });

  it("the whole site's ceiling still holds, and a turn that doesn't fit counts against nothing", async () => {
    process.env.INCLUDED_DAILY_LIMIT = "300"; // an account's share is 50 here (its floor)
    for (let i = 0; i < 6; i++) expect(await roomToday(db, "included", signedIn(`usr_s${i}`), 50)).toBe("ok");
    expect(await roomToday(db, "included", signedIn("usr_late"))).toBe("site");
    const [late] = await db.select().from(schema.rateLimits).where(eq(schema.rateLimits.key, "ceiling:included:account:usr_late"));
    expect(late?.count ?? 0).toBe(0);
  });

  it("web lookups: every bot can search, so guests share a quarter of the day's 300 (an account 30)", async () => {
    delete process.env.SEARCH_DAILY_LIMIT;
    expect(await roomToday(db, "search", guest("usr_judge1"), 30)).toBe("ok");
    expect(await roomToday(db, "search", guest("usr_judge1"))).toBe("account");
    expect(await roomToday(db, "search", guest("usr_judge2"), 30)).toBe("ok");
    expect(await roomToday(db, "search", guest("usr_judge3"), 15)).toBe("ok");
    expect(await roomToday(db, "search", guest("usr_judge4"))).toBe("guests");
    expect(await roomToday(db, "search", signedIn("usr_member"))).toBe("ok");
  });

  it("a small ceiling isn't split up: the site's limit is the only one", async () => {
    process.env.INCLUDED_DAILY_LIMIT = "20";
    expect(await roomToday(db, "included", guest("usr_small", "203.0.113.50"), 20)).toBe("ok");
    expect(await roomToday(db, "included", signedIn("usr_other"))).toBe("site");
  });
});

describe("in a turn", () => {
  it("a guest out of the guests' share is told to sign in, with the link, in the web chat", async () => {
    const [user] = await db.insert(schema.users).values({ id: "usr_cookie", timezone: "UTC" }).returning();
    const res = await createBot(db, user, {
      avatar: "otto",
      color: "grape",
      name: "Scout",
      jobs: [],
      brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: [],
      trust: "ask",
      channels: [],
      contact: {},
      ageConfirmed: true,
      timezone: "UTC",
    });
    if (!res.ok) throw new Error(res.error);
    // Other guests have used the guests' share today (each account up to its own share).
    for (const [id, uses] of [["usr_crowd1", 100], ["usr_crowd2", 100], ["usr_crowd3", 50]] as const) expect(await roomToday(db, "included", guest(id), uses)).toBe("ok");
    const conversation = await ensureConversation(db, res.bot.id, "web", "owner");
    const events: { type: string; href?: string }[] = [];
    const turn = await runTurn({
      db,
      bot: res.bot,
      owner: user,
      conversation,
      channelKind: "web",
      message: { text: "hello", author: "owner" },
      network: "203.0.113.77",
      emit: (e) => events.push(e as never),
    });
    expect(turn.status).toBe("limited");
    expect(turn.text).toMatch(/Sign in with your email/);
    expect(events.find((e) => e.type === "notice")?.href).toBe(`/login?next=${encodeURIComponent(`/app/bots/${res.bot.id}`)}`);
    expect(spenderOf(user, "203.0.113.77")).toEqual({ userId: "usr_cookie", guest: true, network: "203.0.113.77" });
  });
});
