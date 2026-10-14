import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { handleInbound, loadBotAndOwner } from "@/lib/channels/inbound";
import { answerTwiml, gather, readTwilioForm, say, twiml } from "@/lib/channels/twilio-inbound";
import { escapeXml } from "@/lib/channels/twilio";
import { newId, sleep } from "@/lib/utils";

export const maxDuration = 300;

const BYE = /^(bye|goodbye|good bye|that's all|that is all|thanks,? bye|hang up|no thanks?)\b/i;

/** One spoken turn: transcript in → the bot thinks → spoken answer + listen again. */
export async function POST(req: Request) {
  const { params, valid } = await readTwilioForm(req);
  if (!valid) return new Response("bad signature", { status: 403 });
  const url = new URL(req.url);
  const channelId = url.searchParams.get("c") ?? "";
  const attempt = Number(url.searchParams.get("a") ?? 0);
  const db = await getDb();
  const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).limit(1);
  if (!channel) return twiml("<Hangup/>");
  const speech = (params.SpeechResult ?? "").trim();

  if (!speech) {
    if (attempt >= 2) return twiml(`${say("I'll let you go. Talk soon!")}<Hangup/>`);
    return twiml(gather(channelId, "Sorry, I didn't catch that. What can I do for you?", attempt + 1));
  }
  if (BYE.test(speech)) return twiml(`${say("Okay, bye!")}<Hangup/>`);

  const loaded = await loadBotAndOwner(db, channel.botId);
  if (!loaded) return twiml("<Hangup/>");
  const isOwner = channel.ownerAddress === params.From;
  const resultId = newId("vr");
  await db.insert(schema.asyncResults).values({ id: resultId, kind: "voice_turn", expiresAt: new Date(Date.now() + 10 * 60_000) });

  after(async () => {
    try {
      const out = await handleInbound({
        db,
        bot: loaded.bot,
        owner: loaded.owner,
        channel,
        kind: "voice",
        threadId: params.CallSid ?? params.From,
        replyTo: params.From,
        text: speech,
        isOwner,
        from: params.From,
        deliverReply: false,
        meta: { callSid: params.CallSid, confidence: params.Confidence },
      });
      await db.update(schema.asyncResults).set({ status: "done", result: { text: out.replyText, approvals: out.approvals.length } }).where(eq(schema.asyncResults.id, resultId));
    } catch (err) {
      await db.update(schema.asyncResults).set({ status: "error", result: { error: String(err) } }).where(eq(schema.asyncResults.id, resultId));
    }
  });

  // Answer within the call's patience: wait a few seconds, then keep them company and poll.
  for (let i = 0; i < 16; i++) {
    await sleep(500);
    const [row] = await db.select().from(schema.asyncResults).where(eq(schema.asyncResults.id, resultId)).limit(1);
    if (row && row.status !== "pending") return twiml(answerTwiml(channelId, row.result as { text?: string; approvals?: number; error?: string } | null));
  }
  const wait = `${appUrl()}/api/webhooks/twilio/voice/wait?c=${encodeURIComponent(channelId)}&r=${resultId}`;
  return twiml(`${say("One moment.")}<Pause length="2"/><Redirect method="POST">${escapeXml(wait)}</Redirect>`);
}
