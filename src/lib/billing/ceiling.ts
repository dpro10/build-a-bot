/**
 * Ceilings across the whole site, per UTC day, on what costs us money: turns on the included
 * brain, paid web lookups and voice typing (speech-to-text plus a short cleanup call). Anyone with
 * the link can sign up and accounts are cheap to make, so per-account limits alone don't bound
 * the bill. INCLUDED_DAILY_LIMIT, SEARCH_DAILY_LIMIT and DICTATION_DAILY_LIMIT change them;
 * 0 turns a ceiling off.
 */
import type { Db } from "@/lib/db";
import { rateLimit } from "@/lib/safety/ratelimit";

/** Dictations cost about $0.0003 each, so 20,000 a day is about $6. */
const DEFAULTS = { included: 3000, search: 300, dictation: 20000 } as const;
export type Ceiling = keyof typeof DEFAULTS;
const ENV: Record<Ceiling, string> = { included: "INCLUDED_DAILY_LIMIT", search: "SEARCH_DAILY_LIMIT", dictation: "DICTATION_DAILY_LIMIT" };

export function dailyCeiling(kind: Ceiling): number {
  const raw = process.env[ENV[kind]]?.trim();
  const n = raw ? Number(raw) : DEFAULTS[kind];
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULTS[kind];
}

/** Counts one use against today's ceiling; false once it's reached. */
export async function underDailyCeiling(db: Db, kind: Ceiling): Promise<boolean> {
  const limit = dailyCeiling(kind);
  if (!limit) return true;
  const { ok } = await rateLimit(db, `ceiling:${kind}`, limit, 86_400);
  if (!ok) console.warn(`[ceiling] today's ${kind} ceiling (${limit}) is reached`);
  return ok;
}
