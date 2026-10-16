import { z } from "zod";
import { apiError, authed, json, parseJson, sameOrigin } from "@/lib/api";
import { live } from "@/lib/env";
import { createTopUp, isTopUp } from "@/lib/billing/stripe";
import { isAnonymous } from "@/lib/auth/session";

/** Add credit: a Stripe Checkout page for $5, $10 or $20 of credit (the card fee is added on top). */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const a = await authed();
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ usd: z.number().int() }));
  if (!parsed.ok) return parsed.res;
  const usd = parsed.data.usd;
  if (!isTopUp(usd)) return apiError(422, "Add $5, $10 or $20 of credit.");
  if (!live.stripe) return apiError(503, "Adding credit is coming soon.", { demo: true });
  if (isAnonymous(a.user)) return apiError(409, "Save your account with your email first.", { needsEmail: true });
  try {
    const url = await createTopUp(a.db, a.user, usd);
    if (!url) return apiError(502, "Stripe didn't open a payment page. Try again.");
    return json({ url });
  } catch (err) {
    console.error("[billing] checkout failed", (err as Error).message);
    return apiError(502, "Couldn't reach Stripe. Try again in a moment.");
  }
}
