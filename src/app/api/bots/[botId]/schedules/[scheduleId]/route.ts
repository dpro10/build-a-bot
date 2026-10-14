import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { computeNextRun } from "@/lib/scheduler/time";

type Ctx = RouteCtx<{ botId: string; scheduleId: string }>;

export async function PATCH(req: Request, ctx: Ctx) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId, scheduleId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(
    req,
    z.object({ active: z.boolean().optional(), title: z.string().trim().min(1).max(120).optional(), prompt: z.string().trim().min(1).max(2000).optional(), deliverOn: z.string().max(20).optional() }),
  );
  if (!parsed.ok) return parsed.res;
  const [existing] = await a.db.select().from(schema.schedules).where(and(eq(schema.schedules.id, scheduleId), eq(schema.schedules.botId, botId))).limit(1);
  if (!existing) return apiError(404, "Not found");
  const updates: Partial<typeof schema.schedules.$inferInsert> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.active === true && !existing.active) updates.nextRunAt = computeNextRun(existing.schedule, existing.timezone, new Date());
  const [row] = await a.db.update(schema.schedules).set(updates).where(eq(schema.schedules.id, scheduleId)).returning();
  return json({ schedule: row });
}

export async function DELETE(req: Request, ctx: Ctx) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId, scheduleId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  await a.db.delete(schema.schedules).where(and(eq(schema.schedules.id, scheduleId), eq(schema.schedules.botId, botId)));
  return json({ ok: true });
}
