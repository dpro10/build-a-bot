/**
 * Everyone's bots answer on one shared Twilio number, so the number someone dials doesn't say whose
 * bot they want: the phone they call or text from does. Owners link their phones the way the app
 * does it (a call reads them a code), and then:
 *
 * - each owner reaches their own bot, whoever linked first; a phone that isn't linked hears how to
 *   link it, and one whose bot has calls off hears that, instead of reaching someone else's bot;
 * - someone with several bots reaches the one they used last;
 * - a bot's own number (one no other bot uses) still answers anyone;
 * - texts follow the same rules;
 * - a call is charged once, to the owner of the bot it reached (an incoming call, through the call
 *   itself; a call the bot places, through a link Twilio signs), and a call that reached no bot
 *   isn't charged to anyone.
 *
 * Twilio's requests are signed the way Twilio signs them.
 */
import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

const SHARED = "+15555550100";
process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "0";
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.TWILIO_ACCOUNT_SID = "AC_test";
process.env.TWILIO_AUTH_TOKEN = "twilio_test";
process.env.TWILIO_PHONE_NUMBER = SHARED;
process.env.TWILIO_TEXTING = "1";
for (const name of ["DATABASE_URL", "STRIPE_SECRET_KEY", "TOKEN_FACTORY_API_KEY", "VOICE_SERVER_URL", "VOICE_SERVER_SECRET", "TWILIO_MEDIA_STREAMS", "STARTER_CREDIT_USD"]) delete process.env[name];

// Webhook work runs after the response: run it right away and let tests wait for it.
const background = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => void background.push(Promise.resolve().then(fn)),
}));
// The bot's brain isn't what's tested here: it notes which bot heard what, and from whom.
const heard = vi.hoisted(() => [] as { bot: string; author: string; text: string }[]);
vi.mock("@/lib/agent/run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/run")>()),
  runTurn: async (input: { bot: { id: string; name: string }; message: { text: string; author: string } }) => {
    heard.push({ bot: input.bot.id, author: input.message.author, text: input.message.text });
    return { status: "ok", text: `${input.bot.name} here.`, messageId: null, approvals: [] };
  },
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { appUrl } = await import("@/lib/env");
const { getUsage } = await import("@/lib/billing/usage");
const { UNIT_PRICES } = await import("@/lib/billing/prices");
const { channelAction } = await import("@/lib/channels/setup");
const voiceRoute = await import("@/app/api/webhooks/twilio/voice/route");
const statusRoute = await import("@/app/api/webhooks/twilio/voice/status/route");
const smsRoute = await import("@/app/api/webhooks/twilio/sms/route");
import type { Bot, User } from "@/lib/db/schema";

/** Dana links her phone first (like the first account on the site); Sam, a friend, second. */
const DANA = "+15125550123";
const SAM = "+15125550188";
const STRANGER = "+14155550100";
/** A number of one bot's own. */
const OWN_NUMBER = "+15555550177";

let dana: User;
let sam: User;
let otto: Bot;
let juniper: Bot;

