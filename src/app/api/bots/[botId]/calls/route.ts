import { apiError, authedBot, ipKey, json, limitOr429, sameOrigin, type RouteCtx } from "@/lib/api";
import { listCalls, startCall, voiceServer, voiceServerUp } from "@/lib/calls";
import { checkSpend } from "@/lib/billing/usage";

/**
 * Start a call with the bot from the app: a call row and a short-lived token the browser hands to
 * the voice server, which hears and speaks with NVIDIA's open models (Parakeet, Magpie) while
 * Nemotron holds the conversation.
 */
export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  if (!voiceServer()) return apiError(503, "Calls aren't set up on this server yet.", { code: "calls_unavailable" });
  if (a.bot.status === "paused") return apiError(409, `${a.bot.name} is paused. Resume it to call.`, { code: "paused" });
  // The voice server takes a couple of calls at a time, for everyone: nobody gets to keep it busy.
  const limited =
    (await limitOr429(a.db, `call-start:${a.user.id}`, 20, 3600, "That's a lot of calls in an hour. Try again a bit later.")) ??
    (await limitOr429(a.db, ipKey("call-start", req), 40, 3600, "That's a lot of calls from here in an hour. Try again a bit later."));
  if (limited) return limited;
  const spend = await checkSpend(a.db, a.user, "call");
  if (!spend.ok) return apiError(402, spend.message, { code: spend.code });
  if (!(await voiceServerUp())) return apiError(503, "The voice line is down right now. Try again in a minute.", { code: "voice_down" });
  const started = await startCall(a.db, { bot: a.bot, kind: "web", speaker: "owner", from: "app" });
  if (!started) return apiError(503, "Couldn't start the call. Try again.", { code: "start_failed" });
  return json({ callId: started.call.id, token: started.token, wsUrl: started.wsUrl });
}

/** Recent calls with the bot. */
export async function GET(_req: Request, ctx: RouteCtx<{ botId: string }>) {
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  return json({ calls: await listCalls(a.db, botId), available: Boolean(voiceServer()) });
}
