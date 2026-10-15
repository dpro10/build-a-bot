import { apiError, json, parseJson, type RouteCtx } from "@/lib/api";
import { dictionaryView } from "@/lib/dictation";
import { voiceAuth } from "@/lib/dictation/auth";
import { deleteEntry, entryPatch, updateEntry } from "@/lib/dictation/dictionary";

export async function PATCH(req: Request, ctx: RouteCtx<{ entryId: string }>) {
  const a = await voiceAuth(req, { write: true });
  if (!a.ok) return a.res;
  const { entryId } = await ctx.params;
  const parsed = await parseJson(req, entryPatch);
  if (!parsed.ok) return parsed.res;
  const res = await updateEntry(a.db, a.owner.id, entryId, parsed.data);
  if (!res.ok) return apiError(res.status, res.error);
  return json({ entry: dictionaryView(res.entry) });
}

export async function DELETE(req: Request, ctx: RouteCtx<{ entryId: string }>) {
  const a = await voiceAuth(req, { write: true });
  if (!a.ok) return a.res;
  const { entryId } = await ctx.params;
  if (!(await deleteEntry(a.db, a.owner.id, entryId))) return apiError(404, "That word isn't in your dictionary anymore.");
  return json({ ok: true });
}
