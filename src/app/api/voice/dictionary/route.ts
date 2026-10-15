import { apiError, json, limitOr429, parseJson } from "@/lib/api";
import { dictionaryView, listDictionary, loadVoiceContext } from "@/lib/dictation";
import { voiceAuth } from "@/lib/dictation/auth";
import { addEntry, entryInput } from "@/lib/dictation/dictionary";

/** The owner's words and snippets, and the names voice typing already knows from their bots. */
export async function GET(req: Request) {
  const a = await voiceAuth(req);
  if (!a.ok) return a.res;
  const ctx = await loadVoiceContext(a.db, a.owner);
  return json({
    entries: [...ctx.words, ...ctx.snippets].sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime()).map(dictionaryView),
    fromMemories: ctx.fromMemories,
    bots: ctx.bots.map((b) => ({ id: b.id, name: b.name })),
  });
}

export async function POST(req: Request) {
  const a = await voiceAuth(req, { write: true });
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, entryInput);
  if (!parsed.ok) return parsed.res;
  const limited = await limitOr429(a.db, `dictionary:${a.owner.id}`, 60, 60);
  if (limited) return limited;
  const res = await addEntry(a.db, a.owner.id, parsed.data);
  if (!res.ok) return apiError(res.status, res.error);
  return json({ entry: dictionaryView(res.entry), merged: res.merged, count: (await listDictionary(a.db, a.owner.id)).length }, { status: res.merged ? 200 : 201 });
}
