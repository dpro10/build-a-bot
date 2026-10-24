/**
 * Ceilings across the whole site, per UTC day, on what costs us money: turns on the included
 * brain, paid web lookups and voice typing (speech-to-text plus a short cleanup call). Anyone with
 * the link can sign up and accounts are cheap to make, so per-account limits alone don't bound
 * the bill. INCLUDED_DAILY_LIMIT, SEARCH_DAILY_LIMIT and DICTATION_DAILY_LIMIT change them;
 * 0 turns a ceiling off. Each account, and the accounts that haven't signed in, get a share.
 */
import { inArray } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import { rateLimit, refundRateLimit } from "@/lib/safety/ratelimit";

/** Dictations cost about $0.0003 each, so 20,000 a day is about $6. */
const DEFAULTS = { included: 3000, search: 300, dictation: 20000 } as const;
export type Ceiling = keyof typeof DEFAULTS;
const ENV: Record<Ceiling, string> = { included: "INCLUDED_DAILY_LIMIT", search: "SEARCH_DAILY_LIMIT", dictation: "DICTATION_DAILY_LIMIT" };

export function dailyCeiling(kind: Ceiling): number {
  const raw = process.env[ENV[kind]]?.trim();
  const n = raw ? Number(raw) : DEFAULTS[kind];
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULTS[kind];
}

/**
 * No one gets to use up a day for everyone: each account may take a share of each ceiling, and the
 * accounts that haven't signed in (cheap to make, a cookie each) a share between them, and only so
 * much from any one network. A share is never less than `atLeast` (a small ceiling, on a site run
 * for a few people, isn't split up), and one as big as the ceiling itself isn't checked.
 */
const SHARES: Record<Ceiling, { account: number; guests: number; atLeast: number; guestNetwork: number }> = {
  included: { account: 0.1, guests: 0.25, atLeast: 50, guestNetwork: 50 },
  // Every bot can search now, judges included before they sign in: a quarter of the day is theirs.
  search: { account: 0.1, guests: 0.25, atLeast: 10, guestNetwork: 10 },
  dictation: { account: 0.05, guests: 0.05, atLeast: 300, guestNetwork: 300 },
};

/** Who's spending: the account, whether it has signed in, and (from the web) its network (net.ts networkOf). */
export type Spender = { userId: string; guest: boolean; network?: string | null };

export function spenderOf(owner: { id: string; emailVerifiedAt: Date | null }, network: string | null = null): Spender {
  return { userId: owner.id, guest: !owner.emailVerifiedAt, network };
}

/**
 * What ran out today, if anything: the whole site's ceiling, this account's share of it, or the
 * share of accounts that haven't signed in, all together or on this network.
 */
export type Room = "ok" | "site" | "account" | "guests" | "network";

/**
 * Counts `uses` (one by default: a fact check of several claims is several lookups) against today's
 * ceiling and the spender's shares of it. When they don't all fit, nothing is counted and the
 * answer says which ran out.
 */
export async function roomToday(db: Db, kind: Ceiling, who: Spender | null, uses = 1): Promise<Room> {
  const limit = dailyCeiling(kind);
  if (!limit) return "ok";
  const s = SHARES[kind];
  const share = (fraction: number) => Math.max(s.atLeast, Math.floor(limit * fraction));
  const shares: { room: Exclude<Room, "ok" | "site">; key: string; limit: number }[] = [];
  if (who?.guest && who.network) shares.push({ room: "network", key: `ceiling:${kind}:network:${who.network}`, limit: s.guestNetwork });
  if (who) shares.push({ room: "account", key: `ceiling:${kind}:account:${who.userId}`, limit: share(s.account) });
  if (who?.guest) shares.push({ room: "guests", key: `ceiling:${kind}:guests`, limit: share(s.guests) });
  const checks = [...shares.filter((c) => c.limit < limit), { room: "site" as const, key: `ceiling:${kind}`, limit }];
  const counted: string[] = [];
  for (const c of checks) {
    const { ok } = await rateLimit(db, c.key, c.limit, 86_400, uses);
    counted.push(c.key);
    if (!ok) {
      for (const key of counted) await refundRateLimit(db, key, uses);
      console.warn(`[ceiling] today's ${kind} ${c.room === "site" ? "ceiling" : `share (${c.room})`} of ${c.limit} is reached`);
      return c.room;
    }
  }
  return "ok";
}

