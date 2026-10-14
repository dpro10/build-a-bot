import { z } from "zod";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { setPaused } from "@/lib/agent/run";

export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ paused: z.boolean() }));
  if (!parsed.ok) return parsed.res;
  await setPaused(a.db, a.bot, parsed.data.paused, parsed.data.paused ? "STOP from the app" : "Resumed in the app");
  return json({ status: parsed.data.paused ? "paused" : "active" });
}
