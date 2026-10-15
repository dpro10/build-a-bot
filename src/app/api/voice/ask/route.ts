import { z } from "zod";
import { apiError, limitOr429, parseJson } from "@/lib/api";
import { runTurn } from "@/lib/agent/run";
import { ensureConversation } from "@/lib/channels/outbound";
import { getOwnedBot } from "@/lib/data";
import { VOICE_DIRECTIVE } from "@/lib/dictation";
import { voiceAuth } from "@/lib/dictation/auth";
import { sseResponse } from "@/lib/sse";

export const maxDuration = 300;

const bodySchema = z.object({ botId: z.string().min(1).max(100), text: z.string().trim().min(1).max(4000) });

/**
 * "Hey Otto, …" from voice typing: the request goes to the bot's chat in the app, like a typed
 * message, and the turn streams back (Server-Sent Events, the same events as the chat).
 */
export async function POST(req: Request) {
  const a = await voiceAuth(req, { write: true });
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, bodySchema);
  if (!parsed.ok) return parsed.res;
  const bot = await getOwnedBot(a.db, a.owner.id, parsed.data.botId);
  if (!bot) return apiError(404, "Bot not found");
  const limited = await limitOr429(a.db, `chat:${a.owner.id}`, 30, 60, "That's a lot of messages at once — give it a moment.");
  if (limited) return limited;
  const conversation = await ensureConversation(a.db, bot.id, "web", "owner");
  return sseResponse(async (send, signal) => {
    await runTurn({
      db: a.db,
      bot,
      owner: a.owner,
      conversation,
      channelKind: "web",
      message: { text: parsed.data.text, author: "owner", meta: { via: "voice" } },
      directive: VOICE_DIRECTIVE,
      emit: send,
      signal,
    });
  }, req.signal);
}
