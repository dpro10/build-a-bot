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
const { sha256 } = await import("@/lib/crypto");
const { POST: heartbeat } = await import("@/app/api/bridge/heartbeat/route");
const { GET: desktopSession } = await import("@/app/api/desktop/session/route");
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

  it("the desktop app without Claude Code or Codex (or with its Bridge off) doesn't count as a paired computer", async () => {
    const owner = await person("usr_desktop_only");
    const bot = await planBot(owner);
    await device(owner, "dev_desktop", { platform: "desktop-darwin-arm64", seenAgoMs: 0 });
    expect(await computerFor(db, bot)).toBe("unpaired");
  });

  it("the desktop app that found Claude Code thinks there: online while it checks in, asleep when it's closed", async () => {
    const owner = await person("usr_desktop_bridge");
    const bot = await planBot(owner);
    await device(owner, "dev_app", { platform: "desktop-darwin-arm64", seenAgoMs: 0, claude: "2.1.302 (Claude Code)" });
    expect(await computerFor(db, bot)).toBe("online");
    await db.update(schema.bridgeDevices).set({ lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) }).where(eq(schema.bridgeDevices.id, "dev_app"));
    expect(await computerFor(db, bot)).toBe("asleep");
    const { notices } = await greet(bot, owner);
    expect(notices[0].text).toMatch(/asleep/);
  });

  it("the heartbeat says how many turns are waiting, so a desktop app that isn't listening yet starts to", async () => {
    const owner = await person("usr_heartbeat");
    const bot = await planBot(owner);
    const token = `bab_dev_${"h".repeat(40)}`;
    await db.insert(schema.bridgeDevices).values({ id: "dev_hb", ownerId: owner.id, name: "Dana's PC", tokenHash: sha256(token), platform: "desktop-win32-x64", clis: {} });
    const beat = async (clis: Record<string, string | null>) => {
      const res = await heartbeat(new Request("http://localhost/api/bridge/heartbeat", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ clis }) }));
      expect(res.status).toBe(200);
      return (await res.json()) as { queued: number };
    };
    expect((await beat({ claude: "2.1.302 (Claude Code)", codex: null })).queued).toBe(0);
    expect(await computerFor(db, bot)).toBe("online");
    await greet(bot, owner);
    expect((await beat({ claude: "2.1.302 (Claude Code)", codex: null })).queued).toBe(1);
    // Its Bridge turned off: it says it has none, and the bot no longer counts on it.
    await beat({ claude: null, codex: null });
    expect(await computerFor(db, bot)).toBe("unpaired");
  });

  it("the desktop app's session says which bots think with their owner's plan", async () => {
    const owner = await person("usr_session");
    const bot = await planBot(owner);
    const token = `bab_dev_${"s".repeat(40)}`;
    await db.insert(schema.bridgeDevices).values({ id: "dev_sess", ownerId: owner.id, name: "Dana's Mac", tokenHash: sha256(token), platform: "desktop-darwin-arm64", clis: {} });
    const res = await desktopSession(new Request("http://localhost/api/desktop/session", { headers: { authorization: `Bearer ${token}` } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bots: Array<{ id: string; subscription: string | null }> };
    expect(body.bots.find((b) => b.id === bot.id)?.subscription).toBe("claude");
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

  it("one that falls back to an included model isn't waiting on the computer, and says why it's using one", async () => {
    const owner = await person("usr_fallback");
    const bot = await planBot(owner, "included");
    expect(await computerFor(db, bot)).toBeNull();
    const { res, notices } = await greet(bot, owner);
    expect(res.status).toBe("ok");
    expect(notices.map((n) => n.text)).toEqual(["Your computer isn't paired yet, so I'm using an open model we run for now (you opted in; it's paid from your credit)."]);
  });
});
