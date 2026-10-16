import { getDb } from "@/lib/db";
import { appUrl, config } from "@/lib/env";
import { loadBotAndOwner } from "@/lib/channels/inbound";
import { gather, readTwilioForm, routeTwilio, say, twiml } from "@/lib/channels/twilio-inbound";
import { escapeXml } from "@/lib/channels/twilio";
import { ownerName } from "@/lib/agent/prompt";
import { checkSpend } from "@/lib/billing/usage";
import { phoneSpeaker, startCall, voiceServerUp } from "@/lib/calls";

/**
 * Incoming call. With the voice server up (and Twilio Media Streams allowed on the account), the
 * call streams to it: NVIDIA Parakeet hears, Nemotron talks, Magpie speaks, and the bot's agent
 * does the work. If the stream ever drops, Twilio carries on at the <Redirect> on the simpler line.
 * Otherwise the simpler line answers: Twilio's own speech recognition and voice, a turn at a time.
 *
 * Only the owner's number with the carrier's full STIR/SHAKEN attestation is greeted by name and
 * trusted; the owner's number without it can prove itself with a PIN (on the voice server).
 */
export async function POST(req: Request) {
  const { params, valid } = await readTwilioForm(req);
  if (!valid) return new Response("bad signature", { status: 403 });
  const db = await getDb();
  const routed = await routeTwilio(db, "voice", params.To ?? "", params.From ?? "");
  if (!routed) return twiml(`${say("Sorry, this number can't take your call.")}<Hangup/>`);
  const loaded = await loadBotAndOwner(db, routed.channel.botId);
  if (!loaded) return twiml("<Hangup/>");
  const { bot, owner } = loaded;
  if (bot.status === "paused") {
    return twiml(`${say(`Hi, it's ${bot.name}. I'm paused right now. Text START to wake me up. Bye!`)}<Hangup/>`);
  }
  const speaker = phoneSpeaker(routed.channel.ownerAddress, params.From, params.StirVerstat);
  const spend = await checkSpend(db, owner, "call");
  if (!spend.ok) {
    return twiml(`${say(speaker === "owner" ? spend.message : `Hi, it's ${bot.name}. I can't take calls right now. Please try again later.`)}<Hangup/>`);
  }

  if (config.twilio.mediaStreams && (await voiceServerUp())) {
    const started = await startCall(db, { bot, kind: "phone", speaker, from: params.From, to: params.To, callSid: params.CallSid });
    if (started) {
      const fallback = `${appUrl()}/api/webhooks/twilio/voice/fallback?c=${encodeURIComponent(routed.channel.id)}&call=${encodeURIComponent(started.call.id)}`;
      return twiml(
        `<Connect><Stream url="${escapeXml(started.wsUrl)}"><Parameter name="token" value="${escapeXml(started.token)}"/></Stream></Connect>` +
          `<Redirect method="POST">${escapeXml(fallback)}</Redirect>`,
      );
    }
  }

  const tier = speaker === "owner" ? "owner" : "contact";
  const greeting =
    speaker === "owner"
      ? `Hi ${ownerName(owner).split(" ")[0]}, it's ${bot.name}, your AI assistant. What can I do for you?`
      : `Hi, you've reached ${bot.name}, an AI assistant. I can take a message.`;
  return twiml(`${gather(routed.channel.id, greeting, 0, tier)}${say("I didn't hear anything. Call back anytime!")}<Hangup/>`);
}
