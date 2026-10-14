import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { computeNextRun, describeSchedule } from "@/lib/scheduler/time";

type Ctx = RouteCtx<{ botId: string; scheduleId: string }>;

// Same shapes POST /schedules accepts.
const scheduleShape = z.discriminatedUnion("type", [
  z.object({ type: z.literal("once"), at: z.string() }),
  z.object({ type: z.literal("daily"), time: z.string().regex(/^\d{2}:\d{2}$/), days: z.array(z.number().int().min(0).max(6)).optional() }),
  z.object({ type: z.literal("interval"), minutes: z.number().int().min(15).max(10080) }),
  z.object({ type: z.literal("cron"), expr: z.string().min(9).max(60) }),
]);

export async function PATCH(req: Request, ctx: Ctx) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId, scheduleId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(
    req,
    z.object({
      active: z.boolean().optional(),
      title: z.string().trim().min(1).max(120).optional(),
      prompt: z.string().trim().min(1).max(2000).optional(),
      deliverOn: z.string().max(20).optional(),
      schedule: scheduleShape.optional(),
    }),
  );
  if (!parsed.ok) return parsed.res;
  const [existing] = await a.db.select().from(schema.schedules).where(and(eq(schema.schedules.id, scheduleId), eq(schema.schedules.botId, botId))).limit(1);
  if (!existing) return apiError(404, "Not found");
  const { schedule: newSchedule, ...rest } = parsed.data;
  const updates: Partial<typeof schema.schedules.$inferInsert> = { ...rest, updatedAt: new Date() };
  const willBeActive = parsed.data.active ?? existing.active;
  if (newSchedule) {
    // Times the owner typed are in their current time zone.
    const tz = a.user.timezone || existing.timezone || "UTC";
    const next = computeNextRun(newSchedule, tz, new Date());
    if (!next) return apiError(422, newSchedule.type === "once" ? "That time has already passed. Pick a time in the future." : "That schedule never comes up.");
    updates.schedule = newSchedule;
    updates.timezone = tz;
    updates.nextRunAt = willBeActive ? next : existing.nextRunAt;
  } else if (parsed.data.active === true && !existing.active) {
    const next = computeNextRun(existing.schedule, existing.timezone, new Date());
    if (!next) return apiError(422, "That time has already passed. Edit it to pick a new time.");
    updates.nextRunAt = next;
  }
  const [row] = await a.db.update(schema.schedules).set(updates).where(eq(schema.schedules.id, scheduleId)).returning();
  return json({ schedule: { ...row, description: describeSchedule(row.schedule, row.timezone) } });
}

export async function DELETE(req: Request, ctx: Ctx) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId, scheduleId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  await a.db.delete(schema.schedules).where(and(eq(schema.schedules.id, scheduleId), eq(schema.schedules.botId, botId)));
  return json({ ok: true });
}
