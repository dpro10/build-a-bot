/**
 * Voice calls with a bot, from the app's side. The voice server (voice/) owns the audio and the
 * conversation's timing; the app decides everything that's the bot's business:
 *
 *   start   a call row and a short-lived token for it (the browser's Call button, or the Twilio
 *           webhook when a phone call comes in)
 *   session who's on the line and what they may do, the bot's persona, the first words
 *   act     a request from the call, run through the bot's own agent (apps, memory, approvals,
 *           receipts: the same safeguards as a chat)
 *   pin     the owner proving it's them when caller ID isn't enough
 *   end     the transcript and report; what it cost, at cost
 *
 * Who's on the line (decided when the call starts):
 *   owner       the app's Call button (signed in), or the owner's verified number with the carrier's
 *               full STIR/SHAKEN attestation (A)
 *   unverified  the owner's number without full attestation (caller ID can be faked): a PIN unlocks it
 *   contact     anyone else: polite, takes messages, does nothing for them
 */
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Bot, Call, CallTurn, User } from "@/lib/db/schema";
import { config, live } from "@/lib/env";
import { AVATARS, isAvatarId } from "@/lib/avatars";
import { roleOf } from "@/lib/roles";
import { receipt, runTurn } from "@/lib/agent/run";
import { ensureConversation, messageOwner } from "@/lib/channels/outbound";
import { loadMemories } from "@/lib/memory";
import { CONNECTOR_BY_ID } from "@/lib/connectors";
import { INCLUDED_MODELS, resolveIncludedModelId } from "@/lib/models/catalog";
import { tokensMicros } from "@/lib/billing/prices";
import { recordUsage } from "@/lib/billing/usage";
import { newId, sortableId, truncate } from "@/lib/utils";
import { signCallToken } from "./tokens";
import { checkPhonePin, PIN_MAX_FAILURES, pinLocked } from "./pin";

export type Speaker = "owner" | "unverified" | "contact";

/** How long a call token is good for: long enough to connect, too short to keep. */
export const CALL_TOKEN_TTL_S = { web: 120, phone: 600 } as const;
export const MAX_CALL_MINUTES = { web: 15, phone: 20 } as const;
/** A call the voice server never picked up is stale after this. */
const PENDING_FOR_MS = 15 * 60_000;
const MAX_TURNS = 400;

/** The SHAKEN attestation that means the carrier vouches for the caller's number. */
export const FULL_ATTESTATION = "TN-Validation-Passed-A";

export function voiceServer(): { url: string; wsUrl: string; secret: string } | null {
  if (!live.voiceServer) return null;
  const url = config.voice.serverUrl!;
  return { url, wsUrl: url.replace(/^http/, "ws"), secret: config.voice.secret! };
}

let health: { at: number; ok: boolean } | null = null;

