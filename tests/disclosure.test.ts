/**
 * Saying it's an AI (Diego, 2026-10-15: lighter for the owner on chat apps). Everyone hears it at
 * first contact. Other people, and texts, calls and email, hear it again every 3 hours. The owner
 * on Slack, Telegram or Discord, which tag the bot as an app on every message, hears it once.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
delete process.env.DATABASE_URL;
delete process.env.TOKEN_FACTORY_API_KEY;

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { runTurn } = await import("@/lib/agent/run");
const { ensureConversation } = await import("@/lib/channels/outbound");
const { needsDisclosure } = await import("@/lib/safety");
import type { Bot, User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;
let bot: Bot;

const HOUR = 3600_000;
const LINE = "(Echo is an AI assistant, not a person.)";

/** One message on a channel, as if the last notice went out `hoursAgo` hours ago (null: never). */
async function turn(channel: string, thread: string, author: "owner" | "contact", hoursAgo: number | null) {
  const conversation = await ensureConversation(db, bot.id, channel, thread);
  const lastDisclosureAt = hoursAgo === null ? null : new Date(Date.now() - hoursAgo * HOUR);
  await db.update(schema.conversations).set({ lastDisclosureAt }).where(eq(schema.conversations.id, conversation.id));
  const res = await runTurn({ db, bot, owner, conversation: { ...conversation, lastDisclosureAt }, channelKind: channel, message: { text: "hi", author, from: thread } });
  return res.text;
}

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner] = await db.insert(schema.users).values({ id: "usr_echo", email: "echo@example.com", emailVerifiedAt: new Date(), name: "Dana", timezone: "UTC", plan: "pro" }).returning();
  const res = await createBot(db, owner, {
    avatar: "otto",
    color: "grape",
    name: "Echo",
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
  bot = res.bot;
});

afterAll(async () => {
  await resetDbForTests();
});

describe("saying it's an AI", () => {
  it("the rule", () => {
    const fourHoursAgo = new Date(Date.now() - 4 * HOUR);
    const oneHourAgo = new Date(Date.now() - HOUR);
    // First contact: everyone, everywhere but the web app (its UI says so).
    for (const channel of ["slack", "telegram", "discord", "sms", "voice", "email"]) {
      expect(needsDisclosure(null, { channel, owner: true })).toBe(true);
      expect(needsDisclosure(null, { channel, owner: false })).toBe(true);
    }
    expect(needsDisclosure(null, { channel: "web", owner: true })).toBe(false);
    // The owner on a chat app that tags bots: once.
    for (const channel of ["slack", "telegram", "discord"]) expect(needsDisclosure(fourHoursAgo, { channel, owner: true })).toBe(false);
    // Everyone else, and texts, calls and email: every 3 hours.
    expect(needsDisclosure(fourHoursAgo, { channel: "slack", owner: false })).toBe(true);
    expect(needsDisclosure(fourHoursAgo, { channel: "sms", owner: true })).toBe(true);
    expect(needsDisclosure(fourHoursAgo, { channel: "email", owner: true })).toBe(true);
    expect(needsDisclosure(oneHourAgo, { channel: "sms", owner: true })).toBe(false);
  });

  it("the owner on Slack hears it on the first reply, then not again", async () => {
    expect(await turn("slack", "U_DANA", "owner", null)).toContain(LINE);
    expect(await turn("slack", "U_DANA", "owner", 5)).not.toContain(LINE);
  });

  it("other people on Slack, and the owner by text, hear it again after 3 hours", async () => {
    expect(await turn("slack", "U_SAM", "contact", 5)).toContain(LINE);
    expect(await turn("sms", "+15125550123", "owner", 5)).toContain(LINE);
    expect(await turn("sms", "+15125550123", "owner", 1)).not.toContain(LINE);
  });
});
