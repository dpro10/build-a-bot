/**
 * The scheduler tick: runs due reminders and routines, and tidies up.
 * Called every minute by Vercel Cron (/api/cron/tick) or, locally, by the dev ticker.
 */
import { and, asc, eq, isNotNull, lte, lt, ne, or, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import { computeNextRun } from "./time";
import { messageOwner, ensureConversation } from "@/lib/channels/outbound";
import type { ChannelKind } from "@/lib/channels/catalog";
import { runTurn, receipt } from "@/lib/agent/run";
import { truncate } from "@/lib/utils";

const PROACTIVE_TURNS_PER_DAY = 24;
/** A routine is a whole agent turn; one that runs longer is stopped and counts as not finished. */
const ROUTINE_TIMEOUT_MS = 90_000;
/** After this the tick starts nothing new (what's left runs next minute), so it ends well inside the function's 300 seconds. */
const TICK_BUDGET_MS = 180_000;
/** Reminders only deliver a line, so a minute takes many more of them than of routines. */
const REMINDERS_PER_TICK = 200;

/**
 * How one run went, so "Run now" can say so: ok, failed (the brain or the delivery had a
 * problem), skipped (today's proactive limit), or paused (STOP).
 */
export type ScheduleOutcome = "ok" | "failed" | "skipped" | "paused";

export async function runDueSchedules(db: Db, now = new Date(), limit = 25, only?: { scheduleId: string }) {
  const started = Date.now();
  const dueOf = (kind: "reminder" | "routine", max: number) =>
    db
      .select({ s: schema.schedules })
      .from(schema.schedules)
      .innerJoin(schema.bots, eq(schema.bots.id, schema.schedules.botId))
      .innerJoin(schema.users, eq(schema.users.id, schema.bots.ownerId))
      .where(
        and(
          eq(schema.schedules.active, true),
          lte(schema.schedules.nextRunAt, now),
          eq(schema.schedules.kind, kind),
          // A routine is a turn paid from credit, which opens up with an email: an account that
          // hasn't signed in keeps its routines for when it does (an abandoned one never runs them).
          kind === "routine" ? isNotNull(schema.users.emailVerifiedAt) : undefined,
          only ? eq(schema.schedules.id, only.scheduleId) : undefined,
        ),
      )
      .orderBy(asc(schema.schedules.nextRunAt))
      .limit(max);
  const due = [...(await dueOf("reminder", only ? limit : Math.max(limit, REMINDERS_PER_TICK))), ...(await dueOf("routine", limit))].map((r) => r.s);

  let ran = 0;
  const runs: { scheduleId: string; outcome: ScheduleOutcome }[] = [];
  for (const s of due) {
    if (Date.now() - started > TICK_BUDGET_MS) break;
    const next = computeNextRun(s.schedule, s.timezone, now);
    // Claim it: only one tick moves this schedule forward, and one turned off (or cancelled) since
    // the list was read stays off.
    const claimed = await db
      .update(schema.schedules)
      .set({ nextRunAt: next, active: next !== null, lastRunAt: now, runCount: sql`${schema.schedules.runCount} + 1`, updatedAt: now })
      .where(and(eq(schema.schedules.id, s.id), eq(schema.schedules.active, true), eq(schema.schedules.nextRunAt, s.nextRunAt!)))
      .returning({ id: schema.schedules.id });
    if (!claimed.length) continue;

    const [bot] = await db.select().from(schema.bots).where(eq(schema.bots.id, s.botId)).limit(1);
    if (!bot) continue;
    if (bot.status === "paused") {
      // STOP holds, but a reminder the owner set doesn't vanish without a word.
      if (s.kind === "reminder") await receipt(db, bot, "tool", "blocked", `Reminder not sent (paused): ${truncate(s.prompt, 80)}`, { scheduleId: s.id });
      runs.push({ scheduleId: s.id, outcome: "paused" });
      continue;
    }
    const [owner] = await db.select().from(schema.users).where(eq(schema.users.id, bot.ownerId)).limit(1);
    if (!owner) continue;
    const channel = (s.deliverOn || "auto") as ChannelKind | "auto";

    try {
      if (s.kind === "reminder") {
        const { channel: used, result } = await messageOwner(db, bot, owner, `⏰ Reminder: ${s.prompt}`, { channel });
        // Asked for a channel the owner hasn't linked: it went to the web chat, and the receipt says so.
        const wanted = channel !== "auto" && channel !== "web" ? channel : null;
        const where =
          result.status === "failed"
            ? `Reminder couldn't be sent by ${used}`
            : wanted && used !== wanted
              ? `Reminder put in the web chat (no ${wanted} linked)`
              : `Reminder delivered via ${used}`;
        await receipt(db, bot, "tool", result.status === "failed" ? "error" : "ok", `${where}: ${truncate(s.prompt, 80)}`, {
          scheduleId: s.id,
          channel: used,
          status: result.status,
        });
        runs.push({ scheduleId: s.id, outcome: result.status === "failed" ? "failed" : "ok" });
      } else {
        // Routines are real agent turns; cap proactive turns per day (runs, not the notes of skipped ones).
        const since = new Date(now.getTime() - 24 * 3600_000);
        const [{ n }] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.receipts)
          .where(
            and(
              eq(schema.receipts.botId, bot.id),
              eq(schema.receipts.kind, "routine"),
              ne(schema.receipts.status, "blocked"),
              sql`${schema.receipts.createdAt} > ${since}`,
            ),
          );
        const cap = PROACTIVE_TURNS_PER_DAY;
        if (n >= cap) {
          await receipt(db, bot, "routine", "blocked", `Skipped “${s.title}”: daily proactive limit reached`, { scheduleId: s.id, cap });
          runs.push({ scheduleId: s.id, outcome: "skipped" });
          continue;
        }
        const conversation = await ensureConversation(db, bot.id, "web", "owner");
        const signal = AbortSignal.timeout(ROUTINE_TIMEOUT_MS);
        const result = await runTurn({
          db,
          bot,
          owner,
          conversation,
          channelKind: "web",
          message: null,
          directive: `Run your scheduled routine “${s.title}” now: ${s.prompt}\nWrite the result as a message to the owner (it will be delivered${channel !== "auto" && channel !== "web" ? ` by ${channel}` : ""}). Keep it short and useful.`,
          trigger: s.kind === "reminder" ? "reminder" : "routine",
          // Set up in a turn that had read an email or a page: its instruction may be someone else's.
          startTainted: s.schedule.outside === true,
          signal,
        });
        // No answer (the brain failed, isn't set up, hit today's ceiling, or ran out of time): the chat already says why.
        const failed = result.status !== "ok" || signal.aborted;
        await receipt(
          db,
          bot,
          "routine",
          failed ? "error" : "ok",
          failed ? `Routine “${s.title}” didn't finish` : `Ran routine “${s.title}”`,
          failed ? { scheduleId: s.id, error: truncate(result.text, 300) } : { scheduleId: s.id },
        );
        if (result.text && channel !== "web") {
          // The turn already put its reply in the web chat: deliver it elsewhere, never a second copy there.
          await messageOwner(db, bot, owner, result.text, { channel, alsoWeb: false, inWebAlready: Boolean(result.messageId), subject: s.title });
        }
        runs.push({ scheduleId: s.id, outcome: failed ? "failed" : "ok" });
      }
      ran++;
    } catch (err) {
      await receipt(db, bot, "system", "error", `Schedule “${s.title}” failed`, { scheduleId: s.id, error: String(err).slice(0, 300) });
      runs.push({ scheduleId: s.id, outcome: "failed" });
    }
  }
  return { ran, due: due.length, runs };
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
  // Meetings whose recorder vanished get wrapped up; notes that never finished get an honest ending.
  const { wrapUpStaleMeetings, rescueStuckNotes } = await import("@/lib/meetings/notes");
  await wrapUpStaleMeetings(db, now);
  await rescueStuckNotes(db, now);
  // Transcripts past each bot's retention setting (90 days by default) go; the notes stay.
  const { expireTranscripts } = await import("@/lib/meetings");
  await expireTranscripts(db, now);
  // Telegram's manager webhook and Discord's commands follow their keys (and the domain).
  const { selfSetup } = await import("@/lib/channels/self-setup");
  await selfSetup(db).catch((err) => console.warn("[setup]", (err as Error).message));
  // Out of demo mode, apps and channels simulated in it need a real setup.
  const { leaveDemoMode } = await import("@/lib/bots/demo-leftovers");
  await leaveDemoMode(db).catch((err) => console.warn("[demo]", (err as Error).message));
}
