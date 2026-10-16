/**
 * Trust between the app and this server, on one shared secret (VOICE_SERVER_SECRET):
 *   call tokens  app → caller → here. The app mints one per call (in the Twilio webhook's TwiML, or
 *                for the browser); it names the call and expires in minutes. Never in a URL.
 *   signatures   here → app. Every request to the app's /api/calls/* carries
 *                x-voice-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">.
 * The same code lives in the app (src/lib/calls/tokens.ts): keep the two in step.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type CallToken = {
  /** "web" (the app's Call button) or "phone" (a Twilio call). */
  kind: "web" | "phone";
  callId: string;
  botId: string;
  /** Twilio's CallSid, which the stream's start message must match. */
  callSid?: string;
  /** Expiry, Unix seconds. */
  exp: number;
};

const b64url = (buf: Buffer) => buf.toString("base64url");

function mac(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

export function signCallToken(secret: string, token: CallToken): string {
  const body = `v1.${b64url(Buffer.from(JSON.stringify(token)))}`;
  return `${body}.${b64url(mac(secret, body))}`;
}

export function verifyCallToken(secret: string, token: string, nowSec = Date.now() / 1000): CallToken | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const expected = mac(secret, `${parts[0]}.${parts[1]}`);
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload: CallToken;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as CallToken;
  } catch {
    return null;
  }
  if (!payload || (payload.kind !== "web" && payload.kind !== "phone") || typeof payload.callId !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp < nowSec) return null;
  return payload;
}

export function signBody(secret: string, body: string, nowSec = Math.floor(Date.now() / 1000)): string {
  return `t=${nowSec},v1=${mac(secret, `${nowSec}.${body}`).toString("hex")}`;
}

export function verifyBodySignature(secret: string, body: string, header: string | null | undefined, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  if (!header) return false;
  const fields = Object.fromEntries(header.split(",").map((kv) => kv.trim().split("=", 2) as [string, string]));
  const t = Number(fields.t);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > toleranceSec || !fields.v1) return false;
  const expected = mac(secret, `${t}.${body}`);
  const given = Buffer.from(fields.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
