/**
 * Credit: people pay for what they use, at cost (prices.ts). An account's balance is its starter
 * credit, plus the credit it added (the `credits` table: Stripe top-ups, or demo mode's), minus
 * what everything it used cost (`usage.cost_micros`, recorded as it happens). Things that cost us
 * money check for credit first; a balance can dip a little below zero (a message's cost is only
 * known once it's answered), and the next one waits until credit is added.
 */
import { and, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import { newId } from "@/lib/utils";
import { DEMO_CREDIT_CAP_USD } from "./prices";

/** Diego, 2026-10-21: "give people like $5 free credit to start". */
const STARTER_CREDIT_DEFAULT_USD = 5;

/** Credit every account starts with, so it can be tried without a card. STARTER_CREDIT_USD changes it (0: none). */
export function starterCreditMicros(): number {
  const raw = process.env.STARTER_CREDIT_USD?.trim();
  const usd = raw ? Number(raw) : STARTER_CREDIT_DEFAULT_USD;
  return Math.round((Number.isFinite(usd) && usd >= 0 ? usd : STARTER_CREDIT_DEFAULT_USD) * 1_000_000);
}

export type Credit = {
  /** What's left: starter + added − spent. */
  balanceMicros: number;
  starterMicros: number;
  /** Credit added (top-ups, demo credit, gifts), all time. */
  addedMicros: number;
  /** What everything used has cost, all time. */
  spentMicros: number;
};

export async function getCredit(db: Db, userId: string): Promise<Credit> {
  const [[added], [spent]] = await Promise.all([
    db
      .select({ v: sql<string>`coalesce(sum(${schema.credits.amountMicros}), 0)` })
      .from(schema.credits)
      .where(eq(schema.credits.userId, userId)),
    db
      .select({ v: sql<string>`coalesce(sum(${schema.usage.costMicros}), 0)` })
      .from(schema.usage)
      .where(eq(schema.usage.userId, userId)),
  ]);
  const starterMicros = starterCreditMicros();
  const addedMicros = Number(added?.v ?? 0);
  const spentMicros = Number(spent?.v ?? 0);
  return { balanceMicros: starterMicros + addedMicros - spentMicros, starterMicros, addedMicros, spentMicros };
}

/** There's credit left for something that costs money. */
export async function hasCredit(db: Db, userId: string): Promise<boolean> {
  return (await getCredit(db, userId)).balanceMicros > 0;
}

export type CreditKind = "topup" | "demo" | "gift" | "refund";

/**
 * Add credit (or take it back, with a negative amount). A Stripe session is credited once,
 * however many times its webhook arrives: returns false when it already was.
 */
export async function addCredit(
  db: Db,
  input: { userId: string; kind: CreditKind; amountMicros: number; paidCents?: number | null; stripeSessionId?: string | null; note?: string | null },
): Promise<boolean> {
  const rows = await db
    .insert(schema.credits)
    .values({
      id: newId("cr"),
      userId: input.userId,
      kind: input.kind,
      amountMicros: Math.round(input.amountMicros),
      paidCents: input.paidCents ?? null,
      stripeSessionId: input.stripeSessionId ?? null,
      note: input.note ?? null,
    })
    .onConflictDoNothing({ target: schema.credits.stripeSessionId })
    .returning({ id: schema.credits.id });
  return rows.length > 0;
}

/** Demo credit an account has been given (demo mode adds up to DEMO_CREDIT_CAP_USD of it). */
export async function demoCreditMicros(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ v: sql<string>`coalesce(sum(${schema.credits.amountMicros}), 0)` })
    .from(schema.credits)
    .where(and(eq(schema.credits.userId, userId), eq(schema.credits.kind, "demo")));
  return Number(row?.v ?? 0);
}

/**
 * Someone who built a bot before signing in, signing in to the account they already had: the
 * credit the first account added and didn't use moves over with its bots. Its starter credit
 * doesn't (the account it joins has its own), and neither does what it used.
 *
 * Before signing in, credit can only be added in demo mode (a card needs an email first), so it's
 * demo credit, and it moves only as far as the account it joins can still get demo credit:
 * otherwise signing in from one throwaway account after another would pile it up past the cap.
 */
export async function carryCredit(db: Db, fromUserId: string, toUserId: string): Promise<void> {
  const c = await getCredit(db, fromUserId);
  const unused = c.addedMicros - Math.max(0, c.spentMicros - c.starterMicros);
  const room = DEMO_CREDIT_CAP_USD * 1_000_000 - (await demoCreditMicros(db, toUserId));
  const moved = Math.min(unused, room);
  if (moved > 0) await addCredit(db, { userId: toUserId, kind: "demo", amountMicros: moved, note: "moved from before you signed in" });
}

/** Credit added to an account, newest first (for Credit & usage). */
export async function creditHistory(db: Db, userId: string, limit = 20) {
  return db
    .select({ id: schema.credits.id, kind: schema.credits.kind, amountMicros: schema.credits.amountMicros, paidCents: schema.credits.paidCents, createdAt: schema.credits.createdAt })
    .from(schema.credits)
    .where(eq(schema.credits.userId, userId))
    .orderBy(sql`${schema.credits.createdAt} desc`)
    .limit(limit);
}

/**
 * "You're out of credit…": what to say when something that costs money can't run. `canAdd`:
 * credit can be added here (Stripe, or demo mode); `ownBrain`: switching the bot to the owner's
 * own AI key would get around it (it's for thinking).
 */
export function outOfCreditMessage(opts: { canAdd: boolean; ownBrain?: boolean }): string {
  const add = opts.canAdd ? "Add credit in Credit & usage" : "Adding credit is coming soon";
  if (opts.ownBrain) return `You're out of credit. ${add}${opts.canAdd ? "," : ";"} or switch me to your own AI key in Settings → Brain (that's free here).`;
  return `You're out of credit. ${add}${opts.canAdd ? " to keep going." : "."}`;
}
