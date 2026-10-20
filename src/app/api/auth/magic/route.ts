import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { apiError, clientIp, json, parseJson, sameOrigin } from "@/lib/api";
import { getUser } from "@/lib/auth/session";
import { SIGNIN_COOKIE, SIGNIN_COOKIE_MAX_AGE, createLoginLink } from "@/lib/auth/magic";
import { sendLoginEmail } from "@/lib/channels/email";
import { demoMode, isProduction, live } from "@/lib/env";
import { rateLimit } from "@/lib/safety/ratelimit";
import { adminEmails } from "@/lib/admin/metrics";
import { randomToken, timingSafeEqualStr } from "@/lib/crypto";

/** Sign-in links one network can ask for in an hour, whatever the addresses (each one is an email we send). */
const LINKS_PER_IP_PER_HOUR = 30;

export async function POST(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const parsed = await parseJson(
    req,
    z.object({ email: z.string().trim().toLowerCase().email().max(200), next: z.string().max(300).optional(), adminCode: z.string().max(200).optional() }),
  );
  if (!parsed.ok) return parsed.res;
  const db = await getDb();
  const ip = clientIp(req);
  if (ip && !(await rateLimit(db, `magic-ip:${ip}`, LINKS_PER_IP_PER_HOUR, 60 * 60)).ok) {
    return apiError(429, "Too many sign-in links from here. Try again in a while.");
  }
  const limited = await rateLimit(db, `magic:${parsed.data.email}`, 5, 15 * 60);
  if (!limited.ok) return apiError(429, "Too many sign-in links. Try again in a few minutes.");
  // A demo server without email shows the link on screen, so anyone could ask for anyone's. The operator's
  // own emails (ADMIN_EMAILS) also need the admin code there (ADMIN_SIGNIN_CODE, set on the
  // server), so nobody else can open /admin. Guesses share the rate limit above.
  if (demoMode && !live.email && adminEmails().includes(parsed.data.email)) {
    const code = process.env.ADMIN_SIGNIN_CODE?.trim();
    if (!code) return apiError(403, "This email is an admin account. Set ADMIN_SIGNIN_CODE on the server to sign in with it here.");
    if (!parsed.data.adminCode) return apiError(403, "This email is an admin account. Enter the admin code to sign in.", { needsAdminCode: true });
    if (!timingSafeEqualStr(parsed.data.adminCode.trim(), code)) return apiError(403, "That admin code isn't right.", { needsAdminCode: true });
  }
  const current = await getUser();
  // This browser marks itself (the same mark for every link it asks for), so only here can a link
  // bring the anonymous account along (lib/auth/magic.ts).
  const jar = await cookies();
  const mark = jar.get(SIGNIN_COOKIE)?.value;
  const browser = mark && /^[\w-]{32,128}$/.test(mark) ? mark : randomToken(32);
  jar.set(SIGNIN_COOKIE, browser, { httpOnly: true, secure: isProduction, sameSite: "lax", path: "/", maxAge: SIGNIN_COOKIE_MAX_AGE });
  const link = await createLoginLink(db, { email: parsed.data.email, anonymousUserId: current && !current.email ? current.id : null, next: parsed.data.next, browser });
  const sent = await sendLoginEmail(parsed.data.email, link);
  // Once email is set up, the link only ever goes to the inbox, demo mode or not. Showing it here
  // when a send fails would hand anyone's account to whoever asked, and a send can be made to fail
  // (using up the provider's daily quota is enough).
  if (!sent.ok && (!demoMode || sent.reason !== "not_configured")) {
    // Not about the address they typed: say which problem it is (sendLoginEmail logged the details).
    return sent.reason === "not_configured"
      ? apiError(503, "Sign-in by email isn't set up on this server yet.", { code: "email_not_configured" })
      : apiError(502, "We couldn't send the email just now. Try again in a minute.", { code: "email_send_failed" });
  }
  // Demo mode with no email provider: hand the link back so the flow can be tried end to end.
  return json({ sent: sent.ok, demoLink: sent.ok ? null : link });
}
