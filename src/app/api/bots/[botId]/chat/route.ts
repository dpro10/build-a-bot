import { z } from "zod";
import { apiError, authedBot, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { runTurn } from "@/lib/agent/run";
import { ensureConversation } from "@/lib/channels/outbound";
import { sseResponse } from "@/lib/sse";

export const maxDuration = 300;

const bodySchema = z.object({ text: z.string().trim().min(1).max(8000) });

export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, bodySchema);
  if (!parsed.ok) return parsed.res;
  const conversation = await ensureConversation(a.db, botId, "web", "owner");
  return sseResponse(async (send, signal) => {
    await runTurn({
      db: a.db,
      bot: a.bot,
      owner: a.user,
      conversation,
      channelKind: "web",
      message: { text: parsed.data.text, author: "owner" },
      emit: send,
      signal,
    });
  }, req.signal);
}
