/**
 * Local/demo ticker so reminders and routines fire without an external cron.
 * On Vercel, /api/cron/tick is called by Vercel Cron instead (vercel.json).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.VERCEL || process.env.DISABLE_INTERNAL_CRON === "1") return;
  const g = globalThis as unknown as { __babTicker?: NodeJS.Timeout };
  if (g.__babTicker) return;
  const { getDb } = await import("./lib/db");
  const { runDueSchedules, housekeeping } = await import("./lib/scheduler/tick");
  let busy = false;
  g.__babTicker = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const db = await getDb();
      await runDueSchedules(db);
      await housekeeping(db);
    } catch (err) {
      console.error("[ticker]", err);
    } finally {
      busy = false;
    }
  }, 20_000);
  g.__babTicker.unref?.();
}
