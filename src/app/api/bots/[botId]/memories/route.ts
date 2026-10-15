import { z } from "zod";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { listMemories } from "@/lib/data";
import { containsSecret } from "@/lib/policy/engine";
import { newId } from "@/lib/utils";
import { MAX_MEMORIES, findSameFact, loadMemories } from "@/lib/memory";

export async function GET(_req: Request, ctx: RouteCtx<{ botId: string }>) {
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  return json({ memories: await listMemories(a.db, botId) });
}

export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ text: z.string().trim().min(2).max(300) }));
  if (!parsed.ok) return parsed.res;
  if (containsSecret(parsed.data.text)) return apiError(422, "That looks like a password or key. Don't store secrets in memory.");
  const existing = await loadMemories(a.db, botId);
  const same = findSameFact(existing, parsed.data.text);
  if (same && same.relation !== "more") return json({ memory: null, already: same.row.text });
  if (existing.length >= MAX_MEMORIES) return apiError(409, `${a.bot.name} remembers ${MAX_MEMORIES.toLocaleString("en-US")} things already. Delete some to make room.`);
  const [memory] = await a.db.insert(schema.memories).values({ id: newId("mem"), botId, text: parsed.data.text, source: "owner" }).returning();
  return json({ memory });
}
