/** Fixed-window rate limits stored in Postgres (works across serverless instances). */
import { eq, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";

/** Counts `uses` (one by default) against a key's limit for the current window. */
export async function rateLimit(db: Db, key: string, limit: number, windowSeconds: number, uses = 1): Promise<{ ok: boolean; remaining: number; resetAt: Date }> {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const [row] = await db
    .insert(schema.rateLimits)
    .values({ key, windowStart, count: uses })
    .onConflictDoUpdate({
      target: schema.rateLimits.key,
      set: {
        count: sql`case when ${schema.rateLimits.windowStart} = ${windowStart} then ${schema.rateLimits.count} + ${uses} else ${uses} end`,
        windowStart,
      },
    })
    .returning({ count: schema.rateLimits.count });
  const count = row?.count ?? uses;
  return { ok: count <= limit, remaining: Math.max(0, limit - count), resetAt: new Date(windowStart.getTime() + windowSeconds * 1000) };
}

/** Takes back uses of a key (one by default), for something that didn't happen after all (a code the provider refused to send). */
export async function refundRateLimit(db: Db, key: string, uses = 1): Promise<void> {
  await db
    .update(schema.rateLimits)
    .set({ count: sql`greatest(${schema.rateLimits.count} - ${uses}, 0)` })
    .where(eq(schema.rateLimits.key, key));
}
