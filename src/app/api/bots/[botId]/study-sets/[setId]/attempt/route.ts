import { z } from "zod";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { getStudySet, saveAttempt, studySetView } from "@/lib/library/study";

/** A finished quiz: its score and which questions were missed. */
export async function POST(req: Request, ctx: RouteCtx<{ botId: string; setId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId, setId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(
    req,
    z.object({ score: z.number().int().min(0).max(100), total: z.number().int().min(1).max(100), missed: z.array(z.string().max(60)).max(100) }),
  );
  if (!parsed.ok) return parsed.res;
  const set = await getStudySet(a.db, botId, setId);
  if (!set || set.kind !== "quiz") return apiError(404, "That quiz was deleted.");
  const saved = await saveAttempt(a.db, set, parsed.data);
  return json({ set: studySetView(saved) });
}
