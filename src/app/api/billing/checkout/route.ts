import { z } from "zod";
import { apiError, authed, json, parseJson, sameOrigin } from "@/lib/api";
import { live } from "@/lib/env";
import { createCheckout } from "@/lib/billing/stripe";
import { isAnonymous } from "@/lib/auth/session";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const a = await authed();
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ plan: z.enum(["plus", "pro"]), interval: z.enum(["monthly", "yearly"]).default("monthly") }));
  if (!parsed.ok) return parsed.res;
  if (!live.stripe) return apiError(503, "Paid plans are coming soon.", { demo: true });
  if (isAnonymous(a.user)) return apiError(409, "Save your account with your email first.", { needsEmail: true });
  try {
    const url = await createCheckout(a.db, a.user, parsed.data.plan, parsed.data.interval);
    return json({ url });
  } catch (err) {
    return apiError(502, (err as Error).message);
  }
}
