import { apiError, authed, json, sameOrigin } from "@/lib/api";
import { live } from "@/lib/env";
import { createPortal } from "@/lib/billing/stripe";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const a = await authed();
  if (!a.ok) return a.res;
  if (!live.stripe) return apiError(503, "Payments aren't set up on this server.");
  try {
    return json({ url: await createPortal(a.db, a.user) });
  } catch (err) {
    return apiError(502, (err as Error).message);
  }
}
