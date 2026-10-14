import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, sameOrigin, type RouteCtx } from "@/lib/api";

/** Forget an approved contact: the next message to them needs approval again. */
export async function DELETE(req: Request, ctx: RouteCtx<{ botId: string; contactId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId, contactId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  await a.db.delete(schema.contacts).where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.botId, botId)));
  return json({ ok: true });
}
