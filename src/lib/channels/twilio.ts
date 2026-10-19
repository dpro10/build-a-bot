/**
 * Twilio: SMS and phone calls. One shared number to start (env TWILIO_PHONE_NUMBER), routed by the
 * phone that calls or texts it (twilio-inbound.ts); a bot with a number of its own is routed by it.
 * Calls use <Gather input="speech"> turns, so the whole voice loop runs on ordinary serverless
 * webhooks (no WebSocket server needed).
 */
import crypto from "node:crypto";
import type { Channel } from "@/lib/db/schema";
import { appUrl, config, live } from "@/lib/env";
import type { ChannelAdapter } from "./outbound";

function auth() {
  return "Basic " + Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString("base64");
}

async function twilioPost(path: string, form: Record<string, string>) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/${path}`, {
    method: "POST",
    headers: { authorization: auth(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${data.message ?? "error"}`);
  return data;
}

export function botPhoneNumber(channel: Channel | null): string | undefined {
  return (channel?.address as string | undefined) || config.twilio.phoneNumber;
}

export async function sendSms(from: string, to: string, body: string) {
  // Twilio concatenates long messages (up to 1600 chars); keep it inside that.
  return twilioPost("Messages.json", { From: from, To: to, Body: body.slice(0, 1550) });
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Make text speakable: no markdown, no URLs read out character by character. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " (I've sent the details by text.) ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/[*_#>`]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
}

/** `statusCallback`: where Twilio reports the call when it's over (which is how it's charged). */
export async function placeCall(from: string, to: string, twiml: string, statusCallback?: string) {
  return twilioPost("Calls.json", { From: from, To: to, Twiml: twiml, ...(statusCallback ? { StatusCallback: statusCallback } : {}) });
}

/** The call that reads an owner their phone code: one digit at a time, three times. */
export function codeCallTwiml(botName: string, code: string): string {
  const say = (text: string) => `<Say voice="${escapeXml(config.twilio.voice)}">${escapeXml(text)}</Say>`;
  const digits = code.split("").join(", ");
  return `<Response><Pause length="1"/>${say(`Hi, it's ${botName}, an AI assistant. Your code is: ${digits}.`)}<Pause length="1"/>${say(`Again: ${digits}.`)}<Pause length="1"/>${say(`Once more: ${digits}. Bye!`)}</Response>`;
}

export const smsAdapter: ChannelAdapter = {
  isLive() {
    return live.twilioTexting;
  },
  async send({ channel }, msg) {
    const from = botPhoneNumber(channel);
    if (!from) return { status: "failed", error: "No phone number configured" };
    const res = await sendSms(from, msg.to, msg.text);
    return { status: "sent", providerId: res.sid };
  },
};

export const voiceAdapter: ChannelAdapter = {
  isLive() {
    return live.twilio;
  },
  async send({ channel, bot }, msg) {
    const from = botPhoneNumber(channel);
    if (!from) return { status: "failed", error: "No phone number configured" };
    const voice = config.twilio.voice;
    const twiml = `<Response><Say voice="${escapeXml(voice)}">Hi, it's ${escapeXml(bot.name)}, your AI assistant. ${escapeXml(
      speakable(msg.text),
    )}</Say><Pause length="1"/><Say voice="${escapeXml(voice)}">That's all for now. Bye!</Say></Response>`;
    // When the call is over, Twilio reports it with the bot in the URL (signed): its owner pays for it.
    const res = await placeCall(from, msg.to, twiml, `${appUrl()}/api/webhooks/twilio/voice/status?b=${encodeURIComponent(bot.id)}`);
    return { status: "sent", providerId: res.sid };
  },
};

/**
 * X-Twilio-Signature: base64(HMAC-SHA1(authToken, fullUrl + concat(sorted(key+value)))).
 */
export function validateTwilioSignature(url: string, params: Record<string, string>, signature: string | null): boolean {
  if (!config.twilio.authToken || !signature) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const expected = crypto.createHmac("sha1", config.twilio.authToken).update(Buffer.from(data, "utf-8")).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
