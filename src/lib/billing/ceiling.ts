/**
 * Ceilings across the whole site, per UTC day, on what costs us money: turns on the included
 * brain and paid web lookups. Anyone with the link can sign up and accounts are cheap to make,
 * so per-account limits alone don't bound the bill. INCLUDED_DAILY_LIMIT and SEARCH_DAILY_LIMIT
 * change them; 0 turns a ceiling off.
 */
import type { Db } from "@/lib/db";
import { rateLimit } from "@/lib/safety/ratelimit";

const DEFAULTS = { included: 3000, search: 300 } as const;
export type Ceiling = keyof typeof DEFAULTS;

export function dailyCeiling(kind: Ceiling): number {
  const raw = process.env[kind === "included" ? "INCLUDED_DAILY_LIMIT" : "SEARCH_DAILY_LIMIT"]?.trim();
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
