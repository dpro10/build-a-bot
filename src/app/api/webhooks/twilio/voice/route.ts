import { getDb } from "@/lib/db";
import { loadBotAndOwner } from "@/lib/channels/inbound";
import { gather, readTwilioForm, routeTwilio, say, twiml } from "@/lib/channels/twilio-inbound";
import { ownerName } from "@/lib/agent/prompt";

/** Incoming call: greet (with AI disclosure) and start listening. */
export async function POST(req: Request) {
  const { params, valid } = await readTwilioForm(req);
  if (!valid) return new Response("bad signature", { status: 403 });
  const db = await getDb();
  const routed = await routeTwilio(db, "voice", params.To ?? "", params.From ?? "");
  if (!routed) return twiml(`${say("Sorry, this number can't take your call.")}<Hangup/>`);
  const loaded = await loadBotAndOwner(db, routed.channel.botId);
  if (!loaded) return twiml("<Hangup/>");
  if (loaded.bot.status === "paused") {
    return twiml(`${say(`Hi, it's ${loaded.bot.name}. I'm paused right now. Text START to wake me up. Bye!`)}<Hangup/>`);
  }
  const greeting = `Hi ${ownerName(loaded.owner).split(" ")[0]}, it's ${loaded.bot.name}, your AI assistant. What can I do for you?`;
  return twiml(`${gather(routed.channel.id, greeting)}${say("I didn't hear anything. Call back anytime!")}<Hangup/>`);
}
