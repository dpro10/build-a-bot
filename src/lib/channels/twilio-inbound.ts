/**
 * Routing and helpers for Twilio webhooks (SMS + voice).
 */
import { and, desc, eq } from "drizzle-orm";
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

/**
 * Which bot is this for? A bot's own number (To), if it has one, wins; on the shared number we
 * match the caller to the bot whose owner verified that phone. "@Name ..." picks a bot.
 */
export async function routeTwilio(db: Db, kind: "sms" | "voice", to: string, from: string, text?: string): Promise<{ channel: Channel; text?: string } | null> {
  const [dedicated] = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.kind, kind), eq(schema.channels.address, to)))
    .limit(1);
  if (dedicated) return { channel: dedicated, text };

  const candidates = await db
    .select({ channel: schema.channels, botName: schema.bots.name, lastActive: schema.bots.lastActiveAt })
    .from(schema.channels)
    .innerJoin(schema.bots, eq(schema.bots.id, schema.channels.botId))
    .where(and(eq(schema.channels.kind, kind), eq(schema.channels.ownerAddress, from), eq(schema.channels.status, "active")))
    .orderBy(desc(schema.bots.lastActiveAt));
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

export function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

export function say(text: string): string {
  return `<Say voice="${escapeXml(config.twilio.voice)}">${escapeXml(text)}</Say>`;
}

export function gather(channelId: string, prompt?: string, attempt = 0): string {
  const action = `${appUrl()}/api/webhooks/twilio/voice/turn?c=${encodeURIComponent(channelId)}&a=${attempt}`;
  return `<Gather input="speech" action="${escapeXml(action)}" method="POST" speechTimeout="auto" speechModel="phone_call" enhanced="true" language="en-US" actionOnEmptyResult="true">${prompt ? say(prompt) : ""}</Gather>`;
}

export function answerTwiml(channelId: string, result: { text?: string; approvals?: number; error?: string } | null): string {
  if (!result || result.error || !result.text) return `${say("Sorry, I hit a snag. Try asking again?")}${gather(channelId)}`;
  const extra = result.approvals ? " I've put the details in your app for your OK." : "";
  return `${gather(channelId, `${speakable(result.text)}${extra}`)}${say("Talk soon!")}<Hangup/>`;
}
