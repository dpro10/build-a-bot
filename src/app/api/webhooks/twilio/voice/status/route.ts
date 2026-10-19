import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Call } from "@/lib/db/schema";
import { readTwilioForm } from "@/lib/channels/twilio-inbound";
import { loadBotAndOwner, seenBefore } from "@/lib/channels/inbound";
import { recordUsage } from "@/lib/billing/usage";
import { UNIT_PRICES } from "@/lib/billing/prices";

/** A minute of a kept call, by what was on the line: Twilio's own speech, or the voice server. */
function minutePrice(call: Call): number {
  // The simpler line, from the start or after the stream dropped.
  if (call.status === "line" || call.status === "failed") return UNIT_PRICES.callMinute;
  return call.direction === "outbound" ? UNIT_PRICES.callMinuteStreamOut : UNIT_PRICES.callMinuteStreamIn;
}

/**
 * Call ended: count its minutes, and charge them at Twilio's price (each started minute) to the
 * owner of the bot it was for. The call itself says which bot, never its phone numbers (on the
 * shared number those don't say whose bot it was): a call that came in was kept with its bot when
 * it was answered (by its CallSid), and a call a bot placed asked Twilio to report here with the bot
 * in the URL, which Twilio signs. A call the voice server answered pays Twilio's minute plus the
 * media stream, and no per-use speech fees (NVIDIA's models run on our server); one on the simpler
 * line pays for Twilio's speech too. A call no bot took (the phone isn't linked, the bot is paused or
 * out of credit) and one that read out a phone code aren't charged to anyone.
 */
export async function POST(req: Request) {
  const { params, valid } = await readTwilioForm(req);
  if (!valid) return new Response("bad signature", { status: 403 });
  if (params.CallStatus !== "completed" || !params.CallSid) return new Response("ok");
  const db = await getDb();
  // Twilio can report a call more than once: it's charged once.
  if (await seenBefore(db, "twilio-call-status", params.CallSid)) return new Response("ok");
  const seconds = Math.max(0, Number(params.CallDuration ?? 0) || 0);
  const minutes = Math.ceil(seconds / 60);
  const [call] = await db.select().from(schema.calls).where(eq(schema.calls.callSid, params.CallSid)).limit(1);
  if (call) {
    const cost = minutes * minutePrice(call);
    await recordUsage(db, call.ownerId, { voiceSeconds: seconds, costMicros: cost });
    await db
      .update(schema.calls)
      .set({
        costMicros: sql`${schema.calls.costMicros} + ${cost}`,
        durationS: sql`coalesce(${schema.calls.durationS}, ${seconds})`,
        endedAt: sql`coalesce(${schema.calls.endedAt}, now())`,
      })
      .where(eq(schema.calls.id, call.id));
    return new Response("ok");
  }
  // A call a bot placed (a reminder, "Call me"): it reads out a message on Twilio's voice.
  const botId = new URL(req.url).searchParams.get("b");
  const loaded = botId ? await loadBotAndOwner(db, botId) : null;
  if (loaded) await recordUsage(db, loaded.owner.id, { voiceSeconds: seconds, costMicros: minutes * UNIT_PRICES.callMinuteOut });
  return new Response("ok");
}
