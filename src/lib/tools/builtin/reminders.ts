import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { schema } from "@/lib/db";
import { newId } from "@/lib/utils";
import { computeNextRun, describeSchedule, parseOwnerDateTime } from "@/lib/scheduler/time";
import type { Schedule } from "@/lib/db/schema";
import { defineTool, type ToolContext } from "../types";

const deliverOn = z
  .enum(["auto", "web", "sms", "voice", "email", "telegram", "discord", "slack"])
  .optional()
  .describe("Where to deliver it. 'auto' = the owner's usual channel. 'voice' = a phone call.");

/** Reminders and routines one bot can have waiting: plenty for a person, and no flood for the minute's tick. */
const MAX_ACTIVE = 100;

async function roomForAnother(ctx: ToolContext): Promise<boolean> {
  const [{ n }] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.schedules)
    .where(and(eq(schema.schedules.botId, ctx.bot.id), eq(schema.schedules.active, true)));
  return n < MAX_ACTIVE;
}
const FULL = `There are already ${MAX_ACTIVE} reminders and routines waiting. Cancel some first.`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14:57" → "2:57 PM" (the owner's own clock, as typed). */
function clockLabel(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** "2026-10-14T14:57" (owner's local time) → "Oct 14, 2:57 PM". */
function localLabel(at: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}:\d{2})/.exec(at);
  return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${clockLabel(m[4])}` : `at ${at}`;
}

export const createReminder = defineTool({
  name: "create_reminder",
  title: "Set a reminder",
  description:
    "Remind the owner about something at a specific time, once or repeating. Give `at` as a local datetime in the owner's timezone (YYYY-MM-DDTHH:MM) for one-offs, or `daily_time` (HH:MM, 24h) with optional `days` for repeats.",
  input: z.object({
    text: z.string().min(1).max(500).describe("What to remind them, written as you'll say it"),
    at: z.string().optional().describe("One-off time, owner's local time: 2026-10-14T18:00"),
    daily_time: z.string().regex(/^\d{1,2}:\d{2}$/).optional().describe("For repeating reminders: HH:MM 24h"),
    days: z.array(z.number().int().min(0).max(6)).optional().describe("Repeat days, 0=Sun..6=Sat; omit for every day"),
    deliver_on: deliverOn,
  }),
  connectorId: "reminders",
  capabilityId: "create_reminder",
  effect: "write",
  risk: "low",
  taints: false,
  ownerOnly: true,
  summarize: (a) => `Reminder: “${a.text}” ${a.at ? localLabel(a.at) : a.daily_time ? `daily at ${clockLabel(a.daily_time)}` : ""}`.trim(),
  async run(args, ctx) {
    const tz = ctx.owner.timezone || "UTC";
    let schedule: Schedule;
    if (args.daily_time) schedule = { type: "daily", time: args.daily_time.padStart(5, "0"), days: args.days };
    else if (args.at) {
      const at = parseOwnerDateTime(args.at, tz);
      if (!at) return { ok: false, error: "I couldn't understand that time. Use YYYY-MM-DDTHH:MM." };
      if (at.getTime() < ctx.now.getTime() - 60_000) return { ok: false, error: "That time has already passed." };
      schedule = { type: "once", at: at.toISOString() };
    } else return { ok: false, error: "Tell me when: a time (at) or a daily time (daily_time)." };
    if (!(await roomForAnother(ctx))) return { ok: false, error: FULL };
    const nextRunAt = computeNextRun(schedule, tz, new Date(ctx.now.getTime() - 1000));
    if (!nextRunAt) return { ok: false, error: "That schedule never comes up." };
    const id = newId("sch");
    await ctx.db.insert(schema.schedules).values({
      id,
      botId: ctx.bot.id,
      kind: "reminder",
      title: args.text.slice(0, 120),
      prompt: args.text,
      schedule,
      timezone: tz,
      deliverOn: args.deliver_on ?? "auto",
      nextRunAt,
    });
    const when = describeSchedule(schedule, tz);
    return { ok: true, content: `Reminder set (${id}): “${args.text}” — ${when}.`, summary: when, data: { id } };
  },
});

export const scheduleRoutine = defineTool({
  name: "schedule_routine",
  title: "Schedule a routine",
  description:
    "Set up a recurring task you'll do on your own, e.g. a morning brief at 8:00 on weekdays (weather + calendar + news), a weekly GitHub digest, or an evening habit check-in. `instruction` is what you will do each time.",
  input: z.object({
    title: z.string().min(2).max(80).describe("Short name, e.g. 'Morning brief'"),
    instruction: z.string().min(5).max(1500).describe("What to do each time, in detail"),
    daily_time: z.string().regex(/^\d{1,2}:\d{2}$/).describe("HH:MM 24h, owner's local time"),
    days: z.array(z.number().int().min(0).max(6)).optional().describe("0=Sun..6=Sat; omit for every day"),
    deliver_on: deliverOn,
  }),
  connectorId: "reminders",
  capabilityId: "create_reminder",
  effect: "write",
  risk: "low",
  taints: false,
  ownerOnly: true,
  summarize: (a) => `Routine “${a.title}” at ${clockLabel(a.daily_time)}`,
  async run(args, ctx) {
    const tz = ctx.owner.timezone || "UTC";
    // Set up after reading an email or a page, the instruction may be someone else's: its runs stay careful (tick.ts).
    const schedule: Schedule = { type: "daily", time: args.daily_time.padStart(5, "0"), days: args.days, ...(ctx.tainted ? { outside: true } : {}) };
    if (!(await roomForAnother(ctx))) return { ok: false, error: FULL };
    const nextRunAt = computeNextRun(schedule, tz, ctx.now);
    if (!nextRunAt) return { ok: false, error: "That schedule never comes up." };
    const id = newId("sch");
    await ctx.db.insert(schema.schedules).values({
      id,
      botId: ctx.bot.id,
      kind: "routine",
      title: args.title,
      prompt: args.instruction,
      schedule,
      timezone: tz,
      deliverOn: args.deliver_on ?? "auto",
      nextRunAt,
    });
    const when = describeSchedule(schedule, tz);
    // Routines of accounts that haven't signed in wait for it (tick.ts): said now, not found out later.
    const waits = ctx.owner.emailVerifiedAt ? "" : " It starts running once they sign in with their email (it's free); until then it waits. Tell them so.";
    return { ok: true, content: `Routine “${args.title}” scheduled (${id}) — ${when}.${waits}`, summary: when, data: { id } };
  },
});

export const listReminders = defineTool({
  name: "list_reminders",
  title: "List reminders",
  description: "List the owner's active reminders and routines.",
  input: z.object({}),
  connectorId: "reminders",
  capabilityId: "read_reminders",
  effect: "read",
  risk: "low",
  taints: false,
  summarize: () => "List reminders",
  async run(_args, ctx) {
    const rows = await ctx.db
      .select()
      .from(schema.schedules)
      .where(and(eq(schema.schedules.botId, ctx.bot.id), eq(schema.schedules.active, true)))
      .orderBy(asc(schema.schedules.nextRunAt))
      .limit(50);
    if (!rows.length) return { ok: true, content: "No active reminders or routines.", summary: "None" };
    const lines = rows.map((r) => `- ${r.id} [${r.kind}] ${r.title} — ${describeSchedule(r.schedule, r.timezone)}`);
    return { ok: true, content: lines.join("\n"), summary: `${rows.length} active` };
  },
});

export const cancelReminder = defineTool({
  name: "cancel_reminder",
  title: "Cancel a reminder",
  description: "Cancel a reminder or routine by id (use list_reminders to find it).",
  input: z.object({ id: z.string().min(3) }),
  connectorId: "reminders",
  capabilityId: "cancel_reminder",
  effect: "write",
  risk: "low",
  taints: false,
  ownerOnly: true,
  summarize: (a) => `Cancel reminder ${a.id}`,
  async run(args, ctx) {
    const res = await ctx.db
      .update(schema.schedules)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(schema.schedules.id, args.id), eq(schema.schedules.botId, ctx.bot.id)))
      .returning({ id: schema.schedules.id, title: schema.schedules.title });
    if (!res.length) return { ok: false, error: "No reminder with that id." };
    return { ok: true, content: `Canceled “${res[0].title}”.`, summary: "Canceled" };
  },
});