/** Is the voice server up? Asked at most every 20 s (5 s after a failure), and never for long. */
export async function voiceServerUp(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const server = voiceServer();
  if (!server) return false;
  const now = Date.now();
  if (health && now - health.at < (health.ok ? 20_000 : 5_000)) return health.ok;
  let ok = false;
  try {
    const res = await fetchImpl(`${server.url}/health`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    ok = res.ok;
  } catch {
    ok = false;
  }
  health = { at: now, ok };
  return ok;
}

export function forgetVoiceHealth(): void {
  health = null;
}

/** Who a phone caller is, from the number they're calling from and the carrier's attestation. */
export function phoneSpeaker(ownerAddress: string | null, from: string | undefined, stirVerstat: string | undefined): Speaker {
  if (!ownerAddress || !from || ownerAddress !== from) return "contact";
  return stirVerstat === FULL_ATTESTATION ? "owner" : "unverified";
}

export type StartedCall = { call: Call; token: string; wsUrl: string };

export async function startCall(
  db: Db,
  input: { bot: Pick<Bot, "id" | "ownerId">; kind: "web" | "phone"; speaker: Speaker; direction?: "inbound" | "outbound"; from?: string; to?: string; callSid?: string },
): Promise<StartedCall | null> {
  const server = voiceServer();
  if (!server) return null;
  const values = {
    id: newId("call"),
    botId: input.bot.id,
    ownerId: input.bot.ownerId,
    kind: input.kind,
    direction: input.direction ?? "inbound",
    speaker: input.speaker,
    fromAddress: input.from ?? null,
    toAddress: input.to ?? null,
    callSid: input.callSid ?? null,
  };
  let [call] = await db.insert(schema.calls).values(values).onConflictDoNothing().returning();
  if (!call && input.callSid) {
    // Twilio asked twice for the same call: reuse it while it hasn't started.
    [call] = await db
      .select()
      .from(schema.calls)
      .where(and(eq(schema.calls.callSid, input.callSid), eq(schema.calls.status, "pending")))
      .limit(1);
  }
  if (!call) return null;
  const token = signCallToken(server.secret, {
    kind: input.kind,
    callId: call.id,
    botId: input.bot.id,
    ...(input.callSid ? { callSid: input.callSid } : {}),
    exp: Math.floor(Date.now() / 1000) + CALL_TOKEN_TTL_S[input.kind],
  });
  return { call, token, wsUrl: `${server.wsUrl}/${input.kind === "phone" ? "twilio" : "call"}` };
}

/** The voice server takes the call: once only, and only while it's fresh. */
export async function claimCall(db: Db, callId: string, kind: "web" | "phone"): Promise<Call | null> {
  const [row] = await db
    .update(schema.calls)
    .set({ status: "active", startedAt: new Date() })
    .where(and(eq(schema.calls.id, callId), eq(schema.calls.kind, kind), eq(schema.calls.status, "pending"), gt(schema.calls.createdAt, new Date(Date.now() - PENDING_FOR_MS))))
    .returning();
  return row ?? null;
}

export async function activeCall(db: Db, callId: string): Promise<Call | null> {
  const [row] = await db
    .select()
    .from(schema.calls)
    .where(and(eq(schema.calls.id, callId), eq(schema.calls.status, "active")))
    .limit(1);
  return row ?? null;
}

async function botAndOwner(db: Db, call: Call): Promise<{ bot: Bot; owner: User } | null> {
  const [bot] = await db.select().from(schema.bots).where(eq(schema.bots.id, call.botId)).limit(1);
  const [owner] = await db.select().from(schema.users).where(eq(schema.users.id, call.ownerId)).limit(1);
  return bot && owner ? { bot, owner } : null;
}

/** The owner's first name, if they've given one (an email address isn't something to say out loud). */
export function callFirstName(owner: Pick<User, "name">): string | null {
  return owner.name?.trim().split(/\s+/)[0] || null;
}

/** How prompts refer to the owner. */
const firstNameOf = (owner: User) => callFirstName(owner) ?? "the owner";

function persona(bot: Bot, owner: User): string {
  const avatar = isAvatarId(bot.avatar) ? AVATARS[bot.avatar] : AVATARS.blip;
  const role = roleOf(bot);
  return [
    avatar.personality.prompt,
    bot.vibe?.tone?.trim() ? `Tone ${firstNameOf(owner)} asked for: ${truncate(bot.vibe.tone.trim(), 80)}.` : "",
    role ? `You're ${firstNameOf(owner)}'s ${role.title}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** A few lines for the talker: what the bot can reach, what it knows best, what's waiting. */
export async function ownerContext(db: Db, bot: Bot, owner: User): Promise<string> {
  const [apps, memories, waiting] = await Promise.all([
    db
      .select({ connectorId: schema.connections.connectorId })
      .from(schema.connections)
      .where(and(eq(schema.connections.botId, bot.id), eq(schema.connections.status, "active"))),
    loadMemories(db, bot.id),
    db
      .select({ title: schema.approvals.title })
      .from(schema.approvals)
      .where(and(eq(schema.approvals.botId, bot.id), eq(schema.approvals.status, "pending")))
      .orderBy(desc(schema.approvals.createdAt))
      .limit(3),
  ]);
  const appNames = [...new Set(apps.map((a) => CONNECTOR_BY_ID[a.connectorId]?.name).filter(Boolean))];
  const known = [...memories.filter((m) => m.pinned), ...memories.filter((m) => !m.pinned)].slice(0, 6).map((m) => truncate(m.text, 160));
  return [
    `${firstNameOf(owner)}'s timezone: ${owner.timezone || "UTC"}.`,
    appNames.length ? `Connected apps: ${appNames.join(", ")}.` : `No apps connected yet (${firstNameOf(owner)} can connect them in the app).`,
    known.length ? `Some things you know about ${firstNameOf(owner)}:\n${known.map((k) => `- ${k}`).join("\n")}` : "",
    waiting.length ? `Waiting for ${firstNameOf(owner)}'s OK in the app: ${waiting.map((w) => truncate(w.title, 80)).join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The words the bot should catch even when they're unusual: its name, its owner's, the apps'. */
async function phrasesFor(db: Db, bot: Bot, owner: User): Promise<string[]> {
  const apps = await db.select({ connectorId: schema.connections.connectorId }).from(schema.connections).where(eq(schema.connections.botId, bot.id));
  const words = [bot.name, ...(owner.name ?? "").split(/\s+/), ...apps.map((a) => CONNECTOR_BY_ID[a.connectorId]?.name ?? "")];
  return [...new Set(words.map((w) => w.trim()).filter((w) => w.length > 1))].slice(0, 30);
}

/**
 * First words. "AI assistant" is said to anyone who isn't the owner, and to the owner on the first
 * call. Without a first name on the account, the greeting just doesn't use one.
 */
export function greetingFor(input: { botName: string; firstName: string | null; speaker: Speaker; firstCall: boolean; pinAvailable: boolean; kind: "web" | "phone" }): string {
  const { botName, firstName, speaker } = input;
  const name = firstName ? ` ${firstName}` : "";
  if (speaker === "owner") {
    return input.firstCall ? `Hi${name}, it's ${botName}, your AI assistant. What can I do for you?` : `Hey${name}, it's ${botName}. What can I do for you?`;
  }
  if (speaker === "unverified") {
    return input.pinAvailable
      ? `Hi, it's ${botName}, an AI assistant. To make sure it's you, say or type your phone PIN.`
      : `Hi, it's ${botName}, an AI assistant. I can't confirm who's calling from this phone, so I can only take a message. To unlock calls from your phone, set a phone PIN in the Build-a-bot app.`;
  }
  return firstName
    ? `Hi, you've reached ${botName}, ${firstName}'s AI assistant. ${firstName} isn't on this line, but I can take a message.`
    : `Hi, you've reached ${botName}, an AI assistant. The person I work for isn't on this line, but I can take a message.`;
}

export type CallSessionInfo = {
  callId: string;
  kind: "web" | "phone";
  bot: { id: string; name: string; persona: string; voice?: string };
  owner: { firstName: string; timezone: string };
  speaker: Speaker;
  greeting: string;
  context: string;
  phrases: string[];
  language?: string;
  maxMinutes: number;
  pinAvailable: boolean;
};

/** Everything the voice server needs to run the call. */
export async function callSession(db: Db, call: Call): Promise<CallSessionInfo | null> {
  const loaded = await botAndOwner(db, call);
  if (!loaded) return null;
  const { bot, owner } = loaded;
  const speaker = call.speaker as Speaker;
  const kind = call.kind as "web" | "phone";
  const [earlier] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.calls)
    .where(and(eq(schema.calls.botId, bot.id), eq(schema.calls.status, "ended"), eq(schema.calls.speaker, "owner")));
  const pinAvailable = speaker === "unverified" && Boolean(owner.phonePinHash) && !pinLocked(owner);
  // The greeting says it's an AI: the call's conversation doesn't need to say it again.
  const conversation = await ensureConversation(db, bot.id, "voice", `call:${call.id}`);
  await db.update(schema.conversations).set({ lastDisclosureAt: new Date() }).where(eq(schema.conversations.id, conversation.id));
  await db.update(schema.calls).set({ conversationId: conversation.id }).where(eq(schema.calls.id, call.id));
  return {
    callId: call.id,
    kind,
    bot: { id: bot.id, name: bot.name, persona: persona(bot, owner) },
    owner: { firstName: firstNameOf(owner), timezone: owner.timezone || "UTC" },
    speaker,
    greeting: greetingFor({ botName: bot.name, firstName: callFirstName(owner), speaker, firstCall: (earlier?.n ?? 0) === 0, pinAvailable, kind }),
    context: speaker === "owner" ? await ownerContext(db, bot, owner) : "",
    phrases: await phrasesFor(db, bot, owner),
    maxMinutes: MAX_CALL_MINUTES[kind],
    pinAvailable,
  };
}

