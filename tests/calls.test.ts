/**
 * Voice calls (the voice server in voice/ does the audio; the app decides who's calling and does
 * the work):
 *
 * - Call tokens and request signatures are the same on both sides.
 * - Who's on the line: the owner's number with the carrier's full attestation is the owner; without
 *   it, a PIN is needed; anyone else is a contact. Only the owner is greeted by name, and "AI
 *   assistant" is said to everyone but the owner after their first call.
 * - A call from the app: started (with credit), taken once by the voice server, its requests done
 *   by the bot's own agent, its transcript kept and shown in the chat, its model use charged at cost.
 * - Phone calls stream to the voice server when it's up; if the stream drops, the simpler line
 *   carries on; streamed minutes cost Twilio's price plus the stream, with no speech fees.
 * - PINs are hashed, weak ones refused, and five wrong tries lock them for 15 minutes.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const SECRET = "v".repeat(48);
process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.VOICE_SERVER_URL = "https://voice.example/";
process.env.VOICE_SERVER_SECRET = SECRET;
process.env.TWILIO_MEDIA_STREAMS = "1";
for (const name of ["DATABASE_URL", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "TOKEN_FACTORY_API_KEY", "STRIPE_SECRET_KEY"]) delete process.env[name];

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => session.user,
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { getUsage } = await import("@/lib/billing/usage");
const { UNIT_PRICES } = await import("@/lib/billing/prices");
const calls = await import("@/lib/calls");
const pins = await import("@/lib/calls/pin");
const tokens = await import("@/lib/calls/tokens");
const voiceAuth = await import("../voice/src/auth");
const startRoute = await import("@/app/api/bots/[botId]/calls/route");
const sessionRoute = await import("@/app/api/calls/session/route");
const actRoute = await import("@/app/api/calls/act/route");
const turnRoute = await import("@/app/api/calls/turn/route");
const pinRoute = await import("@/app/api/calls/pin/route");
const endRoute = await import("@/app/api/calls/end/route");
const pinSettingsRoute = await import("@/app/api/account/phone-pin/route");
const exportRoute = await import("@/app/api/account/export/route");
const voiceRoute = await import("@/app/api/webhooks/twilio/voice/route");
const fallbackRoute = await import("@/app/api/webhooks/twilio/voice/fallback/route");
const statusRoute = await import("@/app/api/webhooks/twilio/voice/status/route");
import type { Bot, User } from "@/lib/db/schema";

let owner: User;
let bot: Bot;
const OWNER_PHONE = "+15125550123";
const BOT_NUMBER = "+15555550199";

/** A request from the voice server, signed as it signs them. */
function fromVoice(path: string, body: unknown, opts: { secret?: string; at?: number } = {}) {
  const text = JSON.stringify(body);
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-voice-signature": voiceAuth.signBody(opts.secret ?? SECRET, text, opts.at) },
    body: text,
  });
}

const twilio = (path: string, params: Record<string, string>) =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });

const botCtx = () => ({ params: Promise.resolve({ botId: bot.id }) });

beforeAll(async () => {
  await resetDbForTests();
  const db = await getDb();
  [owner] = await db.insert(schema.users).values({ id: "usr_caller", email: "diego@example.com", name: "Diego Prozzi", emailVerifiedAt: new Date(), timezone: "America/Chicago" }).returning();
  session.user = owner;
  const res = await createBot(db, owner, {
    avatar: "otto",
    color: "grape",
    name: "Otto",
    jobs: ["research"],
    brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
    connectors: [],
    trust: "ask",
    channels: [],
    contact: {},
    ageConfirmed: true,
    timezone: "America/Chicago",
  });
  if (!res.ok) throw new Error(res.error);
  bot = res.bot;
  await db.insert(schema.channels).values({ id: "chn_call_voice", botId: bot.id, kind: "voice", status: "active", address: BOT_NUMBER, ownerAddress: OWNER_PHONE, ownerVerifiedAt: new Date() });
  // The voice server answers its health check.
  vi.stubGlobal("fetch", async (url: string | URL) => (String(url) === "https://voice.example/health" ? Response.json({ ok: true }) : new Response("no", { status: 404 })));
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await resetDbForTests();
});

