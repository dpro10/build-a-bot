import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authedBot, sameOrigin, type RouteCtx } from "@/lib/api";
import { runTurn } from "@/lib/agent/run";
import { greetingDirective } from "@/lib/agent/prompt";
import { ensureConversation } from "@/lib/channels/outbound";
import { connectionName, getConnector } from "@/lib/connectors";
import { JOB_BY_ID } from "@/lib/jobs";
import { sseResponse } from "@/lib/sse";

export const maxDuration = 120;

/** The bot's very first message (it talks first). Idempotent: only if the chat is empty. */
export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const conversation = await ensureConversation(a.db, botId, "web", "owner");
  const existing = await a.db.select({ id: schema.messages.id }).from(schema.messages).where(eq(schema.messages.conversationId, conversation.id)).limit(1);
  if (existing.length) return apiError(409, "Already greeted");

  const connections = await a.db.select().from(schema.connections).where(eq(schema.connections.botId, botId));
  const appNames = connections
    .filter((c) => {
      const d = getConnector(c.connectorId);
      return Boolean(d && !d.via.some((v) => v.kind === "builtin"));
    })
    .map(connectionName);
  const starters = (a.bot.jobs ?? []).flatMap((j) => JOB_BY_ID[j as keyof typeof JOB_BY_ID]?.starters ?? []);

  return sseResponse(async (send, signal) => {
    await runTurn({
      db: a.db,
      bot: a.bot,
      owner: a.user,
      conversation,
      channelKind: "web",
      message: null,
      directive: greetingDirective(a.bot, a.user, "web", starters, appNames),
      trigger: "greeting",
      noTools: true,
      emit: send,
      signal,
    });
  }, req.signal);
}
