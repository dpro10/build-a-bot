import { z } from "zod";
import { getDb } from "@/lib/db";
import { apiError, json, parseJson, sameOrigin } from "@/lib/api";
import { getUser } from "@/lib/auth/session";
import { createLoginLink } from "@/lib/auth/magic";
import { sendLoginEmail } from "@/lib/channels/email";
import { demoMode } from "@/lib/env";
import { rateLimit } from "@/lib/safety/ratelimit";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const parsed = await parseJson(req, z.object({ email: z.string().trim().toLowerCase().email().max(200), next: z.string().max(300).optional() }));
  if (!parsed.ok) return parsed.res;
  const db = await getDb();
  const limited = await rateLimit(db, `magic:${parsed.data.email}`, 5, 15 * 60);
  if (!limited.ok) return apiError(429, "Too many sign-in links. Try again in a few minutes.");
  const current = await getUser();
  const link = await createLoginLink(db, { email: parsed.data.email, anonymousUserId: current && !current.email ? current.id : null, next: parsed.data.next });
  const sent = await sendLoginEmail(parsed.data.email, link);
  if (!sent && !demoMode) return apiError(503, "Email isn't set up on this server yet.");
  // Demo mode (no email provider): hand the link back so the flow can be tried end to end.
  return json({ sent, demoLink: sent ? null : link });
}
