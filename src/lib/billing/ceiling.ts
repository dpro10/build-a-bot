/**
 * Ceilings across the whole site, per UTC day, on what costs us money: turns on the included
 * brain, paid web lookups and voice typing (speech-to-text plus a short cleanup call). Anyone with
 * the link can sign up and accounts are cheap to make, so per-account limits alone don't bound
 * the bill. INCLUDED_DAILY_LIMIT, SEARCH_DAILY_LIMIT and DICTATION_DAILY_LIMIT change them;
 * 0 turns a ceiling off. Each account, and the accounts that haven't signed in, get a share.
 */
import type { Db } from "@/lib/db";
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
  search: { account: 0.1, guests: 0.1, atLeast: 10, guestNetwork: 10 },
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
