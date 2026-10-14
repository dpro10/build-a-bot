/**
 * Outside demo mode with bots' own inboxes and Twilio set up, but no paid plans on sale:
 * the Email channel sends for real from the bot's own address, a provider failure reads
 * as a plain sentence instead of a 500, and a plan lock doesn't point at a dead upgrade.
 */
import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "0";
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.BOT_EMAIL_DOMAIN = "bots.example";
process.env.RESEND_API_KEY = "re_test";
process.env.RESEND_WEBHOOK_SECRET = `whsec_${crypto.randomBytes(24).toString("base64")}`;
process.env.TWILIO_ACCOUNT_SID = "AC_test";
process.env.TWILIO_AUTH_TOKEN = "twilio_test";
process.env.TWILIO_PHONE_NUMBER = "+15555550100";
for (const name of ["DATABASE_URL", "AGENTMAIL_API_KEY", "AGENTMAIL_WEBHOOK_SECRET", "STRIPE_SECRET_KEY"]) delete process.env[name];

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => session.user,
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { routeInboundEmail } = await import("@/lib/channels/email-inbound");
const { live } = await import("@/lib/env");
const channelsRoute = await import("@/app/api/bots/[botId]/channels/route");
import type { Bot } from "@/lib/db/schema";

let bot: Bot;
let notes: string[];

const post = (body: unknown) =>
  channelsRoute.POST(new Request(`http://localhost/api/bots/${bot.id}/channels`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ botId: bot.id }),
  });

beforeAll(async () => {
  await resetDbForTests();
  const db = await getDb();
  const [owner] = await db.insert(schema.users).values({ id: "usr_set_up", email: "dana@example.com", emailVerifiedAt: new Date(), timezone: "UTC", plan: "free" }).returning();
  session.user = owner;
  const res = await createBot(db, owner, {
    avatar: "otto",
    color: "grape",
    name: "Inkwell",
    jobs: ["research"],
    brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
    connectors: [],
    trust: "ask",
    channels: ["email", "sms"],
    contact: { email: "dana@example.com", phone: "+15125550123" },
    ageConfirmed: true,
    timezone: "UTC",
  });
  if (!res.ok) throw new Error(res.error);
  ({ bot, notes } = res);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("channels with their services set up", () => {
  it("bots' own inboxes are live with a domain and a provider that takes in mail", () => {
    expect(live.botEmail).toBe(true);
    expect(live.stripe).toBe(false);
  });

  it("the code goes out from the bot's own address", async () => {
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json({ id: "em_1" });
    });
    const res = await post({ kind: "email", action: "send_code", payload: { email: "dana@example.com" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, sent: true, botAddress: `${bot.handle}@bots.example` });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: "https://api.resend.com/emails", body: { from: `Inkwell (AI assistant) <${bot.handle}@bots.example>`, to: ["dana@example.com"] } });
  });

  it("when the email service turns the message down, the page gets a plain sentence, not a 500", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ message: "The bots.example domain is not verified." }, { status: 403 }));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ kind: "email", action: "send_code", payload: { email: "dana@example.com" } });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Something went wrong with Email. Try again in a moment." });
    // The details are in the server log.
    expect(String(logged.mock.calls[0]?.[1])).toMatch(/Resend 403/);
  });

  it("mail sent to the bot's address lands in its inbox", async () => {
    const db = await getDb();
    await routeInboundEmail(db, { to: [`Inkwell <${bot.handle}@bots.example>`], from: "Sam <sam@example.com>", subject: "Receipts", text: "Two receipts attached." });
    const mail = await db.select().from(schema.messages).where(eq(schema.messages.botId, bot.id));
    expect(mail).toMatchObject([{ channelKind: "email", author: "contact", meta: { from: "sam@example.com", subject: "Receipts" } }]);
  });

  it("a plan lock says paid plans are coming soon while none are on sale", async () => {
    expect(notes).toEqual(["Text messages are part of Plus. Paid plans are coming soon."]);
    const res = await post({ kind: "sms", action: "enable" });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "Text messages are part of Plus. Paid plans are coming soon." });
  });
});
