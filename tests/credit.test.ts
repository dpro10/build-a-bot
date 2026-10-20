/**
 * Pay for what you use, at cost (Diego, 2026-10-16: "People should just pay for their usage, and
 * I'll be happy breaking even at first"):
 *
 * - The balance is the starter credit, plus credit added, minus what everything cost.
 * - A Stripe payment is credited once, however many times its webhook arrives.
 * - The card fee goes on top, so the credit is all the owner's.
 * - What costs money checks for credit first; your own AI has a fair-use limit instead; an account
 *   without a confirmed email gets a few messages.
 * - Demo mode adds credit without paying; signing in to an older account brings the credit along.
 * - Prices read the same everywhere: tiny amounts aren't rounded to $0.00.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
delete process.env.DATABASE_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STARTER_CREDIT_USD;

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => session.user,
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { addCredit, carryCredit, creditHistory, getCredit, hasCredit, outOfCreditMessage, starterCreditMicros } = await import("@/lib/billing/credit");
const { checkSpend, recordUsage } = await import("@/lib/billing/usage");
const prices = await import("@/lib/billing/prices");
const { INCLUDED_MODELS } = await import("@/lib/models/catalog");
const { createLoginLink, consumeLoginLink } = await import("@/lib/auth/magic");
const demoRoute = await import("@/app/api/billing/demo/route");
const exportRoute = await import("@/app/api/account/export/route");
import type { User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;

async function person(id: string, confirmed = true): Promise<User> {
  const [u] = await db
    .insert(schema.users)
    .values(confirmed ? { id, email: `${id}@example.com`, emailVerifiedAt: new Date(), timezone: "UTC" } : { id, timezone: "UTC" })
    .returning();
  return u;
}

const post = (url: string, body: unknown) => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
});

afterAll(async () => {
  delete process.env.STARTER_CREDIT_USD;
  await resetDbForTests();
});

describe("prices", () => {
  it("a top-up's card charge covers Stripe's fee, so the credit is all yours", () => {
    expect(prices.TOP_UPS_USD).toEqual([5, 10, 20]);
    expect(prices.TOP_UPS_USD.map(prices.topUpChargeCents)).toEqual([546, 1061, 2091]);
    for (const usd of prices.TOP_UPS_USD) {
      const charge = prices.topUpChargeCents(usd);
      // What Stripe keeps from that charge (2.9% + 30¢, rounded to the cent) leaves at least the credit.
      const fee = Math.round(charge * 0.029) + 30;
      expect(charge - fee).toBeGreaterThanOrEqual(usd * 100);
      expect(charge - fee).toBeLessThanOrEqual(usd * 100 + 1);
    }
  });

  it("a message on the default model costs what Token Factory charges for its tokens", () => {
    const lightning = INCLUDED_MODELS.find((m) => m.default)!;
    expect(lightning.label).toBe("Nemotron 3.5 Lightning");
    // 5,000 tokens in at $0.06 a million, 500 out at $0.24 a million.
    expect(prices.perMessageMicros(lightning)).toBe(420);
    expect(prices.tokensMicros(lightning, prices.TYPICAL_MEETING_HOUR)).toBe(1170);
    for (const m of INCLUDED_MODELS) expect(prices.perMessageMicros(m), m.id).toBeGreaterThan(0);
  });

  it("amounts read plainly, without rounding small ones away", () => {
    expect(prices.formatMicros(4_370_000)).toBe("$4.37");
    expect(prices.formatMicros(1_000_000)).toBe("$1.00");
    expect(prices.formatMicros(100_000)).toBe("$0.10");
    expect(prices.formatMicros(18_000)).toBe("$0.018");
    expect(prices.formatMicros(8_000)).toBe("$0.008");
    expect(prices.formatMicros(12_500)).toBe("$0.0125");
    expect(prices.formatMicros(420)).toBe("$0.00042");
    expect(prices.formatMicros(-2_100)).toBe("−$0.0021");
    expect(prices.formatMicros(0)).toBe("$0.00");
    expect(prices.formatCents(1061)).toBe("$10.61");
    expect(prices.about(2380.95)).toBe("2,400");
    expect(prices.about(153.8)).toBe("150");
    expect(prices.about(44.4)).toBe("44");
    expect(prices.creditTone(0)).toBe("danger");
    expect(prices.creditTone(100_000)).toBe("warning");
    expect(prices.creditTone(1_000_000)).toBe("primary");
  });
});

describe("the balance", () => {
  it("is the starter credit, plus what was added, minus what everything cost", async () => {
    expect(starterCreditMicros()).toBe(1_000_000);
    const u = await person("usr_balance");
    expect(await getCredit(db, u.id)).toEqual({ balanceMicros: 1_000_000, starterMicros: 1_000_000, addedMicros: 0, spentMicros: 0 });
    await recordUsage(db, u.id, { includedMessages: 1, messages: 1, costMicros: 420 });
    await recordUsage(db, u.id, { searches: 1, costMicros: prices.UNIT_PRICES.lookup }, new Date("2026-09-15T12:00:00Z")); // last month counts too
    await addCredit(db, { userId: u.id, kind: "topup", amountMicros: 10_000_000, paidCents: 1061, stripeSessionId: "cs_test_balance" });
    expect(await getCredit(db, u.id)).toEqual({ balanceMicros: 1_000_000 + 10_000_000 - 8_420, starterMicros: 1_000_000, addedMicros: 10_000_000, spentMicros: 8_420 });
    expect(await creditHistory(db, u.id)).toMatchObject([{ kind: "topup", amountMicros: 10_000_000, paidCents: 1061 }]);
  });

  it("credits a Stripe payment once, however often its webhook comes", async () => {
    const u = await person("usr_twice");
    expect(await addCredit(db, { userId: u.id, kind: "topup", amountMicros: 5_000_000, stripeSessionId: "cs_test_twice" })).toBe(true);
    expect(await addCredit(db, { userId: u.id, kind: "topup", amountMicros: 5_000_000, stripeSessionId: "cs_test_twice" })).toBe(false);
    expect((await getCredit(db, u.id)).addedMicros).toBe(5_000_000);
  });

  it("STARTER_CREDIT_USD changes the starter credit (0 for none)", () => {
    process.env.STARTER_CREDIT_USD = "0";
    expect(starterCreditMicros()).toBe(0);
    process.env.STARTER_CREDIT_USD = "2.5";
    expect(starterCreditMicros()).toBe(2_500_000);
    process.env.STARTER_CREDIT_USD = "lots";
    expect(starterCreditMicros()).toBe(1_000_000);
    delete process.env.STARTER_CREDIT_USD;
  });
});

describe("what costs money checks for credit first", () => {
  it("an included model, a lookup and a cloud-browser task need credit; out of it, it says how to get more", async () => {
    const u = await person("usr_spender");
    for (const kind of ["included", "lookup", "webTask"] as const) expect(await checkSpend(db, u, kind), kind).toEqual({ ok: true });
    await recordUsage(db, u.id, { costMicros: 1_000_000 }); // exactly the starter dollar: nothing left
    expect(await hasCredit(db, u.id)).toBe(false);
    expect(await checkSpend(db, u, "included")).toEqual({
      ok: false,
      code: "no_credit",
      message: "You're out of credit. Add credit in Credit & usage, or switch me to your own AI key in Settings → Brain (that's free here).",
    });
    expect(await checkSpend(db, u, "lookup")).toEqual({ ok: false, code: "no_credit", message: "You're out of credit. Add credit in Credit & usage to keep going." });
    // Your own AI is free here, so credit doesn't matter for it.
    expect(await checkSpend(db, u, "ownBrain")).toEqual({ ok: true });
  });

  it("your own AI has a monthly fair-use limit instead", async () => {
    const u = await person("usr_keyed");
    await recordUsage(db, u.id, { messages: prices.FAIR_USE.ownBrainMessages - 1 });
    expect(await checkSpend(db, u, "ownBrain")).toEqual({ ok: true });
    await recordUsage(db, u.id, { messages: 1 });
    expect(await checkSpend(db, u, "ownBrain")).toMatchObject({ ok: false, code: "fair_use" });
  });

  it("an account without a confirmed email gets a few messages, then is asked to sign in", async () => {
    const anon = await person("usr_anon_credit", false);
    await recordUsage(db, anon.id, { messages: 5, includedMessages: 5 });
    expect(await checkSpend(db, anon, "included")).toMatchObject({ ok: false, code: "sign_in" });
  });

  it("says adding credit is coming soon where it can't be added", () => {
    expect(outOfCreditMessage({ canAdd: false })).toBe("You're out of credit. Adding credit is coming soon.");
    expect(outOfCreditMessage({ canAdd: true })).toBe("You're out of credit. Add credit in Credit & usage to keep going.");
  });
});

describe("demo mode", () => {
  it("adds credit without paying, only in the amounts on offer", async () => {
    const u = await person("usr_demo_credit");
    session.user = u;
    const bad = await demoRoute.POST(post("http://localhost/api/billing/demo", { usd: 7 }));
    expect(bad.status).toBe(422);
    const res = await demoRoute.POST(post("http://localhost/api/billing/demo", { usd: 10 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: 10, demo: true });
    expect(await getCredit(db, u.id)).toMatchObject({ addedMicros: 10_000_000, balanceMicros: 11_000_000 });
    expect(await creditHistory(db, u.id)).toMatchObject([{ kind: "demo", amountMicros: 10_000_000, paidCents: null }]);
    // Up to $20 an account: a demo site with real keys still pays for what's used.
    const tooMuch = await demoRoute.POST(post("http://localhost/api/billing/demo", { usd: 20 }));
    expect(tooMuch.status).toBe(409);
    expect(await tooMuch.json()).toEqual({ error: "Demo mode adds up to $20 of credit to an account. This one can have $10 more.", code: "demo_cap" });
    expect((await demoRoute.POST(post("http://localhost/api/billing/demo", { usd: 10 }))).status).toBe(200);
    const over = await demoRoute.POST(post("http://localhost/api/billing/demo", { usd: 5 }));
    expect(over.status).toBe(409);
    expect(await over.json()).toEqual({ error: "Demo mode adds up to $20 of credit to an account, and this one has had it.", code: "demo_cap" });
    expect((await getCredit(db, u.id)).addedMicros).toBe(20_000_000);
  });
});

describe("signing in to an account you already had", () => {
  it("brings along the credit the first account added and didn't use (not its starter credit)", async () => {
    const existing = await person("usr_existing");
    const anon = await person("usr_built_first", false);
    await addCredit(db, { userId: anon.id, kind: "demo", amountMicros: 5_000_000 });
    await recordUsage(db, anon.id, { costMicros: 3_000_000 }); // $1 of starter credit, then $2 of the $5
    // Opened in the browser that asked for it (its sign-in cookie), so the account comes along.
    const browser = "b".repeat(43);
    const link = await createLoginLink(db, { email: existing.email!, anonymousUserId: anon.id, browser });
    const signedIn = await consumeLoginLink(db, new URL(link).searchParams.get("token")!, browser);
    expect(signedIn?.user.id).toBe(existing.id);
    expect((await db.select().from(schema.users).where(eq(schema.users.id, anon.id))).length).toBe(0);
    expect(await getCredit(db, existing.id)).toMatchObject({ addedMicros: 3_000_000, balanceMicros: 4_000_000 });
    // It was demo credit (a card needs an email first), and it stays demo credit.
    expect(await creditHistory(db, existing.id)).toMatchObject([{ kind: "demo", amountMicros: 3_000_000 }]);
  });

  it("moves demo credit only as far as the demo cap, so throwaway accounts can't pile it up", async () => {
    const main = await person("usr_main");
    await addCredit(db, { userId: main.id, kind: "demo", amountMicros: 18_000_000 });
    for (const [i, expected] of [[1, 20_000_000], [2, 20_000_000]] as const) {
      const throwaway = await person(`usr_throwaway_${i}`, false);
      await addCredit(db, { userId: throwaway.id, kind: "demo", amountMicros: 20_000_000 });
      const browser = `browser-${i}`.padEnd(43, "x");
      const link = await createLoginLink(db, { email: main.email!, anonymousUserId: throwaway.id, browser });
      expect((await consumeLoginLink(db, new URL(link).searchParams.get("token")!, browser))?.user.id).toBe(main.id);
      expect((await getCredit(db, main.id)).addedMicros).toBe(expected);
    }
  });
});

describe("your data", () => {
  it("the export has the credit added and what was used, never the Stripe session", async () => {
    const u = await person("usr_export_credit");
    session.user = u;
    await addCredit(db, { userId: u.id, kind: "topup", amountMicros: 5_000_000, paidCents: 546, stripeSessionId: "cs_test_secret_session" });
    await recordUsage(db, u.id, { messages: 2, includedMessages: 2, costMicros: 840 });
    const res = await exportRoute.GET();
    const text = await res.text();
    const data = JSON.parse(text);
    expect(data.credits).toMatchObject([{ kind: "topup", amountMicros: 5_000_000, paidCents: 546 }]);
    expect(data.usage).toMatchObject([{ messages: 2, costMicros: 840 }]);
    expect(text).not.toContain("cs_test_secret_session");
  });
});
