/**
 * Outside demo mode with bots' own inboxes and Twilio set up, and no Stripe: the Email channel
 * sends for real from the bot's own address, a provider failure reads as a plain sentence instead
 * of a 500, texts come with no plan, and a text without credit says so instead of going out.
 */
import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "0";
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.BOT_EMAIL_DOMAIN = "bots.example";
process.env.RESEND_API_KEY = "re_test";
process.env.RESEND_WEBHOOK_SECRET = `whsec_${crypto.randomBytes(24).toString("base64")}`;
process.env.TWILIO_ACCOUNT_SID = "AC_test";
process.env.TWILIO_AUTH_TOKEN = "twilio_test";
process.env.TWILIO_PHONE_NUMBER = "+15555550100";
process.env.TWILIO_TEXTING = "1";
for (const name of ["DATABASE_URL", "AGENTMAIL_API_KEY", "AGENTMAIL_WEBHOOK_SECRET", "STRIPE_SECRET_KEY"]) delete process.env[name];

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => session.user,
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { routeInboundEmail } = await import("@/lib/channels/email-inbound");
const { appUrl, live } = await import("@/lib/env");
const { getUsage, recordUsage } = await import("@/lib/billing/usage");
const callRoute = await import("@/app/api/webhooks/twilio/voice/route");
const callStatusRoute = await import("@/app/api/webhooks/twilio/voice/status/route");
const channelsRoute = await import("@/app/api/bots/[botId]/channels/route");
const { channelAction } = await import("@/lib/channels/setup");
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
  const [owner] = await db.insert(schema.users).values({ id: "usr_set_up", email: "dana@example.com", emailVerifiedAt: new Date(), timezone: "UTC" }).returning();
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

  it("a finished call is charged at Twilio's price, for each minute it started", async () => {
    const db = await getDb();
    await db.insert(schema.channels).values({ id: "chn_voice_test", botId: bot.id, kind: "voice", status: "active", ownerAddress: "+15125550123", ownerVerifiedAt: new Date() });
    const fromTwilio = (path: string, params: Record<string, string>) => {
      const url = `${appUrl()}${path}`;
      const signed = Object.keys(params)
        .sort()
        .reduce((acc, k) => acc + k + params[k], url);
      const signature = crypto.createHmac("sha1", "twilio_test").update(signed).digest("base64");
      return new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature }, body: new URLSearchParams(params).toString() });
    };
    // The call comes in (and is kept with its bot), then ends a minute and a second later.
    const call = { CallSid: "CA_test", From: "+15125550123", To: "+15555550100" };
    expect((await callRoute.POST(fromTwilio("/api/webhooks/twilio/voice", call))).status).toBe(200);
    const before = await getUsage(db, bot.ownerId);
    const res = await callStatusRoute.POST(fromTwilio("/api/webhooks/twilio/voice/status", { ...call, CallStatus: "completed", CallDuration: "61", Direction: "inbound" }));
    expect(res.status).toBe(200);
    const after = await getUsage(db, bot.ownerId);
    expect(after.voiceSeconds - before.voiceSeconds).toBe(61);
    expect(after.costMicros - before.costMicros).toBe(100_000); // 2 started minutes × $0.05
  });

  it("texts need no plan: one is charged at Twilio's price, and without credit it doesn't go out", async () => {
    expect(notes).toEqual([]);
    const db = await getDb();
    await db
      .update(schema.channels)
      .set({ status: "active", ownerAddress: "+15125550123", ownerVerifiedAt: new Date() })
      .where(and(eq(schema.channels.botId, bot.id), eq(schema.channels.kind, "sms")));
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL) => {
      sent.push(String(url));
      return Response.json({ sid: "SM_test_1" }, { status: 201 });
    });
    const before = await getUsage(db, bot.ownerId);
    expect((await post({ kind: "sms", action: "test" })).status).toBe(200);
    expect(sent).toEqual(["https://api.twilio.com/2010-04-01/Accounts/AC_test/Messages.json"]);
    const after = await getUsage(db, bot.ownerId);
    expect(after.smsSegments - before.smsSegments).toBe(1);
    expect(after.costMicros - before.costMicros).toBe(12_500);

    await recordUsage(db, bot.ownerId, { costMicros: 1_000_001 }); // the starter dollar, and then some
    sent.length = 0;
    const res = await post({ kind: "sms", action: "test" });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "Out of credit: add credit in Credit & usage to send texts and calls.", code: "no_credit" });
    expect(sent).toEqual([]);
  });
});

