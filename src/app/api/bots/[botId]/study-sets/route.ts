import { authedBot, json, type RouteCtx } from "@/lib/api";
import { dueCards, listStudySets, summarize } from "@/lib/library/study";

/** The bot's flashcards and quizzes, with how many cards are due in each. */
export async function GET(_req: Request, ctx: RouteCtx<{ botId: string }>) {
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const sets = await listStudySets(a.db, botId);
  return json({
    sets: sets.map((s) => ({ ...summarize(s), due: dueCards(s).length, lastScore: s.progress?.attempts?.at(-1) ?? null, createdAt: s.createdAt.toISOString() })),
  });
}
