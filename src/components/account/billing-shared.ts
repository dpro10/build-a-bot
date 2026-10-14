/**
 * Helpers shared by the Plan & usage and Account pages (server side).
 */
import { count, eq } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import { usageSummary } from "@/lib/data";
import type { UsageNumbers } from "./UsageMeters";

/** The user's time zone if the runtime knows it, else UTC (stored zones aren't validated everywhere). */
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** Usage periods are UTC calendar months ("2026-10"); they reset on the 1st. */
export function periodLabels(period: string) {
  const [y, m] = period.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const reset = new Date(Date.UTC(y, m, 1));
  return {
    month: start.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }),
    reset: reset.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  };
}

export async function usageNumbers(db: Db, userId: string): Promise<{ used: UsageNumbers; period: string }> {
  const [usage, [bots]] = await Promise.all([
    usageSummary(db, userId),
    db.select({ n: count() }).from(schema.bots).where(eq(schema.bots.ownerId, userId)),
  ]);
  return {
    period: usage.period,
    used: {
      includedMessages: usage.includedMessages,
      // Everything answered that wasn't on our included brains (subscription turns aren't recorded).
      byoMessages: Math.max(0, usage.messages - usage.includedMessages),
      searches: usage.searches,
      voiceMinutes: Math.ceil(usage.voiceSeconds / 60),
      smsSegments: usage.smsSegments,
      bots: Number(bots?.n ?? 0),
    },
  };
}
