import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import { config } from "@/lib/env";
import { creditPaidSession, stripe } from "@/lib/billing/stripe";

/**
 * Stripe's webhook: a paid Checkout session becomes credit, once (the credit row is keyed by the
 * session, so a retried or repeated event adds nothing). Card payments are paid when the session
 * completes; slower methods (bank debits) arrive as async_payment_succeeded. A failure answers 500,
 * so Stripe tries again.
 */
export async function POST(req: Request) {
  if (!config.stripe.secretKey || !config.stripe.webhookSecret) return new Response("not configured", { status: 503 });
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(body, req.headers.get("stripe-signature") ?? "", config.stripe.webhookSecret);
  } catch {
    return new Response("bad signature", { status: 400 });
  }
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      try {
        const result = await creditPaidSession(await getDb(), event.data.object as Stripe.Checkout.Session);
        if (result === "added") console.log(`[billing] credit added (${event.type})`);
      } catch (err) {
        console.error("[billing] couldn't add credit", (err as Error).message);
        return new Response("try again", { status: 500 });
      }
      break;
    }
  }
  return new Response("ok");
}
