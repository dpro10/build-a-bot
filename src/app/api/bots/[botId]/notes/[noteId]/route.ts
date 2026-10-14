import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";

type Ctx = RouteCtx<{ botId: string; noteId: string }>;

export async function PATCH(req: Request, ctx: Ctx) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId, noteId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ title: z.string().trim().min(1).max(120).optional(), body: z.string().max(8000).optional() }));
  if (!parsed.ok) return parsed.res;
  const [note] = await a.db
    .update(schema.notes)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(schema.notes.id, noteId), eq(schema.notes.botId, botId)))
    .returning();
  return note ? json({ note }) : apiError(404, "Not found");
}

export async function DELETE(req: Request, ctx: Ctx) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId, noteId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  await a.db.delete(schema.notes).where(and(eq(schema.notes.id, noteId), eq(schema.notes.botId, botId)));
  return json({ ok: true });
}
