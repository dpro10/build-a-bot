/**
 * The scheduler tick: runs due reminders and routines, and tidies up.
 * Called every minute by Vercel Cron (/api/cron/tick) or, locally, by the dev ticker.
 */
import { and, asc, eq, lte, lt, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import { computeNextRun } from "./time";
import { messageOwner, ensureConversation } from "@/lib/channels/outbound";
import type { ChannelKind } from "@/lib/channels/catalog";
import { runTurn, receipt } from "@/lib/agent/run";
import { truncate } from "@/lib/utils";

const PROACTIVE_TURNS_PER_DAY = 24;
/** Subscription brains: keep proactive use "ordinary, individual" (vendor terms). */
const PROACTIVE_TURNS_PER_DAY_SUBSCRIPTION = 10;

export async function runDueSchedules(db: Db, now = new Date(), limit = 25, only?: { scheduleId: string }) {
  const due = await db
    .select()
    .from(schema.schedules)
    .where(and(eq(schema.schedules.active, true), lte(schema.schedules.nextRunAt, now), only ? eq(schema.schedules.id, only.scheduleId) : undefined))
    .orderBy(asc(schema.schedules.nextRunAt))
    .limit(limit);

  let ran = 0;
  for (const s of due) {
    const next = computeNextRun(s.schedule, s.timezone, now);
    // Claim it: only one tick moves this schedule forward.
    const claimed = await db
      .update(schema.schedules)
      .set({ nextRunAt: next, active: next !== null, lastRunAt: now, runCount: sql`${schema.schedules.runCount} + 1`, updatedAt: now })
      .where(and(eq(schema.schedules.id, s.id), eq(schema.schedules.nextRunAt, s.nextRunAt!)))
      .returning({ id: schema.schedules.id });
    if (!claimed.length) continue;

    const [bot] = await db.select().from(schema.bots).where(eq(schema.bots.id, s.botId)).limit(1);
    if (!bot || bot.status === "paused") continue;
    const [owner] = await db.select().from(schema.users).where(eq(schema.users.id, bot.ownerId)).limit(1);
    if (!owner) continue;
    const channel = (s.deliverOn || "auto") as ChannelKind | "auto";

    try {
      if (s.kind === "reminder") {
        const { channel: used, result } = await messageOwner(db, bot, owner, `⏰ Reminder: ${s.prompt}`, { channel });
        await receipt(db, bot, "tool", result.status === "failed" ? "error" : "ok", `Reminder delivered via ${used}: ${truncate(s.prompt, 80)}`, {
          scheduleId: s.id,
          channel: used,
          status: result.status,
        });
      } else {
        // Routines are real agent turns; cap proactive turns per day.
        const since = new Date(now.getTime() - 24 * 3600_000);
        const [{ n }] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.receipts)
          .where(and(eq(schema.receipts.botId, bot.id), eq(schema.receipts.kind, "routine"), sql`${schema.receipts.createdAt} > ${since}`));
        const cap = bot.brain.kind === "subscription" ? PROACTIVE_TURNS_PER_DAY_SUBSCRIPTION : PROACTIVE_TURNS_PER_DAY;
        if (n >= cap) {
          await receipt(db, bot, "routine", "blocked", `Skipped “${s.title}”: daily proactive limit reached`, { scheduleId: s.id, cap });
          continue;
        }
        const conversation = await ensureConversation(db, bot.id, "web", "owner");
        const result = await runTurn({
          db,
          bot,
          owner,
          conversation,
          channelKind: "web",
          message: null,
          directive: `Run your scheduled routine “${s.title}” now: ${s.prompt}\nWrite the result as a message to the owner (it will be delivered${channel !== "auto" && channel !== "web" ? ` by ${channel}` : ""}). Keep it short and useful.`,
          trigger: s.kind === "reminder" ? "reminder" : "routine",
        });
        await receipt(db, bot, "routine", "ok", `Ran routine “${s.title}”`, { scheduleId: s.id });
        if (result.text && channel !== "web") {
          await messageOwner(db, bot, owner, result.text, { channel, alsoWeb: false, subject: s.title });
        }
      }
      ran++;
    } catch (err) {
      await receipt(db, bot, "system", "error", `Schedule “${s.title}” failed`, { scheduleId: s.id, error: String(err).slice(0, 300) });
    }
  }
  return { ran, due: due.length };
}

export async function housekeeping(db: Db, now = new Date()) {
  await db
    .update(schema.approvals)
    .set({ status: "expired" })
    .where(and(eq(schema.approvals.status, "pending"), lt(schema.approvals.expiresAt, now)));
  const weekAgo = new Date(now.getTime() - 7 * 86400_000);
  await db.delete(schema.oauthStates).where(lt(schema.oauthStates.expiresAt, now));
  await db.delete(schema.pairingCodes).where(lt(schema.pairingCodes.expiresAt, weekAgo));
  await db.delete(schema.asyncResults).where(lt(schema.asyncResults.expiresAt, now));
  await db.delete(schema.inboundEvents).where(lt(schema.inboundEvents.createdAt, weekAgo));
  await db
    .update(schema.bridgeJobs)
    .set({ status: "expired" })
    .where(and(eq(schema.bridgeJobs.status, "queued"), lt(schema.bridgeJobs.expiresAt, now)));
  // Meetings whose recorder vanished get wrapped up; notes that never finished get an honest ending.
  const { wrapUpStaleMeetings, rescueStuckNotes } = await import("@/lib/meetings/notes");
  await wrapUpStaleMeetings(db, now);
  await rescueStuckNotes(db, now);
}