describe("phone codes", () => {
  it("a code can come by call instead of a text (new numbers can't text until they're registered)", async () => {
    const calls: Record<string, string>[] = [];
    vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit) => {
      expect(String(url)).toBe("https://api.twilio.com/2010-04-01/Accounts/AC_test/Calls.json");
      calls.push(Object.fromEntries(new URLSearchParams(String(init.body))));
      return Response.json({ sid: "CA_code_1" }, { status: 201 });
    });
    const res = await post({ kind: "voice", action: "send_code", payload: { phone: "(512) 555-0188", via: "call" } });
    expect(await res.json()).toEqual({ ok: true, sent: true, via: "call" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ From: "+15555550100", To: "+15125550188" });
    // Said to be an AI, and read a digit at a time, three times.
    const twiml = calls[0].Twiml;
    expect(twiml).toContain("Hi, it&apos;s Inkwell, an AI assistant.");
    const digits = /Your code is: ((?:\d, ){5}\d)\./.exec(twiml)?.[1];
    expect(digits).toBeTruthy();
    expect(twiml.split(digits!).length - 1).toBe(3);

    const verified = await post({ kind: "voice", action: "verify", payload: { code: digits!.replace(/\D/g, "") } });
    expect(await verified.json()).toMatchObject({ ok: true, phone: "+15125550188", number: "+15555550100" });
    const db = await getDb();
    const [voice] = await db.select().from(schema.channels).where(and(eq(schema.channels.botId, bot.id), eq(schema.channels.kind, "voice")));
    expect(voice).toMatchObject({ status: "active", ownerAddress: "+15125550188" });
  });

  it("a code Twilio refuses to send doesn't count against the limits (a new account can't call out yet)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () =>
      Response.json({ code: 21215, message: "Account not authorized to call +15125550177. Perhaps you need to enable some international permissions" }, { status: 400 }),
    );
    // More refusals than the 3 codes an hour a number allows: each is a plain error, never "too many".
    for (let i = 0; i < 4; i++) {
      const res = await post({ kind: "voice", action: "send_code", payload: { phone: "+15125550177", via: "call" } });
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "Something went wrong with Phone calls. Try again in a moment." });
    }
    // Once the account can call out, the code goes out.
    vi.stubGlobal("fetch", async () => Response.json({ sid: "CA_code_2" }, { status: 201 }));
    const res = await post({ kind: "voice", action: "send_code", payload: { phone: "+15125550177", via: "call" } });
    expect(await res.json()).toEqual({ ok: true, sent: true, via: "call" });
  });

  it("too many codes to one number says so, and how long to wait", async () => {
    const db = await getDb();
    const [owner] = await db.insert(schema.users).values({ id: "usr_limits", email: "lee@example.com", emailVerifiedAt: new Date(), timezone: "UTC" }).returning();
    const made = await createBot(db, owner, {
      avatar: "otto",
      color: "grape",
      name: "Pip",
      jobs: [],
      brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: [],
      trust: "ask",
      channels: ["voice"],
      contact: {},
      ageConfirmed: true,
      timezone: "UTC",
    });
    if (!made.ok) throw new Error(made.error);
    vi.stubGlobal("fetch", async () => Response.json({ sid: "CA_code_3" }, { status: 201 }));
    const send = () => channelAction(db, owner, made.bot, "voice", "send_code", { phone: "+15125550166", via: "call" });
    for (let i = 0; i < 3; i++) expect(await send()).toMatchObject({ ok: true });
    const res = await send();
    expect(res).toMatchObject({ ok: false, status: 429 });
    expect(res.ok ? "" : res.error).toMatch(/^Too many codes to that number\. Try again in (a minute|\d+ minutes)\.$/);
  });

  it("codes go only to US and Canada numbers, not Caribbean or 900 numbers that share +1", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("nothing should be sent");
    });
    for (const phone of ["+1 876 555 0123", "+1 809 555 0123", "+1 900 555 0123", "+44 20 7946 0958"]) {
      const res = await post({ kind: "voice", action: "send_code", payload: { phone, via: "call" } });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Texts and calls work with US and Canada numbers for now." });
    }
  });
});
