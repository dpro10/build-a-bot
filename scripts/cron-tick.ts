/**
 * Run due reminders and routines (what /api/cron/tick does), without HTTP.
 *   npm run cron:tick             run once
 *   npm run cron:tick -- --watch  keep running every 30 seconds (self-hosting without a cron)
 */
import { getDb } from "../src/lib/db";
import { housekeeping, runDueSchedules } from "../src/lib/scheduler/tick";

async function tick() {
  const db = await getDb();
  const result = await runDueSchedules(db);
  await housekeeping(db);
  return result;
}

async function main() {
  const watch = process.argv.includes("--watch");
  do {
    const started = Date.now();
    try {
      const result = await tick();
      console.log(`[${new Date().toISOString()}] tick ok in ${Date.now() - started} ms`, result);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] tick failed:`, err instanceof Error ? err.message : err);
      if (!watch) process.exit(1);
    }
    if (watch) await new Promise((r) => setTimeout(r, 30_000));
  } while (watch);
  process.exit(0);
}

void main();
