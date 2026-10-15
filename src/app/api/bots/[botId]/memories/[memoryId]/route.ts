import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { containsSecret } from "@/lib/policy/engine";
import { MAX_PINNED } from "@/lib/memory";

type Ctx = RouteCtx<{ botId: string; memoryId: string }>;

export async function PATCH(req: Request, ctx: Ctx) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId, memoryId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(
    req,
    z.object({ text: z.string().trim().min(2).max(300).optional(), pinned: z.boolean().optional() }).refine((b) => b.text !== undefined || b.pinned !== undefined, "Nothing to change"),
  );
  if (!parsed.ok) return parsed.res;
  const { text, pinned } = parsed.data;
  if (text !== undefined && containsSecret(text)) return apiError(422, "That looks like a password or key. Don't store secrets in memory.");
  if (pinned) {
    const count = await a.db.$count(schema.memories, and(eq(schema.memories.botId, botId), eq(schema.memories.pinned, true), ne(schema.memories.id, memoryId)));
    if (count >= MAX_PINNED) return apiError(409, `You can pin up to ${MAX_PINNED}. Unpin one first.`);
  }
  const [memory] = await a.db
    .update(schema.memories)
    .set({ ...(text !== undefined ? { text, source: "owner", updatedAt: new Date() } : {}), ...(pinned !== undefined ? { pinned } : {}) })
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