describe("trust between the app and the voice server", () => {
  it("call tokens and request signatures are the same on both sides", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const t = tokens.signCallToken(SECRET, { kind: "phone", callId: "call_x", botId: "bot_x", callSid: "CA1", exp });
    expect(voiceAuth.verifyCallToken(SECRET, t)).toEqual({ kind: "phone", callId: "call_x", botId: "bot_x", callSid: "CA1", exp });
    expect(voiceAuth.verifyCallToken("w".repeat(48), t)).toBeNull();
    const body = JSON.stringify({ hello: "there" });
    expect(tokens.verifyBodySignature(SECRET, body, voiceAuth.signBody(SECRET, body))).toBe(true);
    expect(voiceAuth.verifyBodySignature(SECRET, body, tokens.signBody(SECRET, body))).toBe(true);
    expect(tokens.verifyBodySignature(SECRET, `${body} `, voiceAuth.signBody(SECRET, body))).toBe(false);
  });

  it("refuses unsigned, wrongly signed and stale requests", async () => {
    expect((await sessionRoute.POST(new Request("http://localhost/api/calls/session", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await sessionRoute.POST(fromVoice("/api/calls/session", { callId: "x", kind: "web" }, { secret: "w".repeat(48) }))).status).toBe(401);
    expect((await sessionRoute.POST(fromVoice("/api/calls/session", { callId: "x", kind: "web" }, { at: Math.floor(Date.now() / 1000) - 600 }))).status).toBe(401);
  });
});

describe("who's on the line", () => {
  it("the owner's number with full attestation is the owner; without it, unverified; anyone else, a contact", () => {
    expect(calls.phoneSpeaker(OWNER_PHONE, OWNER_PHONE, "TN-Validation-Passed-A")).toBe("owner");
    expect(calls.phoneSpeaker(OWNER_PHONE, OWNER_PHONE, "TN-Validation-Passed-B")).toBe("unverified");
    expect(calls.phoneSpeaker(OWNER_PHONE, OWNER_PHONE, undefined)).toBe("unverified");
    expect(calls.phoneSpeaker(OWNER_PHONE, "+14155550100", "TN-Validation-Passed-A")).toBe("contact");
    expect(calls.phoneSpeaker(null, OWNER_PHONE, "TN-Validation-Passed-A")).toBe("contact");
  });

  it("greetings: by name only for the owner; 'AI assistant' to everyone else and on the owner's first call", () => {
    const g = (speaker: "owner" | "unverified" | "contact", firstCall = false, pinAvailable = false) =>
      calls.greetingFor({ botName: "Otto", firstName: "Diego", speaker, firstCall, pinAvailable, kind: "phone" });
    expect(g("owner", true)).toBe("Hi Diego, it's Otto, your AI assistant. What can I do for you?");
    expect(g("owner")).toBe("Hey Diego, it's Otto. What can I do for you?");
    expect(g("unverified", false, true)).toBe("Hi, it's Otto, an AI assistant. To make sure it's you, say or type your phone PIN.");
    expect(g("unverified")).toMatch(/^Hi, it's Otto, an AI assistant\. .*set a phone PIN in the Build-a-bot app\.$/);
    expect(g("unverified")).not.toMatch(/Diego/);
    expect(g("contact")).toBe("Hi, you've reached Otto, Diego's AI assistant. Diego isn't on this line, but I can take a message.");
  });
});

describe("a call from the app", () => {
  let callId = "";

  it("starts with a short-lived token for the voice server", async () => {
    const res = await startRoute.POST(new Request(`http://localhost/api/bots/${bot.id}/calls`, { method: "POST" }), botCtx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { callId: string; token: string; wsUrl: string };
    expect(body.wsUrl).toBe("wss://voice.example/call");
    const token = voiceAuth.verifyCallToken(SECRET, body.token);
    expect(token).toMatchObject({ kind: "web", callId: body.callId, botId: bot.id });
    expect(token!.exp - Date.now() / 1000).toBeLessThanOrEqual(121);
    callId = body.callId;
  });

  it("the voice server takes it once, and hears who's calling and how to greet them", async () => {
    const res = await sessionRoute.POST(fromVoice("/api/calls/session", { callId, kind: "web" }));
    expect(res.status).toBe(200);
    const info = (await res.json()) as Record<string, unknown>;
    expect(info).toMatchObject({
      callId,
      kind: "web",
      speaker: "owner",
      greeting: "Hi Diego, it's Otto, your AI assistant. What can I do for you?",
      owner: { firstName: "Diego", timezone: "America/Chicago" },
      maxMinutes: 15,
      pinAvailable: false,
    });
    expect((info.bot as { name: string; persona: string }).name).toBe("Otto");
    expect((info.bot as { persona: string }).persona.length).toBeGreaterThan(20);
    expect(info.phrases).toEqual(expect.arrayContaining(["Otto", "Diego", "Prozzi"]));
    expect(String(info.context)).toMatch(/Diego's timezone: America\/Chicago/);
    // A replayed token can't take it again.
    expect((await sessionRoute.POST(fromVoice("/api/calls/session", { callId, kind: "web" }))).status).toBe(409);
  });

  it("requests are done by the bot's own agent, and the transcript fills in", async () => {
    const turn = await turnRoute.POST(fromVoice("/api/calls/turn", { callId, turn: { role: "caller", text: "What can you do?", at: 1200 } }));
    expect(await turn.json()).toEqual({ ok: true });
    const res = await actRoute.POST(fromVoice("/api/calls/act", { callId, request: "What can you do?" }));
    expect(res.status).toBe(200);
    const out = (await res.json()) as { text: string; status: string; approvals: unknown[] };
    expect(out.status).toBe("ok");
    expect(out.text.length).toBeGreaterThan(0);
    // It said nothing about being an AI: the call's greeting did.
    expect(out.text).not.toMatch(/is an AI assistant, not a person/);
    const db = await getDb();
    const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
    expect(call.transcript).toEqual([{ role: "caller", text: "What can you do?", at: 1200 }]);
    const asked = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, call.conversationId!));
    expect(asked.find((m) => m.role === "user")).toMatchObject({ author: "owner", channelKind: "voice", text: "What can you do?" });
  });

  it("at the end: the transcript is kept, the talker's tokens charged at cost, and the call shows in the chat", async () => {
    const db = await getDb();
    const before = await getUsage(db, owner.id);
    const report = {
      endedBy: "caller",
      durationS: 95,
      turns: [
        { role: "bot", text: "Hi Diego, it's Otto, your AI assistant. What can I do for you?", at: 0 },
        { role: "caller", text: "What can you do?", at: 1200 },
        { role: "bot", text: "Lots of things.", at: 2600, interrupted: true },
      ],
      latency: { turns: 1, p50Ms: 820, p90Ms: 820 },
      usage: { inputTokens: 10_000, outputTokens: 1_000, model: "nvidia/Nemotron-3_5-Lightning" },
      engine: { version: "0.2.0" },
    };
    const res = await endRoute.POST(fromVoice("/api/calls/end", { callId, report }));
    expect(res.status).toBe(200);
    // 10,000 tokens in at $0.06 a million and 1,000 out at $0.24 a million.
    expect(await res.json()).toEqual({ costMicros: 840 });
    const after = await getUsage(db, owner.id);
    expect(after.costMicros - before.costMicros).toBe(840);
    expect(after.voiceSeconds - before.voiceSeconds).toBe(95);
    const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
    expect(call).toMatchObject({ status: "ended", durationS: 95, costMicros: 840 });
    expect(call.transcript).toHaveLength(3);
    expect(call.report).toMatchObject({ endedBy: "caller", latency: { p50Ms: 820 }, usage: { model: "nvidia/Nemotron-3_5-Lightning" } });
    const [receipt] = await db.select().from(schema.receipts).where(eq(schema.receipts.kind, "call"));
    expect(receipt).toMatchObject({ title: "Call in the app (2 min)", costMicros: 840 });
    const chat = await db.select().from(schema.messages).where(eq(schema.messages.botId, bot.id));
    const card = chat.find((m) => (m.meta as { kind?: string }).kind === "call");
    expect(card?.text).toBe("Call with Otto, 2 min.");
    expect((card?.meta as { turns: unknown[] }).turns).toHaveLength(3);
    // It's over: no more requests on it.
    expect((await actRoute.POST(fromVoice("/api/calls/act", { callId, request: "One more thing" }))).status).toBe(404);
    expect((await endRoute.POST(fromVoice("/api/calls/end", { callId, report }))).status).toBe(404);
  });

  it("the next call's greeting is short", async () => {
    const res = await startRoute.POST(new Request(`http://localhost/api/bots/${bot.id}/calls`, { method: "POST" }), botCtx());
    const { callId: next } = (await res.json()) as { callId: string };
    const info = (await (await sessionRoute.POST(fromVoice("/api/calls/session", { callId: next, kind: "web" }))).json()) as { greeting: string };
    expect(info.greeting).toBe("Hey Diego, it's Otto. What can I do for you?");
  });

  it("a paused bot can't be called", async () => {
    const db = await getDb();
    await db.update(schema.bots).set({ status: "paused" }).where(eq(schema.bots.id, bot.id));
    const res = await startRoute.POST(new Request(`http://localhost/api/bots/${bot.id}/calls`, { method: "POST" }), botCtx());
    expect(res.status).toBe(409);
    await db.update(schema.bots).set({ status: "active" }).where(eq(schema.bots.id, bot.id));
  });
});

describe("phone PINs", () => {
  it("weak PINs are refused; a PIN is stored hashed and never exported", async () => {
    expect(pins.pinProblem("12")).toMatch(/4 to 8 digits/);
    expect(pins.pinProblem("1111")).toMatch(/repeated/);
    expect(pins.pinProblem("1234")).toMatch(/run of digits/);
    expect(pins.pinProblem("9876")).toMatch(/run of digits/);
    expect(pins.pinProblem("4481")).toBeNull();
    const put = (pin: string) => pinSettingsRoute.PUT(new Request("http://localhost/api/account/phone-pin", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }) }));
    expect((await put("1234")).status).toBe(422);
    expect((await put("4481")).status).toBe(200);
    const db = await getDb();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, owner.id));
    expect(u.phonePinHash).toMatch(/^scrypt\$/);
    expect(u.phonePinHash).not.toContain("4481");
    session.user = u;
    expect(await (await pinSettingsRoute.GET()).json()).toEqual({ set: true, locked: false });
    const exported = await (await exportRoute.GET()).text();
    expect(exported).not.toContain("scrypt$");
    expect(JSON.parse(exported).user.phonePinSet).toBe(true);
    expect(JSON.parse(exported).calls.length).toBeGreaterThan(0);
  });

  it("an unverified caller unlocks the call with the right PIN", async () => {
    const db = await getDb();
    const started = await calls.startCall(db, { bot, kind: "phone", speaker: "unverified", from: OWNER_PHONE, to: BOT_NUMBER, callSid: "CA_pin_1" });
    const info = (await (await sessionRoute.POST(fromVoice("/api/calls/session", { callId: started!.call.id, kind: "phone" }))).json()) as { speaker: string; pinAvailable: boolean; greeting: string; context: string };
    expect(info).toMatchObject({ speaker: "unverified", pinAvailable: true, context: "" });
    expect(info.greeting).toMatch(/say or type your phone PIN/);
    // Nothing is done for them before the PIN.
    const early = (await (await actRoute.POST(fromVoice("/api/calls/act", { callId: started!.call.id, request: "Read my email" }))).json()) as { status: string };
    expect(early.status).toBe("refused");
    const wrong = await (await pinRoute.POST(fromVoice("/api/calls/pin", { callId: started!.call.id, pin: "4482" }))).json();
    expect(wrong).toEqual({ ok: false, remaining: 4, locked: false });
    const right = (await (await pinRoute.POST(fromVoice("/api/calls/pin", { callId: started!.call.id, pin: "4481" }))).json()) as { ok: boolean; firstName: string; context: string };
    expect(right).toMatchObject({ ok: true, firstName: "Diego" });
    expect(right.context).toMatch(/timezone/);
    const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, started!.call.id));
    expect(call.speaker).toBe("owner");
  });

  it("five wrong tries lock PINs for 15 minutes, even the right one", async () => {
    const db = await getDb();
    for (let i = 0; i < 4; i++) expect((await pins.checkPhonePin(db, owner.id, "0000")).ok).toBe(false);
    expect(await pins.checkPhonePin(db, owner.id, "0000")).toEqual({ ok: false, remaining: 0, locked: true, justLocked: true });
    expect(await pins.checkPhonePin(db, owner.id, "4481")).toEqual({ ok: false, remaining: 0, locked: true });
    expect(await pins.checkPhonePin(db, owner.id, "4481", new Date(Date.now() + 16 * 60_000))).toEqual({ ok: true });
  });

  it("five wrong PINs on a call lock them and tell the owner someone may be faking their number", async () => {
    const db = await getDb();
    const started = await calls.startCall(db, { bot, kind: "phone", speaker: "unverified", from: OWNER_PHONE, to: BOT_NUMBER, callSid: "CA_pin_lock" });
    await sessionRoute.POST(fromVoice("/api/calls/session", { callId: started!.call.id, kind: "phone" }));
    const tryPin = async (pin: string) => (await pinRoute.POST(fromVoice("/api/calls/pin", { callId: started!.call.id, pin }))).json();
    for (let i = 4; i >= 1; i--) expect(await tryPin("1357")).toEqual({ ok: false, remaining: i, locked: false });
    expect(await tryPin("1357")).toEqual({ ok: false, remaining: 0, locked: true });
    expect(await tryPin("4481")).toEqual({ ok: false, remaining: 0, locked: true });
    const inbox = await db.select().from(schema.messages).where(eq(schema.messages.botId, bot.id));
    const notices = inbox.filter((m) => m.text.includes("wrong phone PIN"));
    expect(notices).toHaveLength(1);
    expect(notices[0].text).toContain(OWNER_PHONE);
    expect(notices[0].text).not.toContain("1357");
    await pins.setPhonePin(db, owner.id, "4481");
  });
});

