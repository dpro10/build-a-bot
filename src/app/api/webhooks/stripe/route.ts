import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { config } from "@/lib/env";
import { applySubscription, stripe } from "@/lib/billing/stripe";
import { seenBefore } from "@/lib/channels/inbound";

export async function POST(req: Request) {
  if (!config.stripe.secretKey || !config.stripe.webhookSecret) return new Response("not configured", { status: 503 });
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(body, req.headers.get("stripe-signature") ?? "", config.stripe.webhookSecret);
  } catch {
    return new Response("bad signature", { status: 400 });
  }
  const db = await getDb();
  if (await seenBefore(db, "stripe", event.id)) return new Response("ok");

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.subscription) {
        const sub = await stripe().subscriptions.retrieve(typeof session.subscription === "string" ? session.subscription : session.subscription.id);
        await applySubscription(db, sub);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applySubscription(db, event.data.object as Stripe.Subscription);
      break;
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customer = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      if (customer) await db.update(schema.users).set({ planStatus: "past_due" }).where(eq(schema.users.stripeCustomerId, customer));
      break;
    }
  }
  return new Response("ok");
}
