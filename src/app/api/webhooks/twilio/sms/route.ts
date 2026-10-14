import { after } from "next/server";
import { getDb } from "@/lib/db";
import { handleInbound, loadBotAndOwner, seenBefore } from "@/lib/channels/inbound";
import { readTwilioForm, routeTwilio, twiml } from "@/lib/channels/twilio-inbound";
import { recordUsage } from "@/lib/billing/usage";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { params, valid } = await readTwilioForm(req);
  if (!valid) return new Response("bad signature", { status: 403 });
  const db = await getDb();
  if (await seenBefore(db, "twilio-sms", params.MessageSid)) return twiml("");
  const routed = await routeTwilio(db, "sms", params.To ?? "", params.From ?? "", params.Body ?? "");
  if (!routed) return twiml(""); // unknown sender on a shared number: stay silent

  after(async () => {
    const loaded = await loadBotAndOwner(db, routed.channel.botId);
    if (!loaded) return;
    const isOwner = routed.channel.ownerAddress === params.From;
    await recordUsage(db, loaded.owner.id, { smsSegments: Number(params.NumSegments ?? 1) });
    await handleInbound({
      db,
      bot: loaded.bot,
      owner: loaded.owner,
      channel: routed.channel,
      kind: "sms",
      threadId: params.From,
      replyTo: params.From,
      text: (routed.text ?? params.Body ?? "").trim() || "(empty message)",
      isOwner,
      from: params.From,
      meta: { messageSid: params.MessageSid },
    });
  });
  return twiml("");
}
