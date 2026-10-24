/**
 * Monthly usage counters (one row per user per UTC month), with what it all cost us
 * (`costMicros`, which credit pays for), and the check before anything that costs money.
 */
import { eq, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { creditOpen, demoMode } from "@/lib/env";
import { periodKey } from "@/lib/utils";
import { SITE_BUDGET_MESSAGE, countSiteSpend, siteBudget, siteDailyBudgetMicros } from "./ceiling";
import { getCredit, guestsBudgetMessage, outOfCreditMessage, signInForCreditMessage } from "./credit";
import { ANONYMOUS_INCLUDED_MESSAGES, FAIR_USE } from "./prices";

export { ANONYMOUS_INCLUDED_MESSAGES };

export type UsageDelta = Partial<{
  messages: number;
  includedMessages: number;
  tokensIn: number;
  tokensOut: number;
  searches: number;
  actions: number;
  voiceSeconds: number;
  meetingSeconds: number;
  dictationWords: number;
  smsSegments: number;
  emailsSent: number;
  costMicros: number;
}>;

export async function recordUsage(db: Db, userId: string, delta: UsageDelta, when = new Date()) {
  const period = periodKey(when);
  const id = `${userId}:${period}`;
  const d = {
    messages: delta.messages ?? 0,
    includedMessages: delta.includedMessages ?? 0,
    tokensIn: delta.tokensIn ?? 0,
    tokensOut: delta.tokensOut ?? 0,
    searches: delta.searches ?? 0,
    actions: delta.actions ?? 0,
    voiceSeconds: delta.voiceSeconds ?? 0,
    meetingSeconds: delta.meetingSeconds ?? 0,
    dictationWords: delta.dictationWords ?? 0,
    smsSegments: delta.smsSegments ?? 0,
    emailsSent: delta.emailsSent ?? 0,
    costMicros: Math.round(delta.costMicros ?? 0),
  };
  await db
    .insert(schema.usage)
    .values({ id, userId, period, ...d })
    .onConflictDoUpdate({
      target: schema.usage.id,
      set: {
        messages: sql`${schema.usage.messages} + ${d.messages}`,
        includedMessages: sql`${schema.usage.includedMessages} + ${d.includedMessages}`,
        tokensIn: sql`${schema.usage.tokensIn} + ${d.tokensIn}`,
        tokensOut: sql`${schema.usage.tokensOut} + ${d.tokensOut}`,
        searches: sql`${schema.usage.searches} + ${d.searches}`,
        actions: sql`${schema.usage.actions} + ${d.actions}`,
        voiceSeconds: sql`${schema.usage.voiceSeconds} + ${d.voiceSeconds}`,
        meetingSeconds: sql`${schema.usage.meetingSeconds} + ${d.meetingSeconds}`,
        dictationWords: sql`${schema.usage.dictationWords} + ${d.dictationWords}`,
        smsSegments: sql`${schema.usage.smsSegments} + ${d.smsSegments}`,
        emailsSent: sql`${schema.usage.emailsSent} + ${d.emailsSent}`,
        costMicros: sql`${schema.usage.costMicros} + ${d.costMicros}`,
        updatedAt: new Date(),
      },
    });
  // And toward today's budget for the whole site, and the share of it for accounts that haven't signed in (ceiling.ts).
  if (d.costMicros > 0 && siteDailyBudgetMicros()) {
    const [user] = await db.select({ verified: schema.users.emailVerifiedAt }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    await countSiteSpend(db, d.costMicros, !user?.verified);
  }
}

export async function getUsage(db: Db, userId: string, when = new Date()) {
  const id = `${userId}:${periodKey(when)}`;
  const [row] = await db.select().from(schema.usage).where(eq(schema.usage.id, id)).limit(1);
  return (
    row ?? {
      id,
      userId,
      period: periodKey(when),
      messages: 0,
      includedMessages: 0,
      tokensIn: 0,
      tokensOut: 0,
      searches: 0,
      actions: 0,
      voiceSeconds: 0,
      meetingSeconds: 0,
      dictationWords: 0,
      smsSegments: 0,
      emailsSent: 0,
      costMicros: 0,
      updatedAt: new Date(),
    }
  );
}

/**
 * What's about to cost money (or, for your own AI, use our servers). Texts, calls, speech heard on
 * our server and voice typing's AI cleanup check `hasCredit` directly (credit.ts).
 */
export type SpendKind = "included" | "ownBrain" | "lookup" | "webTask" | "call";

export type SpendCheck = { ok: true } | { ok: false; code: "no_credit" | "sign_in" | "fair_use" | "site_budget"; message: string };

/**
 * Messages on an included model an account gets before it signs in (this month), or null once
 * it has: then it's the credit that counts.
 */
export async function freeMessagesLeft(db: Db, owner: Pick<User, "id" | "emailVerifiedAt">): Promise<number | null> {
  if (owner.emailVerifiedAt) return null;
  const u = await getUsage(db, owner.id);
  return Math.max(0, ANONYMOUS_INCLUDED_MESSAGES - u.includedMessages);
}

/**
 * Can this account do something that costs money? There are no plans: people pay for what they
 * use (prices.ts), so the answer is whether there's credit left, and room in today's budget for
 * the whole site (ceiling.ts). Before signing in, an account gets a few messages on an included
 * model and the web lookups they make, and nothing else that costs money: its credit opens up with
 * an email. Messages on your own AI key have a generous monthly fair-use limit (they're free here,
 * but use our servers).
 */
export async function checkSpend(db: Db, owner: Pick<User, "id" | "emailVerifiedAt">, kind: SpendKind): Promise<SpendCheck> {
  if (kind === "ownBrain") {
    const u = await getUsage(db, owner.id);
    if (u.messages - u.includedMessages < FAIR_USE.ownBrainMessages) return { ok: true };
    return {
      ok: false,
      code: "fair_use",
      message: `You've sent ${FAIR_USE.ownBrainMessages.toLocaleString("en-US")} messages on your own AI this month, the fair-use limit. It resets on the 1st.`,
    };
  }
  // Today's budget for the whole site, and before signing in, the share of it for those accounts.
  const budget = await siteBudget(db, !owner.emailVerifiedAt && !demoMode);
  if (budget === "site") return { ok: false, code: "site_budget", message: SITE_BUDGET_MESSAGE };
  if (budget === "guests") return { ok: false, code: "sign_in", message: guestsBudgetMessage() };
  if (!owner.emailVerifiedAt) {
    if (kind === "included") {
      const u = await getUsage(db, owner.id);
      if (u.includedMessages >= ANONYMOUS_INCLUDED_MESSAGES) {
        return {
          ok: false,
          code: "sign_in",
          message: `You've used the ${ANONYMOUS_INCLUDED_MESSAGES} free messages you get before signing in. Sign in with your email (it's free) to keep going.`,
        };
      }
      return { ok: true };
    }
    // The lookups those messages make are on us too (today's share for guests bounds them, ceiling.ts).
    if (kind === "lookup") return { ok: true };
    // Calls and web tasks wait for an email (demo mode, where nothing real is charged, aside).
    if (!demoMode) return { ok: false, code: "sign_in", message: signInForCreditMessage() };
  }
  if ((await getCredit(db, owner.id)).balanceMicros > 0) return { ok: true };
  return { ok: false, code: "no_credit", message: outOfCreditMessage({ canAdd: creditOpen, ownBrain: kind === "included" }) };
}
