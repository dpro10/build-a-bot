/**
 * Stripe billing (stripe@23, API 2026-09-30.endive). No payment_method_types
 * (removed in endive): Checkout picks methods dynamically.
 */
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { appUrl, config } from "@/lib/env";
import type { PlanId } from "./plans";

let client: Stripe | null = null;
export function stripe(): Stripe {
  if (!config.stripe.secretKey) throw new Error("Stripe isn't configured");
  client ??= new Stripe(config.stripe.secretKey);
  return client;
}

export function priceFor(plan: Exclude<PlanId, "free">, interval: "monthly" | "yearly"): string | undefined {
  return config.stripe.prices[`${plan}_${interval}` as keyof typeof config.stripe.prices];
}

export function planForPrice(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  for (const [key, value] of Object.entries(config.stripe.prices)) {
    if (value === priceId) return key.split("_")[0] as PlanId;
  }
  return null;
}

async function ensureCustomer(db: Db, user: User): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe().customers.create({ email: user.email ?? undefined, name: user.name ?? undefined, metadata: { userId: user.id } });
  await db.update(schema.users).set({ stripeCustomerId: customer.id }).where(eq(schema.users.id, user.id));
  return customer.id;
}

export async function createCheckout(db: Db, user: User, plan: Exclude<PlanId, "free">, interval: "monthly" | "yearly") {
  const price = priceFor(plan, interval);
  if (!price) throw new Error(`No Stripe price configured for ${plan} ${interval}`);
  const customer = await ensureCustomer(db, user);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price, quantity: 1 }],
    success_url: `${appUrl()}/app/billing?success=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl()}/app/billing?canceled=1`,
    client_reference_id: user.id,
    allow_promotion_codes: true,
    subscription_data: { metadata: { userId: user.id, plan } },
  });
  return session.url;
}

export async function createPortal(db: Db, user: User) {
  const customer = await ensureCustomer(db, user);
  const portal = await stripe().billingPortal.sessions.create({ customer, return_url: `${appUrl()}/app/billing` });
  return portal.url;
}

export async function applySubscription(db: Db, sub: Stripe.Subscription) {
  const userId = (sub.metadata?.userId as string | undefined) ?? null;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const where = userId ? eq(schema.users.id, userId) : eq(schema.users.stripeCustomerId, customerId);
  const priceId = sub.items.data[0]?.price?.id;
  const active = ["active", "trialing", "past_due"].includes(sub.status);
  const plan = active ? (planForPrice(priceId) ?? "plus") : "free";
  const periodEnd = (sub.items.data[0] as unknown as { current_period_end?: number })?.current_period_end;
  await db
    .update(schema.users)
    .set({
      plan,
      planStatus: sub.status === "canceled" ? "canceled" : sub.status,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      planRenewsAt: periodEnd ? new Date(periodEnd * 1000) : null,
      updatedAt: new Date(),
    })
    .where(where);
}
