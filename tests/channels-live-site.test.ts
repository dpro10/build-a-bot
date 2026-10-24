/**
 * Outside demo mode, set up like the live site (no Twilio, no bot inboxes, a Resend key only
 * for sign-in links): nothing is simulated, what isn't set up says it's coming soon, and a
 * service we can't reach isn't reported as saying no (in-memory Postgres).
 */
import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "0";
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.RESEND_API_KEY = "re_test_sign_in_only";
for (const name of ["DATABASE_URL", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "BOT_EMAIL_DOMAIN", "RESEND_WEBHOOK_SECRET", "AGENTMAIL_API_KEY", "AGENTMAIL_WEBHOOK_SECRET", "STRIPE_SECRET_KEY"]) {
  delete process.env[name];
}

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => session.user,
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { channelAction } = await import("@/lib/channels/setup");
const { connectTelegramToken } = await import("@/lib/channels/telegram-setup");
const { buildToolset } = await import("@/lib/tools/registry");
const { botEmailAddress } = await import("@/lib/tools/builtin");
const { routeInboundEmail } = await import("@/lib/channels/email-inbound");
const { demoMode, live } = await import("@/lib/env");
const connectionsRoute = await import("@/app/api/bots/[botId]/connections/route");
import type { Bot, User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;
let bot: Bot;
let notes: string[];

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner] = await db.insert(schema.users).values({ id: "usr_live", email: "dana@example.com", emailVerifiedAt: new Date(), timezone: "UTC", plan: "free" }).returning();
  session.user = owner;
  const res = await createBot(db, owner, {
    avatar: "nimbus",
    color: "sky",
    name: "Nimbus",
    jobs: ["inbox", "calendar", "reminders"],
    brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
    connectors: [],
    trust: "ask",
    channels: ["telegram", "sms", "voice", "email"],
    contact: { phone: "+15125550123", email: "dana@example.com" },
    ageConfirmed: true,
    timezone: "UTC",
    morningBrief: { time: "08:00" },
  });
  if (!res.ok) throw new Error(res.error);
  ({ bot, notes } = res);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("the live site's channels", () => {
  it("a Resend key for sign-in links doesn't make bots' email live", () => {
    expect(demoMode).toBe(false);
    expect(live.email).toBe(true);
    expect(live.botEmail).toBe(false);
    expect(botEmailAddress(bot)).toBeNull();
  });

  it("a new bot gets only the channels that work here, and no inbox of its own", async () => {
    expect(notes).toEqual(["Text messages are coming soon.", "Phone calls are coming soon.", "Email is coming soon."]);
    const channels = await db.select().from(schema.channels).where(eq(schema.channels.botId, bot.id));
    expect(channels.map((c) => c.kind).sort()).toEqual(["telegram", "web"]);
    const connections = await db.select().from(schema.connections).where(eq(schema.connections.botId, bot.id));
    expect(connections.map((c) => c.connectorId)).not.toContain("bot_inbox");
    // The morning brief doesn't promise a calendar or emails it can't see.
    const [brief] = await db.select().from(schema.schedules).where(eq(schema.schedules.botId, bot.id));
    expect(brief.prompt).not.toMatch(/calendar|email/);
  });

  it("texts, calls and email say they're coming soon instead of starting a setup that can't work", async () => {
    expect(await channelAction(db, owner, bot, "sms", "send_code", { phone: "+15125550123" })).toEqual({ ok: false, error: "Text messages are coming soon." });
    expect(await channelAction(db, owner, bot, "voice", "enable", {})).toEqual({ ok: false, error: "Phone calls are coming soon." });
    expect(await channelAction(db, owner, bot, "email", "send_code", { email: "dana@example.com" })).toEqual({ ok: false, error: "Email is coming soon." });
    const rows = await db.select().from(schema.channels).where(eq(schema.channels.botId, bot.id));
    expect(rows.map((c) => c.kind)).not.toContain("email");
  });

  it("without a domain, mail to a bot goes nowhere", async () => {
    await routeInboundEmail(db, { to: [`${bot.handle}@botmail.dev`], from: "someone@example.com", subject: "Hi", text: "Hello?" });
    const mail = await db.select().from(schema.messages).where(eq(schema.messages.channelKind, "email"));
    expect(mail).toEqual([]);
  });

  it("its own inbox can't be added, and an old one gives the bot no email tools", async () => {
    const res = await connectionsRoute.POST(
      new Request(`http://localhost/api/bots/${bot.id}/connections`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectorId: "bot_inbox" }) }),
      { params: Promise.resolve({ botId: bot.id }) },
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Its own inbox is coming soon.");

    // A bot made before this change.
    await db.insert(schema.connections).values({ id: "con_old_inbox", botId: bot.id, connectorId: "bot_inbox", mode: "builtin", status: "connected" });
    const toolset = await buildToolset({ db, bot, owner, conversationId: null, channelKind: "web", demo: false, now: new Date() });
    expect(toolset.byName.has("send_email")).toBe(false);
    expect(toolset.byName.has("read_inbox")).toBe(false);
  });

  it("Telegram is on the waitlist: a pasted token is turned down before anything is sent, and the waitlist takes names", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true, result: { id: 42, is_bot: true, username: "nimbus_bot" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await channelAction(db, owner, bot, "telegram", "token", { token: `123456789:${"A".repeat(35)}` })).toEqual({ ok: false, error: "Telegram is coming soon." });
    expect(fetch).not.toHaveBeenCalled();
    expect(await channelAction(db, owner, bot, "telegram", "waitlist", {})).toEqual({ ok: true, data: { message: "You're on the list for Telegram." } });
  });

  // Telegram's setup stays for when it opens.
  const telegramChannel = async () => {
    const [channel] = await db.select().from(schema.channels).where(and(eq(schema.channels.botId, bot.id), eq(schema.channels.kind, "telegram")));
    return channel;
  };

  it("when Telegram or Slack can't be reached, it says so instead of blaming the token", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(connectTelegramToken(db, bot, owner, await telegramChannel(), `123456789:${"A".repeat(35)}`)).rejects.toThrow("Couldn't reach Telegram. Try again in a moment.");
    const slack = await channelAction(db, owner, bot, "slack", "tokens", { botToken: "xoxb-test-token", signingSecret: "s".repeat(32) });
    expect(slack).toEqual({ ok: false, error: "Couldn't reach Slack. Try again in a moment." });
  });

  it("a token Telegram turns down reads as that", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ ok: false, description: "Unauthorized" }, { status: 401 }));
    await expect(connectTelegramToken(db, bot, owner, await telegramChannel(), `123456789:${"B".repeat(35)}`)).rejects.toThrow(
      "Telegram didn't accept that token. Copy it again from BotFather.",
    );
  });
});
