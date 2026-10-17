import { z } from "zod";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { getStudySet, saveReview, studySetView } from "@/lib/library/study";

/** "Got it" or "Again" on a flashcard: it moves boxes and gets its next review date. */
export async function POST(req: Request, ctx: RouteCtx<{ botId: string; setId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId, setId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ cardId: z.string().min(1).max(60), result: z.enum(["got_it", "again"]) }));
  if (!parsed.ok) return parsed.res;
  const set = await getStudySet(a.db, botId, setId);
  if (!set || set.kind !== "flashcards") return apiError(404, "That set of flashcards was deleted.");
  const saved = await saveReview(a.db, set, parsed.data.cardId, parsed.data.result);
  return json({ set: studySetView(saved) });
}