/** A webhook as Twilio sends it: form-encoded, signed over the full URL and the sorted parameters. */
function fromTwilio(path: string, params: Record<string, string>, signedPath = path) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], `${appUrl()}${signedPath}`);
  const signature = crypto.createHmac("sha1", "twilio_test").update(data).digest("base64");
  return new Request(`${appUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature },
    body: new URLSearchParams(params).toString(),
  });
}

/** A call to the shared number, from a phone the carrier vouches for (STIR/SHAKEN A). What it hears. */
const call = async (from: string, callSid: string, to = SHARED) =>
  (await voiceRoute.POST(fromTwilio("/api/webhooks/twilio/voice", { CallSid: callSid, From: from, To: to, StirVerstat: "TN-Validation-Passed-A" }))).text();

/** Twilio reporting that an incoming call to the shared number is over. */
const callEnded = (callSid: string, from: string, seconds: number) =>
  statusRoute.POST(
    fromTwilio("/api/webhooks/twilio/voice/status", { CallSid: callSid, CallStatus: "completed", CallDuration: String(seconds), Direction: "inbound", From: from, To: SHARED }),
  );

const text = (from: string, messageSid: string, body: string) =>
  smsRoute.POST(fromTwilio("/api/webhooks/twilio/sms", { MessageSid: messageSid, From: from, To: SHARED, Body: body, NumSegments: "1" }));

/** What the app asked Twilio's API to do (code calls, the bots' own calls and texts). */
let twilioApi: { path: string; body: Record<string, string> }[] = [];
function stubTwilioApi() {
  twilioApi = [];
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit) => {
    const path = String(url).replace("https://api.twilio.com/2010-04-01/Accounts/AC_test/", "");
    twilioApi.push({ path, body: Object.fromEntries(new URLSearchParams(String(init.body))) });
    return Response.json({ sid: `${path === "Messages.json" ? "SM" : "CA"}_api_${twilioApi.length}` }, { status: 201 });
  });
}

async function makeBot(owner: User, name: string): Promise<Bot> {
  const db = await getDb();
  const made = await createBot(db, owner, {
    avatar: "otto",
    color: "grape",
    name,
    jobs: [],
    brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
    connectors: [],
    trust: "ask",
    channels: ["voice", "sms"],
    contact: {},
    ageConfirmed: true,
    timezone: "UTC",
  });
  if (!made.ok) throw new Error(made.error);
  return made.bot;
}

/** Link a phone to a bot the way the app does: a call reads out a code, and the owner types it in. */
async function linkPhone(owner: User, bot: Bot, phone: string) {
  const db = await getDb();
  stubTwilioApi();
  expect(await channelAction(db, owner, bot, "voice", "send_code", { phone, via: "call" })).toMatchObject({ ok: true });
  const codeCall = twilioApi.at(-1)!;
  expect(codeCall).toMatchObject({ path: "Calls.json", body: { From: SHARED, To: phone } });
  // The code call is ours: Twilio isn't asked to report on it, so it's charged to no one.
  expect(codeCall.body).not.toHaveProperty("StatusCallback");
  const code = /Your code is: ((?:\d, ){5}\d)\./.exec(codeCall.body.Twiml)![1].replace(/\D/g, "");
  expect(await channelAction(db, owner, bot, "voice", "verify", { code })).toMatchObject({ ok: true, data: { phone, number: SHARED } });
}

async function channelOf(bot: Bot, kind: "voice" | "sms") {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.botId, bot.id), eq(schema.channels.kind, kind)));
  return row;
}

async function spent(user: User) {
  const u = await getUsage(await getDb(), user.id);
  return { costMicros: u.costMicros, voiceSeconds: u.voiceSeconds };
}

beforeAll(async () => {
  await resetDbForTests();
  const db = await getDb();
  [dana] = await db.insert(schema.users).values({ id: "usr_dana", email: "dana@example.com", name: "Dana Diaz", emailVerifiedAt: new Date(), timezone: "UTC" }).returning();
  [sam] = await db.insert(schema.users).values({ id: "usr_sam", email: "sam@example.com", name: "Sam Lee", emailVerifiedAt: new Date(), timezone: "UTC" }).returning();
  otto = await makeBot(dana, "Otto");
  juniper = await makeBot(sam, "Juniper");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("calls to the shared number", () => {
  it("with one phone linked, a stranger doesn't reach that bot: they hear how to link their own phone", async () => {
    await linkPhone(dana, otto, DANA);
    // The bot calls and texts from the shared number, so it's saved as the bot's number.
    expect(await channelOf(otto, "voice")).toMatchObject({ status: "active", address: SHARED, ownerAddress: DANA });
    const heardByStranger = await call(STRANGER, "CA_stranger_1");
    expect(heardByStranger).toContain("This number answers for the bots people build in the app. Link this phone in the app, then call back.");
    expect(heardByStranger).toContain("<Hangup/>");
    expect(heardByStranger).not.toContain("<Gather");
    expect(heardByStranger).not.toMatch(/Otto|Dana/);
  });

  it("each owner reaches their own bot, whoever linked first", async () => {
    await linkPhone(sam, juniper, SAM);
    expect(await channelOf(juniper, "voice")).toMatchObject({ status: "active", address: SHARED, ownerAddress: SAM });

    const heardBySam = await call(SAM, "CA_sam_1");
    expect(heardBySam).toContain("Hi Sam, it&apos;s Juniper, your AI assistant.");
    expect(heardBySam).toContain(`c=${(await channelOf(juniper, "voice")).id}&amp;`);
    expect(heardBySam).not.toMatch(/Otto|Dana/);

    const heardByDana = await call(DANA, "CA_dana_1");
    expect(heardByDana).toContain("Hi Dana, it&apos;s Otto, your AI assistant.");
    expect(heardByDana).toContain(`c=${(await channelOf(otto, "voice")).id}&amp;`);
    expect(heardByDana).not.toMatch(/Juniper|Sam/);
  });

  it("a phone whose bot has calls turned off hears that, and reaches no one else's bot", async () => {
    const db = await getDb();
    expect(await channelAction(db, sam, juniper, "voice", "disable", {})).toMatchObject({ ok: true });
    const heardBySam = await call(SAM, "CA_sam_off");
    expect(heardBySam).toContain("Calls are turned off for your bot. Turn them on in the app, then call back.");
    expect(heardBySam).not.toContain("<Gather");
    expect(heardBySam).not.toMatch(/Otto|Juniper/);

    expect(await channelAction(db, sam, juniper, "voice", "enable", {})).toMatchObject({ ok: true, data: { status: "active" } });
    expect(await call(SAM, "CA_sam_on")).toContain("it&apos;s Juniper");
  });

  it("someone with several bots reaches the one they used last", async () => {
    const pip = await makeBot(dana, "Pip");
    await linkPhone(dana, pip, DANA);
    const db = await getDb();
    const lastActive = (bot: Bot, at: Date | null) => db.update(schema.bots).set({ lastActiveAt: at }).where(eq(schema.bots.id, bot.id));
    // Pip is new and hasn't done anything yet: Otto, used an hour ago, answers.
    await lastActive(otto, new Date(Date.now() - 3600_000));
    await lastActive(pip, null);
    expect(await call(DANA, "CA_dana_2")).toContain("it&apos;s Otto");
    await lastActive(pip, new Date());
    expect(await call(DANA, "CA_dana_3")).toContain("it&apos;s Pip");
  });

  it("a bot's own number, one no other bot uses, answers anyone", async () => {
    const db = await getDb();
    const [lee] = await db.insert(schema.users).values({ id: "usr_lee", email: "lee@example.com", name: "Lee", emailVerifiedAt: new Date(), timezone: "UTC" }).returning();
    const wren = await makeBot(lee, "Wren");
    await db
      .update(schema.channels)
      .set({ status: "active", address: OWN_NUMBER, ownerAddress: "+15125550166", ownerVerifiedAt: new Date() })
      .where(and(eq(schema.channels.botId, wren.id), eq(schema.channels.kind, "voice")));
    expect(await call(STRANGER, "CA_own_1", OWN_NUMBER)).toContain("you&apos;ve reached Wren, an AI assistant");

    // Another bot taking calls on the same number: it's no longer one bot's own, so no one answers.
    const moss = await makeBot(lee, "Moss");
    const mossCalls = and(eq(schema.channels.botId, moss.id), eq(schema.channels.kind, "voice"));
    await db.update(schema.channels).set({ status: "active", address: OWN_NUMBER }).where(mossCalls);
    const heardByStranger = await call(STRANGER, "CA_own_2", OWN_NUMBER);
    expect(heardByStranger).toContain("Sorry, this number can&apos;t take your call.");
    expect(heardByStranger).not.toMatch(/Wren|Moss/);
    // Only bots taking calls count.
    await db.update(schema.channels).set({ status: "disabled" }).where(mossCalls);
    expect(await call(STRANGER, "CA_own_3", OWN_NUMBER)).toContain("you&apos;ve reached Wren");
  });
});

describe("texts to the shared number", () => {
  it("go to the sender's own bot; a stranger's reach no bot and get no reply", async () => {
    heard.length = 0;
    background.length = 0;
    stubTwilioApi();
    expect((await text(SAM, "SM_sam_1", "Remind me to call Mom at 5")).status).toBe(200);
    expect((await text(STRANGER, "SM_stranger_1", "hello?")).status).toBe(200);
    await Promise.all(background);
    expect(heard).toEqual([{ bot: juniper.id, author: "owner", text: "Remind me to call Mom at 5" }]);
    // The reply goes back to Sam, from the shared number.
    expect(twilioApi).toEqual([{ path: "Messages.json", body: expect.objectContaining({ From: SHARED, To: SAM, Body: "Juniper here." }) }]);
  });

  it('"@Name" picks one of the sender\'s own bots', async () => {
    heard.length = 0;
    background.length = 0;
    stubTwilioApi();
    // Pip was used last, but Dana asks for Otto.
    await text(DANA, "SM_dana_1", "@Otto what's on today?");
    await text(DANA, "SM_dana_2", "@Juniper what's on today?");
    await Promise.all(background);
    expect(heard.map((h) => [h.bot === otto.id ? "Otto" : h.bot === juniper.id ? "Juniper" : "Pip", h.text])).toEqual([
      ["Otto", "what's on today?"],
      ["Pip", "@Juniper what's on today?"],
    ]);
  });
});

describe("what calls cost, and who pays", () => {
  it("a call is charged to the owner of the bot it reached, at Twilio's price for each minute it started", async () => {
    const before = { sam: await spent(sam), dana: await spent(dana) };
    expect((await callEnded("CA_sam_1", SAM, 61)).status).toBe(200);
    expect(await spent(sam)).toEqual({ costMicros: before.sam.costMicros + 2 * UNIT_PRICES.callMinute, voiceSeconds: before.sam.voiceSeconds + 61 });
    expect(await spent(dana)).toEqual(before.dana);
    const db = await getDb();
    const [row] = await db.select().from(schema.calls).where(eq(schema.calls.callSid, "CA_sam_1"));
    expect(row).toMatchObject({
      botId: juniper.id,
      ownerId: sam.id,
      kind: "phone",
      direction: "inbound",
      speaker: "owner",
      fromAddress: SAM,
      toAddress: SHARED,
      durationS: 61,
      costMicros: 2 * UNIT_PRICES.callMinute,
    });
  });

  it("Twilio reporting the same call again doesn't charge it again", async () => {
    const before = { sam: await spent(sam), dana: await spent(dana) };
    expect((await callEnded("CA_sam_1", SAM, 61)).status).toBe(200);
    expect({ sam: await spent(sam), dana: await spent(dana) }).toEqual(before);
  });

  it("a call that reached no bot isn't charged to anyone", async () => {
    const before = { sam: await spent(sam), dana: await spent(dana) };
    expect((await callEnded("CA_stranger_1", STRANGER, 30)).status).toBe(200);
    expect((await callEnded("CA_sam_off", SAM, 15)).status).toBe(200);
    expect({ sam: await spent(sam), dana: await spent(dana) }).toEqual(before);
  });

  it("a call the bot places is charged to its owner, through a link Twilio signs", async () => {
    const db = await getDb();
    stubTwilioApi();
    expect(await channelAction(db, sam, juniper, "voice", "call_me", {})).toMatchObject({ ok: true, data: { status: "sent" } });
    const statusPath = `/api/webhooks/twilio/voice/status?b=${juniper.id}`;
    expect(twilioApi).toEqual([{ path: "Calls.json", body: expect.objectContaining({ From: SHARED, To: SAM, StatusCallback: `${appUrl()}${statusPath}` }) }]);

    const before = { sam: await spent(sam), dana: await spent(dana) };
    const ended = { CallSid: "CA_out_1", CallStatus: "completed", CallDuration: "20", Direction: "outbound-api", From: SHARED, To: SAM };
    // The link can't be pointed at someone else's bot: Twilio's signature covers it.
    expect((await statusRoute.POST(fromTwilio(`/api/webhooks/twilio/voice/status?b=${otto.id}`, ended, statusPath))).status).toBe(403);
    expect((await statusRoute.POST(fromTwilio(statusPath, ended))).status).toBe(200);
    expect(await spent(sam)).toEqual({ costMicros: before.sam.costMicros + UNIT_PRICES.callMinuteOut, voiceSeconds: before.sam.voiceSeconds + 20 });
    expect(await spent(dana)).toEqual(before.dana);
  });
});