export type CallActResult = { text: string; status: string; approvals: { title: string }[] };

/** A request from the call, done by the bot's own agent with every safeguard a chat has. */
export async function callAct(db: Db, call: Call, request: string): Promise<CallActResult> {
  if (call.speaker === "unverified") {
    return { text: "Nothing was done: the caller hasn't shown they're the owner (no PIN yet).", status: "refused", approvals: [] };
  }
  const loaded = await botAndOwner(db, call);
  if (!loaded) return { text: "This bot is gone.", status: "error", approvals: [] };
  const conversation = await ensureConversation(db, loaded.bot.id, "voice", `call:${call.id}`);
  const owner = call.speaker === "owner";
  const result = await runTurn({
    db,
    bot: loaded.bot,
    owner: loaded.owner,
    conversation,
    channelKind: "voice",
    message: {
      text: request,
      author: owner ? "owner" : "contact",
      from: call.fromAddress ?? (call.kind === "web" ? "the app" : undefined),
      contactLabel: owner ? undefined : `a caller on the phone (${call.fromAddress ?? "number withheld"})`,
      meta: { via: "call", callId: call.id },
    },
  });
  return { text: result.text, status: result.status, approvals: result.approvals.map((a) => ({ title: a.title })) };
}

/** The owner said their PIN: unlock the call. */
export async function callPin(db: Db, call: Call, pin: string): Promise<{ ok: true; firstName: string; context: string } | { ok: false; remaining: number; locked: boolean }> {
  if (call.speaker !== "unverified") return { ok: false, remaining: 0, locked: false };
  const check = await checkPhonePin(db, call.ownerId, pin);
  if (!check.ok) {
    // Five wrong PINs from the owner's number: someone may be faking it, so the owner hears about it.
    if (check.justLocked) {
      const loaded = await botAndOwner(db, call);
      if (loaded) {
        const from = call.fromAddress ?? "a hidden number";
        await messageOwner(
          db,
          loaded.bot,
          loaded.owner,
          `Someone said the wrong phone PIN ${PIN_MAX_FAILURES} times on a call to me from ${from}, so PINs are locked for 15 minutes. If that wasn't you, someone may be faking your number: change your phone PIN in Account.`,
        ).catch(() => {});
      }
    }
    return { ok: false, remaining: check.remaining, locked: check.locked };
  }
  await db.update(schema.calls).set({ speaker: "owner" }).where(eq(schema.calls.id, call.id));
  const loaded = await botAndOwner(db, call);
  if (!loaded) return { ok: false, remaining: 0, locked: false };
  return { ok: true, firstName: firstNameOf(loaded.owner), context: await ownerContext(db, loaded.bot, loaded.owner) };
}

