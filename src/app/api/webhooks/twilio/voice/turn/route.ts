import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { handleInbound, loadBotAndOwner } from "@/lib/channels/inbound";
import { postToWebInbox } from "@/lib/channels/outbound";
import { MAX_CALL_MINUTES } from "@/lib/calls";
import { answerTwiml, gather, readTwilioForm, say, tierParam, twiml } from "@/lib/channels/twilio-inbound";
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
  const tier = tierParam(url);
  const db = await getDb();
  const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).limit(1);
  if (!channel) return twiml("<Hangup/>");
  const speech = (params.SpeechResult ?? "").trim();

  if (!speech) {
    if (attempt >= 2) return twiml(`${say("I'll let you go. Talk soon!")}<Hangup/>`);
    return twiml(gather(channelId, "Sorry, I didn't catch that. What can I do for you?", attempt + 1, tier));
  }
  if (BYE.test(speech)) return twiml(`${say("Okay, bye!")}<Hangup/>`);
  // The simpler line keeps to the same length as any call.
  if (params.CallSid) {
    const [call] = await db.select({ createdAt: schema.calls.createdAt }).from(schema.calls).where(eq(schema.calls.callSid, params.CallSid)).limit(1);
    if (call && Date.now() - call.createdAt.getTime() > MAX_CALL_MINUTES.phone * 60_000) {
      return twiml(`${say("We've been talking a while, so I'll let you go. Call back anytime. Bye!")}<Hangup/>`);
    }
  }

  const loaded = await loadBotAndOwner(db, channel.botId);
  if (!loaded) return twiml("<Hangup/>");
  // The owner's number, and the carrier vouched for it when the call came in (see voice/route.ts).
  const isOwner = tier === "owner" && channel.ownerAddress === params.From;
  const resultId = newId("vr");
  await db.insert(schema.asyncResults).values({ id: resultId, kind: "voice_turn", expiresAt: new Date(Date.now() + 10 * 60_000) });

  // Start thinking now and let after() keep it alive past the response: a callback given to
  // after() would only start once the answer below had gone out, so the wait could never end early.
  const work = (async () => {
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
      const [row] = await db
        .update(schema.asyncResults)
        .set({ status: "done", result: { text: out.replyText, approvals: out.approvals.length } })
        .where(eq(schema.asyncResults.id, resultId))
        .returning({ polls: schema.asyncResults.polls });
      // The owner was told the answer would be in their chat (wait/route.ts): it is.
      if (isOwner && (row?.polls ?? 0) >= 6 && out.replyText) await postToWebInbox(db, loaded.bot, `From your call: ${out.replyText}`);
    } catch (err) {
      await db.update(schema.asyncResults).set({ status: "error", result: { error: String(err) } }).where(eq(schema.asyncResults.id, resultId));
    }
  })();
  after(work);

  // Answer within the call's patience: wait a few seconds, then keep them company and poll.
  for (let i = 0; i < 16; i++) {
    await sleep(500);
    const [row] = await db.select().from(schema.asyncResults).where(eq(schema.asyncResults.id, resultId)).limit(1);
    if (row && row.status !== "pending") return twiml(answerTwiml(channelId, row.result as { text?: string; approvals?: number; error?: string } | null, tier));
  }
  const wait = `${appUrl()}/api/webhooks/twilio/voice/wait?c=${encodeURIComponent(channelId)}&r=${resultId}&t=${tier}`;
  return twiml(`${say("One moment.")}<Pause length="2"/><Redirect method="POST">${escapeXml(wait)}</Redirect>`);
}
