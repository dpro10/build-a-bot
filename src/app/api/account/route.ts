import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authed, json, parseJson, sameOrigin } from "@/lib/api";
import { destroySession } from "@/lib/auth/session";
import { isValidTimeZone } from "@/lib/scheduler/time";
import { live } from "@/lib/env";
import { stripe } from "@/lib/billing/stripe";

export async function PATCH(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const a = await authed();
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ name: z.string().trim().max(60).optional(), timezone: z.string().max(80).optional() }));
  if (!parsed.ok) return parsed.res;
  if (parsed.data.timezone && !isValidTimeZone(parsed.data.timezone)) return apiError(422, "Unknown timezone");
  const [user] = await a.db.update(schema.users).set({ ...parsed.data, updatedAt: new Date() }).where(eq(schema.users.id, a.user.id)).returning();
  return json({ user: { id: user.id, name: user.name, timezone: user.timezone, email: user.email } });
}

/** Delete the account and everything in it (bots, receipts, keys). */
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const a = await authed();
  if (!a.ok) return a.res;
  if (live.stripe && a.user.stripeSubscriptionId) {
    await stripe().subscriptions.cancel(a.user.stripeSubscriptionId).catch(() => {});
  }
  await a.db.transaction(async (tx) => {
    await tx.execute(sql`set local app.allow_receipt_delete = 'on'`);
    await tx.delete(schema.users).where(eq(schema.users.id, a.user.id));
  });
  await destroySession();
  return json({ ok: true });
}
