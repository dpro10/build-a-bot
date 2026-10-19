/**
 * Routing and helpers for Twilio webhooks (SMS + voice).
 */
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Channel } from "@/lib/db/schema";
import { appUrl, config, live } from "@/lib/env";
import { validateTwilioSignature, escapeXml, speakable } from "./twilio";

export async function readTwilioForm(req: Request): Promise<{ params: Record<string, string>; valid: boolean }> {
  const text = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text)) params[k] = v;
  const url = new URL(req.url);
  const publicUrl = `${appUrl()}${url.pathname}${url.search}`;
  const valid = live.twilio ? validateTwilioSignature(publicUrl, params, req.headers.get("x-twilio-signature")) : process.env.NODE_ENV !== "production";
  return { params, valid };
}

/** Our shared number (TWILIO_PHONE_NUMBER), however it's written. */
export function isSharedNumber(number: string | undefined): boolean {
  const digits = (n: string | undefined) => (n ?? "").replace(/\D/g, "");
  return digits(number) !== "" && digits(number) === digits(config.twilio.phoneNumber);
}

/**
 * Which bot is this for? Bots share one number, and every bot's phone channels carry it (it's the
 * number they call and text from), so on the shared number the number dialed says nothing: the
 * phone calling or texting does. It reaches a bot whose owner linked that phone: the one they used
 * last, if they have several ("@Name ..." picks one in a text). Any other number is a bot's own
 * when exactly one bot has it. Only channels that are on answer.
 */
export async function routeTwilio(db: Db, kind: "sms" | "voice", to: string, from: string, text?: string): Promise<{ channel: Channel; text?: string } | null> {
  if (to && !isSharedNumber(to)) {
    const own = await db
      .select()
      .from(schema.channels)
      .where(and(eq(schema.channels.kind, kind), eq(schema.channels.address, to), eq(schema.channels.status, "active")))
      .limit(2);
    if (own.length === 1) return { channel: own[0], text };
  }
  if (!from) return null;

  const candidates = await db
    .select({ channel: schema.channels, botName: schema.bots.name })
    .from(schema.channels)
    .innerJoin(schema.bots, eq(schema.bots.id, schema.channels.botId))
    .where(and(eq(schema.channels.kind, kind), eq(schema.channels.ownerAddress, from), eq(schema.channels.status, "active")))
    // A bot that hasn't done anything yet goes last (descending, Postgres puts nulls first).
    .orderBy(sql`${schema.bots.lastActiveAt} desc nulls last`, desc(schema.channels.ownerVerifiedAt));
  if (!candidates.length) return null;
  if (text) {
    const at = /^@(\S+)\s+([\s\S]*)$/.exec(text.trim());
    if (at) {
      const hit = candidates.find((c) => c.botName.toLowerCase() === at[1].toLowerCase());
      if (hit) return { channel: hit.channel, text: at[2] };
    }
  }
  return { channel: candidates[0].channel, text };
}

/**
 * What a caller hears when no bot answers them, before the call ends. On the shared number: their
 * phone isn't linked to a bot (and how to link it), or it is, but calls are off. On any other
 * number: it isn't taking calls.
 */
export async function unansweredCall(db: Db, to: string, from: string): Promise<string> {
  if (!isSharedNumber(to)) return "Sorry, this number can't take your call.";
  const [linked] = from
    ? await db
        .select({ id: schema.channels.id })
        .from(schema.channels)
        .where(and(inArray(schema.channels.kind, ["sms", "voice"]), eq(schema.channels.ownerAddress, from), isNotNull(schema.channels.ownerVerifiedAt)))
        .limit(1)
    : [];
  return linked
    ? "Calls are turned off for your bot. Turn them on in the app, then call back."
    : "This number answers for the bots people build in the app. Link this phone in the app, then call back.";
}

export function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

export function say(text: string): string {
  return `<Say voice="${escapeXml(config.twilio.voice)}">${escapeXml(text)}</Say>`;
}

/**
 * Who's on a call handled by Twilio's own speech (the simpler line): the owner, or anyone else.
 * It rides in the URLs Twilio calls back, which Twilio signs, so it can't be changed by a caller.
 */
export type LineTier = "owner" | "contact";

export function tierParam(url: URL): LineTier {
  return url.searchParams.get("t") === "contact" ? "contact" : "owner";
}

export function gather(channelId: string, prompt?: string, attempt = 0, tier: LineTier = "owner"): string {
  const action = `${appUrl()}/api/webhooks/twilio/voice/turn?c=${encodeURIComponent(channelId)}&a=${attempt}&t=${tier}`;
  // Twilio's default speech model: the legacy "phone_call" + enhanced one costs twice as much.
  return `<Gather input="speech" action="${escapeXml(action)}" method="POST" speechTimeout="auto" language="en-US" actionOnEmptyResult="true">${prompt ? say(prompt) : ""}</Gather>`;
}

export function answerTwiml(channelId: string, result: { text?: string; approvals?: number; error?: string } | null, tier: LineTier = "owner"): string {
  if (!result || result.error || !result.text) return `${say("Sorry, I hit a snag. Try asking again?")}${gather(channelId, undefined, 0, tier)}`;
  const extra = result.approvals ? " I've put the details in your app for your OK." : "";
  return `${gather(channelId, `${speakable(result.text)}${extra}`, 0, tier)}${say("Talk soon!")}<Hangup/>`;
}
