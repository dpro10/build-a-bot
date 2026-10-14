/**
 * A bot on the owner's Claude or ChatGPT plan thinks on their computer. Before one is paired it
 * says so plainly (not that the computer is asleep), and its greeting waits only once.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
delete process.env.DATABASE_URL;
delete process.env.TOKEN_FACTORY_API_KEY;

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { runTurn } = await import("@/lib/agent/run");
const { computerFor } = await import("@/lib/bridge/jobs");
const { ensureConversation } = await import("@/lib/channels/outbound");
import type { AgentEvent } from "@/lib/agent/run";
import type { Bot, User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;

async function person(id: string): Promise<User> {
  const [user] = await db.insert(schema.users).values({ id, email: `${id}@example.com`, emailVerifiedAt: new Date(), timezone: "UTC", plan: "pro" }).returning();
  return user;
}

async function planBot(owner: User, whenOffline: "wait" | "included" = "wait"): Promise<Bot> {
  const res = await createBot(db, owner, {
    avatar: "nimbus",
    color: "mint",
    name: "Juniper",
    jobs: [],
    brain: { kind: "subscription", subscription: "claude", whenOffline },
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

async function device(owner: User, id: string, opts: { platform: string; seenAgoMs: number; claude?: string }) {
  await db.insert(schema.bridgeDevices).values({
    id,
    ownerId: owner.id,
    name: "Dana's MacBook",
    tokenHash: `hash_${id}`,
    platform: opts.platform,
    clis: opts.claude ? { claude: opts.claude } : {},
    lastSeenAt: new Date(Date.now() - opts.seenAgoMs),
  });
}

/** The bot's first message in the web chat, as the chat sees it. */
async function greet(bot: Bot, owner: User) {
  const events: AgentEvent[] = [];
  const conversation = await ensureConversation(db, bot.id, "web", "owner");
  const res = await runTurn({ db, bot, owner, conversation, channelKind: "web", message: null, directive: "Say hi.", trigger: "greeting", noTools: true, emit: (e) => events.push(e) });
  const notices = events.filter((e): e is Extract<AgentEvent, { type: "notice" }> => e.type === "notice");
  return { res, notices, conversation };
}

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("a bot on your Claude or ChatGPT plan", () => {
  it("before any computer is paired, it says to pair one, with a link to the Bridge", async () => {
    const owner = await person("usr_unpaired");
    const bot = await planBot(owner);
    expect(await computerFor(db, bot)).toBe("unpaired");

    const { res, notices } = await greet(bot, owner);
    expect(res.status).toBe("queued");
    expect(notices).toEqual([{ type: "notice", tone: "warn", text: "Pair your computer to start: open Bridge (your computer).", href: "/app/bridge" }]);
    expect(notices[0].text).not.toMatch(/asleep/);
  });

  it("opening the chat again doesn't line up a second greeting", async () => {
    const owner = await person("usr_reopens");
    const bot = await planBot(owner);
    const first = await greet(bot, owner);
    await greet(bot, owner);
    const jobs = await db.select().from(schema.bridgeJobs).where(and(eq(schema.bridgeJobs.conversationId, first.conversation.id), eq(schema.bridgeJobs.status, "queued")));
    expect(jobs).toHaveLength(1);
  });

  it("on other channels the message carries the Bridge's address", async () => {
    const owner = await person("usr_telegram");
    const bot = await planBot(owner);
    const conversation = await ensureConversation(db, bot.id, "telegram", "4242");
    const res = await runTurn({ db, bot, owner, conversation, channelKind: "telegram", message: { text: "hi", author: "owner" } });
    expect(res.status).toBe("queued");
    expect(res.text).toMatch(/^Pair your computer to start: open Bridge \(your computer\) at https?:\/\/\S+\/app\/bridge\.$/);
  });

  it("the meeting-notes desktop app alone doesn't count as a paired computer", async () => {
    const owner = await person("usr_desktop_only");
    const bot = await planBot(owner);
    await device(owner, "dev_desktop", { platform: "desktop-darwin-arm64", seenAgoMs: 0 });
    expect(await computerFor(db, bot)).toBe("unpaired");
  });

  it("a paired computer that's off is asleep; once it checks in, it's online", async () => {
    const owner = await person("usr_paired");
    const bot = await planBot(owner);
    await device(owner, "dev_laptop", { platform: "darwin-arm64", seenAgoMs: 60 * 60 * 1000, claude: "2.1.3" });
    expect(await computerFor(db, bot)).toBe("asleep");
    const { notices } = await greet(bot, owner);
    expect(notices[0].text).toMatch(/asleep/);
    expect(notices[0].href).toBeUndefined();

    await db.update(schema.bridgeDevices).set({ lastSeenAt: new Date() }).where(eq(schema.bridgeDevices.id, "dev_laptop"));
    expect(await computerFor(db, bot)).toBe("online");
  });

  it("one that falls back to the free brain isn't waiting on the computer, and says why it's using the free brain", async () => {
    const owner = await person("usr_fallback");
    const bot = await planBot(owner, "included");
    expect(await computerFor(db, bot)).toBeNull();
    const { res, notices } = await greet(bot, owner);
    expect(res.status).toBe("ok");
    expect(notices.map((n) => n.text)).toEqual(["Your computer isn't paired yet, so I'm using the free brain for now (you opted in)."]);
  });
});
