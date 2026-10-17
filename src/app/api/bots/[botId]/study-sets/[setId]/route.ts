import { apiError, authedBot, json, sameOrigin, type RouteCtx } from "@/lib/api";
import { deleteStudySet, getStudySet, studySetView } from "@/lib/library/study";

/** A set with its cards or questions, and its progress (opened from a chat card or the Library). */
export async function GET(_req: Request, ctx: RouteCtx<{ botId: string; setId: string }>) {
  const { botId, setId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const set = await getStudySet(a.db, botId, setId);
  if (!set) return apiError(404, "That study set was deleted.", { code: "gone" });
  return json({ set: studySetView(set) });
}

export async function DELETE(req: Request, ctx: RouteCtx<{ botId: string; setId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId, setId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  if (!(await deleteStudySet(a.db, botId, setId))) return apiError(404, "That study set was already deleted.");
  return json({ ok: true });
}
