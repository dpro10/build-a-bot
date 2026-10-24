import { z } from "zod";
import { json } from "@/lib/api";
import { schema } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { addCredit, getCredit } from "@/lib/billing/credit";
import { voiceRequest } from "@/lib/calls/http";

/** The account the live call check (scripts/live-call.mjs) makes its call with. */
const CHECK_ACCOUNT = { id: "usr_live_call_check", email: "live-call-check@build-a-bot.site" };
const TOP_UP_BELOW = 1_000_000;
const TOP_UP_TO = 5_000_000;

/**
 * Signs the live call check in: calls need a signed-in account. Signed with the voice server's
 * secret (the check's workflow has it), and only ever as this one account, which owns nothing but
 * the bot each check makes and deletes. Its credit is topped up as the checks spend it.
 */
export async function POST(req: Request) {
  const r = await voiceRequest(req, z.object({ check: z.literal("live-call") }));
  if (!r.ok) return r.res;
  await r.db
    .insert(schema.users)
    .values({ id: CHECK_ACCOUNT.id, email: CHECK_ACCOUNT.email, name: "Live call check", emailVerifiedAt: new Date(), timezone: "America/Chicago" })
    .onConflictDoNothing();
  const { balanceMicros } = await getCredit(r.db, CHECK_ACCOUNT.id);
  if (balanceMicros < TOP_UP_BELOW) {
    await addCredit(r.db, { userId: CHECK_ACCOUNT.id, kind: "gift", amountMicros: TOP_UP_TO - balanceMicros, note: "For the live call checks" });
  }
  await createSession(r.db, CHECK_ACCOUNT.id);
  return json({ ok: true });
}
