/**
 * Trust between the app and the voice server, on one shared secret (VOICE_SERVER_SECRET):
 *   call tokens  minted here, one per call (in a Twilio webhook's TwiML, or for the browser's Call
 *                button); the voice server checks them. They name the call and expire in minutes.
 *   signatures   the voice server signs every request to /api/calls/*:
 *                x-voice-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">.
 * The same code lives in the voice server (voice/src/auth.ts): keep the two in step.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type CallToken = {
  kind: "web" | "phone";
  callId: string;
  botId: string;
  /** Twilio's CallSid: the stream that presents the token must be for this call. */
  callSid?: string;
  /** Expiry, Unix seconds. */
  exp: number;
};

function mac(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

export function signCallToken(secret: string, token: CallToken): string {
  const body = `v1.${Buffer.from(JSON.stringify(token)).toString("base64url")}`;
  return `${body}.${mac(secret, body).toString("base64url")}`;
}

export function signBody(secret: string, body: string, nowSec = Math.floor(Date.now() / 1000)): string {
  return `t=${nowSec},v1=${mac(secret, `${nowSec}.${body}`).toString("hex")}`;
}

/** A request really from the voice server, sent in the last five minutes. */
export function verifyBodySignature(secret: string, body: string, header: string | null | undefined, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  if (!secret || !header) return false;
  const fields = Object.fromEntries(header.split(",").map((kv) => kv.trim().split("=", 2) as [string, string]));
  const t = Number(fields.t);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > toleranceSec || !fields.v1) return false;
  const expected = mac(secret, `${t}.${body}`);
  const given = Buffer.from(fields.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
