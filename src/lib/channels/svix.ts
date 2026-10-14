/**
 * Svix-style webhook signatures (Resend, AgentMail): HMAC-SHA256 over
 * `${id}.${timestamp}.${body}` with the base64 secret after "whsec_".
 */
import crypto from "node:crypto";

export function verifySvix(secret: string | undefined, headers: Headers, body: string, toleranceSeconds = 300): boolean {
  if (!secret) return false;
  const id = headers.get("svix-id") ?? headers.get("webhook-id");
  const timestamp = headers.get("svix-timestamp") ?? headers.get("webhook-timestamp");
  const signatures = headers.get("svix-signature") ?? headers.get("webhook-signature");
  if (!id || !timestamp || !signatures) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return signatures.split(" ").some((part) => {
    const [, sig] = part.split(",");
    if (!sig) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}
