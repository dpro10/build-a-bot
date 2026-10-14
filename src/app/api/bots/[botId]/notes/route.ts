import { z } from "zod";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { listNotes } from "@/lib/data";
import { newId } from "@/lib/utils";

export async function GET(_req: Request, ctx: RouteCtx<{ botId: string }>) {
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  return json({ notes: await listNotes(a.db, botId) });
}

export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ title: z.string().trim().min(1).max(120), body: z.string().max(8000).default("") }));
  if (!parsed.ok) return parsed.res;
  const [note] = await a.db
    .insert(schema.notes)
    .values({ id: newId("note"), botId, title: parsed.data.title, body: parsed.data.body })
    .onConflictDoNothing()
    .returning();
  return note ? json({ note }) : apiError(409, "A note with that title already exists.");
}