function cleanTurn(t: unknown): CallTurn | null {
  const x = t as Partial<CallTurn> | null;
  if (!x || (x.role !== "caller" && x.role !== "bot") || typeof x.text !== "string") return null;
  return { role: x.role, text: truncate(x.text, 2000), at: Math.max(0, Math.round(Number(x.at) || 0)), ...(x.interrupted ? { interrupted: true } : {}) };
}

/** A line of the live transcript (the voice server's final report replaces it). */
export async function recordCallTurn(db: Db, callId: string, turn: unknown): Promise<boolean> {
  const t = cleanTurn(turn);
  if (!t) return false;
  const rows = await db
    .update(schema.calls)
    .set({ transcript: sql`${schema.calls.transcript} || ${JSON.stringify([t])}::jsonb` })
    .where(and(eq(schema.calls.id, callId), eq(schema.calls.status, "active"), sql`jsonb_array_length(${schema.calls.transcript}) < ${MAX_TURNS}`))
    .returning({ id: schema.calls.id });
  return rows.length > 0;
}

export type CallReportIn = {
  endedBy: string;
  durationS: number;
  turns: unknown[];
  latency?: { turns?: number; p50Ms?: number | null; p90Ms?: number | null };
  usage?: { inputTokens?: number; outputTokens?: number; model?: string };
  engine?: { version?: string };
};

