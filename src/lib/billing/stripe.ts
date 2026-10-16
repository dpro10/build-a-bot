/**
 * Stripe, for adding credit (stripe@23, API 2026-09-30.endive). One-time payments through
 * Checkout: no products, prices or subscriptions to set up. The card pays the credit plus Stripe's
 * fee (prices.ts), so the credit is all the owner's. No payment_method_types (removed in endive):
 * Checkout picks methods dynamically.
 */
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { appUrl, config } from "@/lib/env";
import { addCredit } from "./credit";
import { TOP_UPS_USD, topUpChargeCents, type TopUpUsd } from "./prices";

let client: Stripe | null = null;
export function stripe(): Stripe {
  if (!config.stripe.secretKey) throw new Error("Stripe isn't configured");
  client ??= new Stripe(config.stripe.secretKey);
  return client;
}

async function ensureCustomer(db: Db, user: User): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe().customers.create({ email: user.email ?? undefined, name: user.name ?? undefined, metadata: { userId: user.id } });
  await db.update(schema.users).set({ stripeCustomerId: customer.id }).where(eq(schema.users.id, user.id));
  return customer.id;
}

export function isTopUp(usd: number): usd is TopUpUsd {
  return (TOP_UPS_USD as readonly number[]).includes(usd);
}

/** A Checkout page for `usd` of credit; the webhook adds it once Stripe says it's paid. */
export async function createTopUp(db: Db, user: User, usd: TopUpUsd): Promise<string | null> {
  const customer = await ensureCustomer(db, user);
  const charge = topUpChargeCents(usd);
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer,
    client_reference_id: user.id,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: charge,
          product_data: {
            name: `$${usd} of Build-a-bot credit`,
            description: `Pays for what your bots use, at cost. $${((charge - usd * 100) / 100).toFixed(2)} of it is the card fee.`,
          },
        },
      },
    ],
    metadata: { userId: user.id, creditCents: String(usd * 100) },
    payment_intent_data: { metadata: { userId: user.id, creditCents: String(usd * 100) } },
    success_url: `${appUrl()}/app/billing?checkout=success`,
    cancel_url: `${appUrl()}/app/billing?checkout=cancel`,
  });
  return session.url;
}

/**
 * A Checkout session Stripe says is paid (checkout.session.completed, or async_payment_succeeded
 * for slower methods) becomes credit, once. Sessions that aren't ours or aren't paid are skipped.
 */
export async function creditPaidSession(db: Db, session: Stripe.Checkout.Session): Promise<"added" | "duplicate" | "skipped"> {
  if (session.mode !== "payment" || session.payment_status !== "paid") return "skipped";
  const userId = session.metadata?.userId ?? session.client_reference_id ?? null;
  const creditCents = Number(session.metadata?.creditCents);
  if (!userId || !Number.isInteger(creditCents) || creditCents <= 0) return "skipped";
  const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) {
    // Paid, but the account was deleted before Stripe confirmed it: nobody to credit, so refund it.
    console.warn(`[billing] paid Checkout session ${session.id} is for an account that no longer exists; refund it in Stripe`);
    return "skipped";
  }
  const added = await addCredit(db, {
    userId,
    kind: "topup",
    amountMicros: creditCents * 10_000,
    paidCents: session.amount_total ?? null,
    stripeSessionId: session.id,
  });
  return added ? "added" : "duplicate";
}
