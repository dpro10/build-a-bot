/**
 * Adding credit with Stripe, offline:
 *
 * - Checkout is a one-time payment for $5, $10 or $20 of credit; the card is charged the credit
 *   plus Stripe's fee, and an account needs an email first.
 * - The webhook is signed (a wrong signature is refused), credits a paid session once however
 *   often it arrives, waits for slower payment methods, and skips sessions that aren't ours.
 * Stripe's own webhook signing is used for real; only its network calls are faked.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "0";
delete process.env.DATABASE_URL;
process.env.STRIPE_SECRET_KEY = "sk_test_credit";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_credit_secret";
process.env.APP_URL = "https://build-a-bot.example";

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => session.user,
}));

// Stripe's API, faked; its webhook signing stays real.
const stripeCalls = vi.hoisted(() => ({ customers: [] as unknown[], sessions: [] as Record<string, unknown>[] }));
vi.mock("stripe", async (importOriginal) => {
  const Real = (await importOriginal<{ default: new (key: string) => object }>()).default;
  class FakeStripe extends (Real as new (key: string) => object) {
    customers = {
      create: async (params: unknown) => {
        stripeCalls.customers.push(params);
        return { id: `cus_test_${stripeCalls.customers.length}` };
      },
    };
    checkout = {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          stripeCalls.sessions.push(params);
          return { id: `cs_test_${stripeCalls.sessions.length}`, url: `https://checkout.stripe.com/c/pay/cs_test_${stripeCalls.sessions.length}` };
        },
      },
    };
  }
  return { default: FakeStripe };
});

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { getCredit } = await import("@/lib/billing/credit");
const { stripe } = await import("@/lib/billing/stripe");
const { live, creditOpen } = await import("@/lib/env");
const checkoutRoute = await import("@/app/api/billing/checkout/route");
const webhookRoute = await import("@/app/api/webhooks/stripe/route");
import type { User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;

const post = (body: unknown) => new Request("http://localhost/api/billing/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function webhook(event: Record<string, unknown>, opts: { secret?: string } = {}) {
  const payload = JSON.stringify(event);
  const header = await stripe().webhooks.generateTestHeaderStringAsync({ payload, secret: opts.secret ?? "whsec_test_credit_secret" });
  return webhookRoute.POST(new Request("http://localhost/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": header }, body: payload }));
}

function paidSession(id: string, over: Record<string, unknown> = {}) {
  return {
    id: `evt_${id}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id,
        object: "checkout.session",
        mode: "payment",
        payment_status: "paid",
        amount_total: 1061,
        client_reference_id: owner.id,
        metadata: { userId: owner.id, creditCents: "1000" },
        ...over,
      },
    },
  };
}

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner] = await db.insert(schema.users).values({ id: "usr_buyer", email: "buyer@example.com", name: "Bea", emailVerifiedAt: new Date(), timezone: "UTC" }).returning();
  session.user = owner;
});

afterAll(async () => {
  await resetDbForTests();
});

describe("adding credit", () => {
  it("is open once Stripe is set up", () => {
    expect(live.stripe).toBe(true);
    expect(creditOpen).toBe(true);
  });

  it("opens a one-time Checkout for the credit, with Stripe's fee on top", async () => {
    const res = await checkoutRoute.POST(post({ usd: 10 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    expect(stripeCalls.customers).toEqual([{ email: "buyer@example.com", name: "Bea", metadata: { userId: owner.id } }]);
    expect(stripeCalls.sessions[0]).toMatchObject({
      mode: "payment",
      customer: "cus_test_1",
      client_reference_id: owner.id,
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: 1061, product_data: { name: "$10 of Build-a-bot credit" } } }],
      metadata: { userId: owner.id, creditCents: "1000" },
      success_url: "https://build-a-bot.example/app/billing?checkout=success",
      cancel_url: "https://build-a-bot.example/app/billing?checkout=cancel",
    });
    // The customer is made once and reused (each request reads the account afresh, as sign-in does).
    [owner] = await db.select().from(schema.users).where(eq(schema.users.id, owner.id));
    expect(owner.stripeCustomerId).toBe("cus_test_1");
    session.user = owner;
    await checkoutRoute.POST(post({ usd: 5 }));
    expect(stripeCalls.customers).toHaveLength(1);
    expect(stripeCalls.sessions[1]).toMatchObject({ customer: "cus_test_1", line_items: [{ price_data: { unit_amount: 546 } }] });
  });

  it("only in the amounts on offer, and only for an account with an email", async () => {
    const odd = await checkoutRoute.POST(post({ usd: 7 }));
    expect(odd.status).toBe(422);
    expect((await odd.json()).error).toBe("Add $5, $10 or $20 of credit.");
    const [anon] = await db.insert(schema.users).values({ id: "usr_anon_buyer", timezone: "UTC" }).returning();
    session.user = anon;
    try {
      const res = await checkoutRoute.POST(post({ usd: 5 }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Save your account with your email first.", needsEmail: true });
    } finally {
      session.user = owner;
    }
  });
});

describe("Stripe's webhook", () => {
  it("refuses a wrong signature", async () => {
    const res = await webhook(paidSession("cs_test_forged"), { secret: "whsec_someone_else" });
    expect(res.status).toBe(400);
    expect((await getCredit(db, owner.id)).addedMicros).toBe(0);
  });

  it("credits a paid session once, however often it arrives", async () => {
    expect((await webhook(paidSession("cs_test_paid"))).status).toBe(200);
    expect((await webhook(paidSession("cs_test_paid"))).status).toBe(200);
    expect(await getCredit(db, owner.id)).toMatchObject({ addedMicros: 10_000_000, balanceMicros: 11_000_000 });
    const [row] = await db.select().from(schema.credits);
    expect(row).toMatchObject({ userId: owner.id, kind: "topup", amountMicros: 10_000_000, paidCents: 1061, stripeSessionId: "cs_test_paid" });
  });

  it("waits for a slower payment to clear, then credits it", async () => {
    await webhook(paidSession("cs_test_bank", { payment_status: "unpaid", metadata: { userId: owner.id, creditCents: "500" } }));
    expect((await getCredit(db, owner.id)).addedMicros).toBe(10_000_000);
    const cleared = paidSession("cs_test_bank", { metadata: { userId: owner.id, creditCents: "500" }, amount_total: 546 });
    expect((await webhook({ ...cleared, id: "evt_cleared", type: "checkout.session.async_payment_succeeded" })).status).toBe(200);
    expect((await getCredit(db, owner.id)).addedMicros).toBe(15_000_000);
  });

  it("skips sessions that aren't a paid top-up for one of our accounts", async () => {
    await webhook(paidSession("cs_test_sub", { mode: "subscription" }));
    // Paid for an account deleted before Stripe confirmed it: nobody to credit, and the log says to refund it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await webhook(paidSession("cs_test_nobody", { client_reference_id: null, metadata: { userId: "usr_gone", creditCents: "1000" } }));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("cs_test_nobody is for an account that no longer exists"));
    warn.mockRestore();
    await webhook(paidSession("cs_test_nothing", { metadata: { userId: owner.id, creditCents: "0" } }));
    expect((await getCredit(db, owner.id)).addedMicros).toBe(15_000_000);
    // Other events are acknowledged and ignored.
    expect((await webhook({ id: "evt_other", object: "event", type: "customer.created", data: { object: { id: "cus_x", object: "customer" } } })).status).toBe(200);
  });
});
