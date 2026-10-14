import { and, eq, gt, inArray } from "drizzle-orm";
import { schema } from "@/lib/db";
import { authedBot, json, type RouteCtx } from "@/lib/api";
import { ensureConversation } from "@/lib/channels/outbound";
import { listMessages } from "@/lib/data";

/** Poll for new web messages (bridge replies, approval follow-ups, reminders). */
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
  const pendingJobs = await a.db
    .select({ id: schema.bridgeJobs.id, status: schema.bridgeJobs.status })
    .from(schema.bridgeJobs)
    .where(and(eq(schema.bridgeJobs.botId, botId), inArray(schema.bridgeJobs.status, ["queued", "running"])));
  return json({
    messages,
    approvals,
    botStatus: freshBot?.status ?? a.bot.status,
    // Running: the owner's computer is thinking. Queued: waiting for that computer to pick it up.
    thinkingOnBridge: pendingJobs.some((j) => j.status === "running"),
    waitingOnBridge: pendingJobs.some((j) => j.status === "queued"),
  });
}
