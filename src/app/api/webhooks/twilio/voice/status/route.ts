import { getDb } from "@/lib/db";
import { readTwilioForm, routeTwilio } from "@/lib/channels/twilio-inbound";
import { loadBotAndOwner } from "@/lib/channels/inbound";
import { recordUsage } from "@/lib/billing/usage";
import { UNIT_PRICES } from "@/lib/billing/prices";

/** Call ended: count its minutes, and charge them at Twilio's price (each started minute). */
export async function POST(req: Request) {
  const { params, valid } = await readTwilioForm(req);
  if (!valid) return new Response("bad signature", { status: 403 });
  if (params.CallStatus !== "completed") return new Response("ok");
  const db = await getDb();
  const ownerSide = params.Direction?.startsWith("outbound") ? params.To : params.From;
  const botSide = params.Direction?.startsWith("outbound") ? params.From : params.To;
  const routed = await routeTwilio(db, "voice", botSide ?? "", ownerSide ?? "");
  if (!routed) return new Response("ok");
  const loaded = await loadBotAndOwner(db, routed.channel.botId);
  const seconds = Math.max(0, Number(params.CallDuration ?? 0) || 0);
  if (loaded) await recordUsage(db, loaded.owner.id, { voiceSeconds: seconds, costMicros: Math.ceil(seconds / 60) * UNIT_PRICES.callMinute });
  return new Response("ok");
}
