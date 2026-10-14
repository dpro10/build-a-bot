import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";

type Ctx = RouteCtx<{ botId: string; memoryId: string }>;

export async function PATCH(req: Request, ctx: Ctx) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId, memoryId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ text: z.string().trim().min(2).max(300) }));
  if (!parsed.ok) return parsed.res;
  const [memory] = await a.db
    .update(schema.memories)
    .set({ text: parsed.data.text, source: "owner", updatedAt: new Date() })
    .where(and(eq(schema.memories.id, memoryId), eq(schema.memories.botId, botId)))
    .returning();
  return memory ? json({ memory }) : apiError(404, "Not found");
}

export async function DELETE(req: Request, ctx: Ctx) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId, memoryId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  await a.db.delete(schema.memories).where(and(eq(schema.memories.id, memoryId), eq(schema.memories.botId, botId)));
  return json({ ok: true });
}
