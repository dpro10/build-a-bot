import { z } from "zod";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { listSchedules } from "@/lib/data";
import { computeNextRun, describeSchedule } from "@/lib/scheduler/time";
import { FAIR_USE } from "@/lib/billing/prices";
import { demoMode } from "@/lib/env";
import { newId } from "@/lib/utils";
import { and, count, eq } from "drizzle-orm";

const scheduleShape = z.discriminatedUnion("type", [
  z.object({ type: z.literal("once"), at: z.string() }),
  z.object({ type: z.literal("daily"), time: z.string().regex(/^\d{2}:\d{2}$/), days: z.array(z.number().int().min(0).max(6)).optional() }),
  z.object({ type: z.literal("interval"), minutes: z.number().int().min(15).max(10080) }),
  z.object({ type: z.literal("cron"), expr: z.string().min(9).max(60) }),
]);

export async function GET(_req: Request, ctx: RouteCtx<{ botId: string }>) {
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const rows = await listSchedules(a.db, botId);
  return json({ schedules: rows.map((r) => ({ ...r, description: describeSchedule(r.schedule, r.timezone) })) });
}

export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(
    req,
    z.object({
      kind: z.enum(["reminder", "routine"]),
      title: z.string().trim().min(1).max(120),
      prompt: z.string().trim().min(1).max(2000),
      schedule: scheduleShape,
      deliverOn: z.string().max(20).optional(),
    }),
  );
  if (!parsed.ok) return parsed.res;
  if (parsed.data.kind === "routine" && !demoMode) {
    const [{ n }] = await a.db.select({ n: count() }).from(schema.schedules).where(and(eq(schema.schedules.botId, botId), eq(schema.schedules.kind, "routine"), eq(schema.schedules.active, true)));
    if (n >= FAIR_USE.routines) return apiError(409, `A bot can have up to ${FAIR_USE.routines} routines on. Turn one off to make room.`, { code: "fair_use" });
  }
  const tz = a.user.timezone || "UTC";
  const nextRunAt = computeNextRun(parsed.data.schedule, tz, new Date());
  if (!nextRunAt) return apiError(422, "That schedule never comes up.");
  const [row] = await a.db
    .insert(schema.schedules)
    .values({
      id: newId("sch"),
      botId,
      kind: parsed.data.kind,
      title: parsed.data.title,
      prompt: parsed.data.prompt,
      schedule: parsed.data.schedule,
      timezone: tz,
      deliverOn: parsed.data.deliverOn ?? "auto",
      nextRunAt,
    })
    .returning();
  return json({ schedule: { ...row, description: describeSchedule(row.schedule, row.timezone) } });
}
