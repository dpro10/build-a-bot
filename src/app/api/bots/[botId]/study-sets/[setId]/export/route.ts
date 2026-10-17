import { apiError, authedBot, type RouteCtx } from "@/lib/api";
import { getStudySet, studySetCsv } from "@/lib/library/study";

/** A set as CSV: flashcards import into Anki and Quizlet as they are. */
export async function GET(_req: Request, ctx: RouteCtx<{ botId: string; setId: string }>) {
  const { botId, setId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const set = await getStudySet(a.db, botId, setId);
  if (!set) return apiError(404, "That study set was deleted.");
  const name = `${set.title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 80) || "study-set"}.csv`;
  return new Response(`﻿${studySetCsv(set)}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, no-store",
    },
  });
}
