import { and, eq, gt } from "drizzle-orm";
import { schema } from "@/lib/db";
import { authedBot, json, type RouteCtx } from "@/lib/api";
import { ensureConversation } from "@/lib/channels/outbound";
import { listMessages } from "@/lib/data";

/** Poll for new web messages (approval follow-ups, reminders, replies on other channels). */
export async function GET(req: Request, ctx: RouteCtx<{ botId: string }>) {
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const url = new URL(req.url);
  const afterParam = url.searchParams.get("after");
  const conversation = await ensureConversation(a.db, botId, "web", "owner");
  const after = afterParam ? new Date(afterParam) : undefined;
  const messages = await listMessages(a.db, conversation.id, { after: after && !Number.isNaN(after.getTime()) ? after : undefined, limit: 100 });
  const approvals = await a.db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.botId, botId), gt(schema.approvals.createdAt, new Date(Date.now() - 7 * 86400_000))));
  const [freshBot] = await a.db.select({ status: schema.bots.status }).from(schema.bots).where(eq(schema.bots.id, botId));
  return json({
    messages,
    approvals,
    botStatus: freshBot?.status ?? a.bot.status,
  });
}
