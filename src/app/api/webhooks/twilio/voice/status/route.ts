import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { readTwilioForm, routeTwilio } from "@/lib/channels/twilio-inbound";
import { loadBotAndOwner } from "@/lib/channels/inbound";
import { recordUsage } from "@/lib/billing/usage";
import { UNIT_PRICES } from "@/lib/billing/prices";

/**
 * Call ended: count its minutes, and charge them at Twilio's price (each started minute). A call
 * the voice server answered pays Twilio's minute plus the media stream, and no per-use speech fees
 * (NVIDIA's models run on our server); one on the simpler line pays for Twilio's speech too.
 */
export async function POST(req: Request) {
  const { params, valid } = await readTwilioForm(req);
  if (!valid) return new Response("bad signature", { status: 403 });
  if (params.CallStatus !== "completed") return new Response("ok");
  const db = await getDb();
  const seconds = Math.max(0, Number(params.CallDuration ?? 0) || 0);
  const minutes = Math.ceil(seconds / 60);
  const [streamed] = params.CallSid ? await db.select().from(schema.calls).where(eq(schema.calls.callSid, params.CallSid)).limit(1) : [];
  if (streamed && (streamed.status === "ended" || streamed.status === "active")) {
    const cost = minutes * (streamed.direction === "outbound" ? UNIT_PRICES.callMinuteStreamOut : UNIT_PRICES.callMinuteStreamIn);
    await recordUsage(db, streamed.ownerId, { voiceSeconds: seconds, costMicros: cost });
    await db.update(schema.calls).set({ costMicros: sql`${schema.calls.costMicros} + ${cost}` }).where(eq(schema.calls.id, streamed.id));
    return new Response("ok");
  }
  const ownerSide = params.Direction?.startsWith("outbound") ? params.To : params.From;
  const botSide = params.Direction?.startsWith("outbound") ? params.From : params.To;
  const routed = await routeTwilio(db, "voice", botSide ?? "", ownerSide ?? "");
  if (!routed) return new Response("ok");
  const loaded = await loadBotAndOwner(db, routed.channel.botId);
  if (loaded) await recordUsage(db, loaded.owner.id, { voiceSeconds: seconds, costMicros: minutes * UNIT_PRICES.callMinute });
  return new Response("ok");
}