function talkerModel(model: string | undefined) {
  return INCLUDED_MODELS.find((m) => m.id === model || resolveIncludedModelId(m) === model) ?? INCLUDED_MODELS.find((m) => m.default) ?? INCLUDED_MODELS[0];
}

/** The call is over: keep its transcript, charge what it cost (at cost), and show it in the chat. */
export async function endCall(db: Db, call: Call, report: CallReportIn): Promise<{ costMicros: number }> {
  const loaded = await botAndOwner(db, call);
  const durationS = Math.max(0, Math.min(6 * 3600, Math.round(Number(report.durationS) || 0)));
  const turns = (report.turns ?? []).map(cleanTurn).filter((t): t is CallTurn => t !== null).slice(0, MAX_TURNS);
  const inputTokens = Math.max(0, Math.round(Number(report.usage?.inputTokens) || 0));
  const outputTokens = Math.max(0, Math.round(Number(report.usage?.outputTokens) || 0));
  const model = talkerModel(report.usage?.model);
  // The talker's tokens, at the model's Token Factory price. (Phone minutes are charged when Twilio
  // reports the call's length; the bot's agent charges its own work as it goes.)
  const costMicros = tokensMicros(model, { inputTokens, outputTokens });
  const summary = {
    endedBy: truncate(String(report.endedBy ?? "caller"), 20),
    latency: {
      turns: Math.max(0, Math.round(Number(report.latency?.turns) || 0)),
      p50Ms: report.latency?.p50Ms == null ? null : Math.round(Number(report.latency.p50Ms)),
      p90Ms: report.latency?.p90Ms == null ? null : Math.round(Number(report.latency.p90Ms)),
    },
    usage: { inputTokens, outputTokens, model: model.id },
    engine: truncate(String(report.engine?.version ?? ""), 60),
  };
  const [ended] = await db
    .update(schema.calls)
    .set({ status: "ended", endedAt: new Date(), durationS, transcript: turns, report: summary, costMicros: sql`${schema.calls.costMicros} + ${costMicros}` })
    .where(and(eq(schema.calls.id, call.id), eq(schema.calls.status, "active")))
    .returning();
  if (!ended || !loaded) return { costMicros: 0 };
  const { bot, owner } = loaded;
  await recordUsage(db, owner.id, { tokensIn: inputTokens, tokensOut: outputTokens, costMicros, voiceSeconds: call.kind === "web" ? durationS : 0 });
  const minutes = durationS < 60 ? `${durationS} s` : `${Math.round(durationS / 60)} min`;
  await receipt(
    db,
    bot,
    "call",
    "ok",
    `${call.kind === "phone" ? "Phone call" : "Call in the app"} (${minutes})`,
    { callId: call.id, durationS, turns: turns.length, latencyP50Ms: summary.latency.p50Ms, model: model.id, engine: summary.engine, speaker: ended.speaker },
    costMicros,
  );
  // The owner's calls show in the bot's chat, with the transcript.
  if (ended.speaker === "owner" && turns.length > 1) {
    const web = await ensureConversation(db, bot.id, "web", "owner");
    await db.insert(schema.messages).values({
      id: sortableId("msg"),
      conversationId: web.id,
      botId: bot.id,
      role: "assistant",
      author: "bot",
      text: `${call.kind === "phone" ? "Phone call" : "Call"} with ${bot.name}, ${minutes}.`,
      channelKind: "voice",
      meta: { kind: "call", callId: call.id, callKind: call.kind, durationS, turns, latencyP50Ms: summary.latency.p50Ms },
    });
  }
  return { costMicros };
}

export async function listCalls(db: Db, botId: string, limit = 20) {
  return db
    .select({
      id: schema.calls.id,
      kind: schema.calls.kind,
      status: schema.calls.status,
      speaker: schema.calls.speaker,
      durationS: schema.calls.durationS,
      startedAt: schema.calls.startedAt,
      createdAt: schema.calls.createdAt,
      costMicros: schema.calls.costMicros,
    })
    .from(schema.calls)
    .where(eq(schema.calls.botId, botId))
    .orderBy(desc(schema.calls.createdAt))
    .limit(limit);
}
