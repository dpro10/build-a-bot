import { getDb } from "@/lib/db";
import { readTwilioForm, routeTwilio } from "@/lib/channels/twilio-inbound";
import { loadBotAndOwner } from "@/lib/channels/inbound";
import { recordUsage } from "@/lib/billing/usage";

/** Call ended: meter the minutes (plans include a monthly allowance). */
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
  if (loaded) await recordUsage(db, loaded.owner.id, { voiceSeconds: Number(params.CallDuration ?? 0) });
  return new Response("ok");
}