/** roomToday as a yes or no. */
export async function underDailyCeiling(db: Db, kind: Ceiling, uses = 1, who: Spender | null = null): Promise<boolean> {
  return (await roomToday(db, kind, who, uses)) === "ok";
}

/**
 * And one in dollars, on everything we pay for (the models, web lookups, speech), per UTC day:
 * counting messages can't bound the bill on its own (a turn on the priciest model costs a hundred
 * of the default's). SITE_DAILY_USD changes it, $10 by default; 0 turns it off. When it's spent,
 * what costs money waits for tomorrow; people's own AI keys keep working. The accounts that haven't
 * signed in (a cookie each) share at most GUESTS_SHARE of it: past that they're asked to sign in
 * (it's free, and their own credit comes with it), so they can't use up the day for everyone.
 */
const SITE_DAILY_USD_DEFAULT = 10;
const SITE_SPEND_KEY = "ceiling:usd";
const GUESTS_SHARE = 0.3;
const GUESTS_SPEND_KEY = "ceiling:usd:guests";

export function siteDailyBudgetMicros(): number {
  const raw = process.env.SITE_DAILY_USD?.trim();
  const usd = raw ? Number(raw) : SITE_DAILY_USD_DEFAULT;
  return Math.round((Number.isFinite(usd) && usd >= 0 ? usd : SITE_DAILY_USD_DEFAULT) * 1_000_000);
}

export const SITE_BUDGET_MESSAGE =
  "So many people are trying Build-a-bot today that today's budget for the models and services we pay for is used up. It resets at midnight UTC. To keep going now, switch your bot to your own AI key in Settings → Brain.";

/** Counts what something cost toward today's budget for the whole site (and the guests' share, for a guest's). */
export async function countSiteSpend(db: Db, micros: number, guest = false): Promise<void> {
  if (!(micros > 0) || !siteDailyBudgetMicros()) return;
  await rateLimit(db, SITE_SPEND_KEY, Number.MAX_SAFE_INTEGER, 86_400, Math.round(micros));
  if (guest) await rateLimit(db, GUESTS_SPEND_KEY, Number.MAX_SAFE_INTEGER, 86_400, Math.round(micros));
}

/**
 * What's left of today's budget: "ok"; "site", when the whole site's is spent; or, asked for an
 * account that hasn't signed in, "guests", when their share is.
 */
export async function siteBudget(db: Db, guest = false, now = new Date()): Promise<"ok" | "site" | "guests"> {
  const budget = siteDailyBudgetMicros();
  if (!budget) return "ok";
  const today = Math.floor(now.getTime() / 86_400_000) * 86_400_000;
  const rows = await db
    .select()
    .from(schema.rateLimits)
    .where(inArray(schema.rateLimits.key, guest ? [SITE_SPEND_KEY, GUESTS_SPEND_KEY] : [SITE_SPEND_KEY]));
  const spent = (key: string) => rows.find((r) => r.key === key && r.windowStart.getTime() === today)?.count ?? 0;
  if (spent(SITE_SPEND_KEY) >= budget) {
    console.warn(`[ceiling] today's budget of $${(budget / 1_000_000).toFixed(2)} for the whole site is spent`);
    return "site";
  }
  if (guest && spent(GUESTS_SPEND_KEY) >= Math.floor(budget * GUESTS_SHARE)) {
    console.warn("[ceiling] the share of today's budget for accounts that haven't signed in is spent");
    return "guests";
  }
  return "ok";
}

/** There's budget left today for the whole site. */
export async function siteBudgetLeft(db: Db, now = new Date()): Promise<boolean> {
  return (await siteBudget(db, false, now)) === "ok";
}
