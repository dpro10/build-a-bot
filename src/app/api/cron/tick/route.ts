import { getDb } from "@/lib/db";
import { config, isProduction } from "@/lib/env";
import { timingSafeEqualStr } from "@/lib/crypto";
import { housekeeping, runDueSchedules } from "@/lib/scheduler/tick";

export const maxDuration = 300;

/** Vercel Cron (or any external pinger) calls this every minute with the CRON_SECRET. */
export async function GET(req: Request) {
  const secret = config.cronSecret;
  const auth = req.headers.get("authorization") ?? "";
  if (secret ? !timingSafeEqualStr(auth, `Bearer ${secret}`) : isProduction) return new Response("unauthorized", { status: 401 });
  const db = await getDb();
  const result = await runDueSchedules(db);
  await housekeeping(db);
  return Response.json({ ok: true, ...result });
}
