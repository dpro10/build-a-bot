import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, sameOrigin, type RouteCtx } from "@/lib/api";
import { runDueSchedules } from "@/lib/scheduler/tick";

export const maxDuration = 300;

/** "Run now": make it due and run the tick for it. */
export async function POST(req: Request, ctx: RouteCtx<{ botId: string; scheduleId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId, scheduleId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const due = new Date(Date.now() - 1000);
  const [row] = await a.db
    .update(schema.schedules)
    .set({ nextRunAt: due, active: true })
    .where(and(eq(schema.schedules.id, scheduleId), eq(schema.schedules.botId, botId)))
    .returning();
  if (!row) return apiError(404, "Not found");
  // Only this schedule — never anyone else's that happens to be due.
  const result = await runDueSchedules(a.db, new Date(), 1, { scheduleId: row.id });
  return json({ ok: true, ...result });
}
