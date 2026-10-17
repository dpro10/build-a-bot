/** Fixed-window rate limits stored in Postgres (works across serverless instances). */
import { eq, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";

export async function rateLimit(db: Db, key: string, limit: number, windowSeconds: number): Promise<{ ok: boolean; remaining: number }> {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const [row] = await db
    .insert(schema.rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: schema.rateLimits.key,
      set: {
        count: sql`case when ${schema.rateLimits.windowStart} = ${windowStart} then ${schema.rateLimits.count} + 1 else 1 end`,
        windowStart,
      },
    })
    .returning({ count: schema.rateLimits.count });
  const count = row?.count ?? 1;
  return { ok: count <= limit, remaining: Math.max(0, limit - count) };
}

/** Takes back one use of a key, for something that didn't happen after all (a code the provider refused to send). */
export async function refundRateLimit(db: Db, key: string): Promise<void> {
  await db
    .update(schema.rateLimits)
    .set({ count: sql`greatest(${schema.rateLimits.count} - 1, 0)` })
    .where(eq(schema.rateLimits.key, key));
}
