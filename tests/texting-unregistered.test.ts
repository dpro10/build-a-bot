/**
 * Twilio set up, but the number isn't registered to text US phones yet (no TWILIO_TEXTING), which
 * is where a new number starts: carriers drop its texts. So calls work and texting stays off:
 * Text messages is coming soon, phone codes come by call, a text code is refused without costing
 * a try, the calls channel's number doesn't switch texting on, and incoming texts get no reply.
 */
import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "0";
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.TWILIO_ACCOUNT_SID = "AC_test";
process.env.TWILIO_AUTH_TOKEN = "twilio_test";
process.env.TWILIO_PHONE_NUMBER = "+15555550100";
for (const name of ["DATABASE_URL", "TWILIO_TEXTING", "STRIPE_SECRET_KEY"]) delete process.env[name];

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { appUrl, live } = await import("@/lib/env");
const { CHANNEL_BY_KIND, channelAvailability } = await import("@/lib/channels/catalog");
const { channelAction } = await import("@/lib/channels/setup");
const { smsAdapter } = await import("@/lib/channels/twilio");
const smsRoute = await import("@/app/api/webhooks/twilio/sms/route");
import type { Bot, User } from "@/lib/db/schema";

let owner: User;
let bot: Bot;

beforeAll(async () => {
  await resetDbForTests();
  const db = await getDb();
  [owner] = await db.insert(schema.users).values({ id: "usr_calls_only", email: "sam@example.com", emailVerifiedAt: new Date(), timezone: "UTC" }).returning();
  const made = await createBot(db, owner, {
    avatar: "otto",
    color: "grape",
    name: "Otto",
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
  bot = made.bot;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("a number that can't text yet", () => {
  it("calls work; Text messages is coming soon", () => {
    expect(live.twilio).toBe(true);
    expect(live.twilioTexting).toBe(false);
    expect(channelAvailability(CHANNEL_BY_KIND.voice, false, live)).toBe("available");
    expect(channelAvailability(CHANNEL_BY_KIND.sms, false, live)).toBe("soon");
    expect(smsAdapter.isLive(null as never)).toBe(false);
  });

  it("a text code is refused before anything is sent, and doesn't use up a try", async () => {
    const db = await getDb();
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL) => {
      sent.push(String(url));
      return Response.json({ sid: "CA_code" }, { status: 201 });
    });
    // More than the 3 codes an hour a number gets: none of these count.
    for (let i = 0; i < 4; i++) {
      expect(await channelAction(db, owner, bot, "voice", "send_code", { phone: "+15125550144", via: "sms" })).toEqual({
        ok: false,
        error: "Texts aren't set up here yet. Use Call me with a code.",
      });
    }
    expect(sent).toEqual([]);
    expect(await channelAction(db, owner, bot, "voice", "send_code", { phone: "+15125550144", via: "call" })).toMatchObject({ ok: true, data: { sent: true, via: "call" } });
    expect(sent).toEqual(["https://api.twilio.com/2010-04-01/Accounts/AC_test/Calls.json"]);
  });

  it("verifying the calls channel doesn't switch on a texts channel that can't work yet", async () => {
    const db = await getDb();
    // A texts channel from before (say, picked in the builder): it keeps its state.
    await db.insert(schema.channels).values({ id: "chn_sms_old", botId: bot.id, kind: "sms", status: "needs_setup" });
    let code = "";
    vi.stubGlobal("fetch", async (_url: string | URL, init: RequestInit) => {
      code = /Your code is: ((?:\d, ){5}\d)\./.exec(new URLSearchParams(String(init.body)).get("Twiml") ?? "")?.[1]?.replace(/\D/g, "") ?? "";
      return Response.json({ sid: "CA_code_2" }, { status: 201 });
    });
    await channelAction(db, owner, bot, "voice", "send_code", { phone: "+15125550145", via: "call" });
    expect(await channelAction(db, owner, bot, "voice", "verify", { code })).toMatchObject({ ok: true, data: { phone: "+15125550145" } });
    const status = async (kind: "sms" | "voice") =>
      (await db.select().from(schema.channels).where(and(eq(schema.channels.botId, bot.id), eq(schema.channels.kind, kind))))[0];
    expect(await status("voice")).toMatchObject({ status: "active", ownerAddress: "+15125550145" });
    // It has the verified number, ready for when texting is on, but stays off.
    expect(await status("sms")).toMatchObject({ status: "needs_setup", ownerAddress: "+15125550145" });
  });

  it("incoming texts get no reply (the carrier would drop it) and don't run the bot", async () => {
    const params: Record<string, string> = { MessageSid: "SM_in_1", From: "+15125550145", To: "+15555550100", Body: "hi", NumSegments: "1" };
    const url = `${appUrl()}/api/webhooks/twilio/sms`;
    const signed = Object.keys(params)
      .sort()
      .reduce((acc, k) => acc + k + params[k], url);
    const signature = crypto.createHmac("sha1", "twilio_test").update(signed).digest("base64");
    const res = await smsRoute.POST(
      new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature }, body: new URLSearchParams(params).toString() }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    const db = await getDb();
    expect(await db.select().from(schema.messages).where(eq(schema.messages.botId, bot.id))).toEqual([]);
    // A forged one is still refused.
    const forged = await smsRoute.POST(
      new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "AAAA" }, body: new URLSearchParams(params).toString() }),
    );
    expect(forged.status).toBe(403);
  });
});
