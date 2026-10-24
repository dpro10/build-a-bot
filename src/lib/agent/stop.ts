/**
 * The chat's Stop button. Asking to stop writes when it was asked (a row in rate_limits, keyed by
 * the conversation), so it reaches the turn whichever server instance runs it; the turn checks for
 * it every second. Only Stop stops an answer: a dropped connection (a phone locked mid-answer, a
 * Wi-Fi blip) leaves it to finish, and the chat picks it up when it's back.
 */
import { and, eq, gte } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";

const keyOf = (conversationId: string) => `chat-stop:${conversationId}`;

export async function askToStop(db: Db, conversationId: string, now = new Date()): Promise<void> {
  await db
    .insert(schema.rateLimits)
    .values({ key: keyOf(conversationId), windowStart: now, count: 1 })
    .onConflictDoUpdate({ target: schema.rateLimits.key, set: { windowStart: now, count: 1 } });
}

/** Stop was asked for this conversation at `since` or later. */
export async function stopAsked(db: Db, conversationId: string, since: Date): Promise<boolean> {
  const [row] = await db
    .select({ at: schema.rateLimits.windowStart })
    .from(schema.rateLimits)
    .where(and(eq(schema.rateLimits.key, keyOf(conversationId)), gte(schema.rateLimits.windowStart, since)))
    .limit(1);
  return Boolean(row);
}

/**
 * A signal for a turn that fires once Stop is asked for this conversation (checked every `everyMs`),
 * or when `signal` does. `done()` stops checking.
 */
export function watchForStop(db: Db, conversationId: string, signal?: AbortSignal, everyMs = 1000): { signal: AbortSignal; done: () => void } {
  const since = new Date();
  const stop = new AbortController();
  const onAbort = () => stop.abort();
  if (signal?.aborted) stop.abort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  let checking = false;
  const timer = setInterval(() => {
    if (checking || stop.signal.aborted) return;
    checking = true;
    stopAsked(db, conversationId, since)
      .then((asked) => {
        if (asked) stop.abort();
      })
      .catch(() => {})
      .finally(() => {
        checking = false;
      });
  }, everyMs);
  return {
    signal: stop.signal,
    done: () => {
      clearInterval(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}
