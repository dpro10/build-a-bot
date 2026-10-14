import { authedBot, json, type RouteCtx } from "@/lib/api";
import { listContacts } from "@/lib/data";

export async function GET(_req: Request, ctx: RouteCtx<{ botId: string }>) {
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  return json({ contacts: await listContacts(a.db, botId) });
}
