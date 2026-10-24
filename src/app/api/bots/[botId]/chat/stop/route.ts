import { apiError, authedBot, json, sameOrigin, type RouteCtx } from "@/lib/api";
import { ensureConversation } from "@/lib/channels/outbound";
import { askToStop } from "@/lib/agent/stop";

/** The chat's Stop button: the answer being written stops where it is (stop.ts). */
export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const conversation = await ensureConversation(a.db, botId, "web", "owner");
  await askToStop(a.db, conversation.id);
  return json({ ok: true });
}