describe("phone calls", () => {
  it("stream to the voice server, with a token bound to the call, and a way back if it drops", async () => {
    const res = await voiceRoute.POST(twilio("/api/webhooks/twilio/voice", { CallSid: "CA_stream_1", From: OWNER_PHONE, To: BOT_NUMBER, StirVerstat: "TN-Validation-Passed-A" }));
    const xml = await res.text();
    const m = /<Stream url="wss:\/\/voice\.example\/twilio"><Parameter name="token" value="([^"]+)"\/><\/Stream><\/Connect><Redirect method="POST">([^<]+)<\/Redirect>/.exec(xml);
    expect(m, xml).not.toBeNull();
    const token = voiceAuth.verifyCallToken(SECRET, m![1].replace(/&amp;/g, "&"));
    expect(token).toMatchObject({ kind: "phone", callSid: "CA_stream_1", botId: bot.id });
    const db = await getDb();
    const [call] = await db.select().from(schema.calls).where(eq(schema.calls.callSid, "CA_stream_1"));
    expect(call).toMatchObject({ kind: "phone", speaker: "owner", fromAddress: OWNER_PHONE, status: "pending" });
    expect(m![2]).toContain(`/api/webhooks/twilio/voice/fallback?c=chn_call_voice&amp;call=${call.id}`);
  });

  it("the owner's number without the carrier's full attestation needs the PIN; other callers are contacts", async () => {
    await voiceRoute.POST(twilio("/api/webhooks/twilio/voice", { CallSid: "CA_stream_2", From: OWNER_PHONE, To: BOT_NUMBER, StirVerstat: "TN-Validation-Passed-C" }));
    await voiceRoute.POST(twilio("/api/webhooks/twilio/voice", { CallSid: "CA_stream_3", From: "+14155550100", To: BOT_NUMBER, StirVerstat: "TN-Validation-Passed-A" }));
    const db = await getDb();
    const [b] = await db.select().from(schema.calls).where(eq(schema.calls.callSid, "CA_stream_2"));
    const [c] = await db.select().from(schema.calls).where(eq(schema.calls.callSid, "CA_stream_3"));
    expect(b.speaker).toBe("unverified");
    expect(c.speaker).toBe("contact");
  });

  it("if the stream drops, the simpler line carries on; if the call ended, it hangs up", async () => {
    const db = await getDb();
    const [call] = await db.select().from(schema.calls).where(eq(schema.calls.callSid, "CA_stream_3"));
    const dropped = await (await fallbackRoute.POST(twilio(`/api/webhooks/twilio/voice/fallback?c=chn_call_voice&call=${call.id}`, { CallSid: "CA_stream_3" }))).text();
    expect(dropped).toMatch(/<Gather input="speech" action="[^"]*t=contact"/);
    expect(dropped).toMatch(/I lost my connection/);
    expect(dropped).not.toMatch(/speechModel|enhanced/);
    const [after] = await db.select().from(schema.calls).where(eq(schema.calls.id, call.id));
    expect(after.status).toBe("failed");
    await db.update(schema.calls).set({ status: "ended" }).where(eq(schema.calls.id, call.id));
    const done = await (await fallbackRoute.POST(twilio(`/api/webhooks/twilio/voice/fallback?c=chn_call_voice&call=${call.id}`, { CallSid: "CA_stream_3" }))).text();
    expect(done).toContain("<Hangup/>");
    expect(done).not.toContain("<Gather");
  });

  it("with the voice server down, the simpler line answers, and greets only the owner by name", async () => {
    calls.forgetVoiceHealth();
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    const owners = await (await voiceRoute.POST(twilio("/api/webhooks/twilio/voice", { CallSid: "CA_g1", From: OWNER_PHONE, To: BOT_NUMBER, StirVerstat: "TN-Validation-Passed-A" }))).text();
    expect(owners).toMatch(/Hi Diego, it&apos;s Otto/);
    expect(owners).not.toContain("<Stream");
    const others = await (await voiceRoute.POST(twilio("/api/webhooks/twilio/voice", { CallSid: "CA_g2", From: "+14155550100", To: BOT_NUMBER }))).text();
    expect(others).toMatch(/you&apos;ve reached Otto, an AI assistant/);
    expect(others).not.toMatch(/Diego/);
    expect(others).toMatch(/t=contact/);
    calls.forgetVoiceHealth();
    vi.stubGlobal("fetch", async (url: string | URL) => (String(url) === "https://voice.example/health" ? Response.json({ ok: true }) : new Response("no", { status: 404 })));
  });

  it("a streamed call costs Twilio's minute plus the stream, with no speech fees", async () => {
    const db = await getDb();
    const [call] = await db.select().from(schema.calls).where(eq(schema.calls.callSid, "CA_stream_1"));
    await db.update(schema.calls).set({ status: "ended" }).where(eq(schema.calls.id, call.id));
    const before = await getUsage(db, owner.id);
    const res = await statusRoute.POST(twilio("/api/webhooks/twilio/voice/status", { CallSid: "CA_stream_1", CallStatus: "completed", CallDuration: "130", Direction: "inbound", From: OWNER_PHONE, To: BOT_NUMBER }));
    expect(res.status).toBe(200);
    const after = await getUsage(db, owner.id);
    expect(after.costMicros - before.costMicros).toBe(3 * UNIT_PRICES.callMinuteStreamIn);
    expect(after.voiceSeconds - before.voiceSeconds).toBe(130);
    const [billed] = await db.select().from(schema.calls).where(eq(schema.calls.id, call.id));
    expect(billed.costMicros).toBe(3 * UNIT_PRICES.callMinuteStreamIn);
  });
});
