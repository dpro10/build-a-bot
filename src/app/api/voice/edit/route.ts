import { z } from "zod";
import { apiError, json, limitOr429, parseJson } from "@/lib/api";
import { APP_CATEGORIES, editByVoice } from "@/lib/dictation";
import { voiceAuth } from "@/lib/dictation/auth";
import { MAX_INSTRUCTION_CHARS, MAX_SELECTION_CHARS } from "@/lib/dictation/edit";

export const maxDuration = 60;

const bodySchema = z.object({
  instruction: z.string().trim().min(1).max(MAX_INSTRUCTION_CHARS),
  selection: z.string().max(MAX_SELECTION_CHARS).nullish(),
  category: z.enum(APP_CATEGORIES).optional(),
  app: z.string().trim().max(60).optional(),
  styles: z.boolean().optional(),
});

/**
 * Editing by voice: what they said to do with the text they selected (or, with nothing selected,
 * what to write) → the text to type over it, or a short answer to show. The selection is used for
 * this one request and never stored.
 */
export async function POST(req: Request) {
  const a = await voiceAuth(req, { write: true, appOnly: true });
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, bodySchema);
  if (!parsed.ok) return parsed.res;
  const limited = await limitOr429(a.db, `voice-edit:${a.owner.id}`, 30, 60, "That's a lot of edits at once. Give it a moment.");
  if (limited) return limited;
  const d = parsed.data;
  const out = await editByVoice(a.db, a.owner, { instruction: d.instruction, selection: d.selection ?? null, category: d.category, appName: d.app, styles: d.styles !== false });
  if (!out.ok) return apiError(out.status, out.error, { code: out.code, upgrade: out.upgrade });
  return json({ kind: out.kind, text: out.text, words: out.words, usage: out.usage, simulated: out.simulated, ms: out.ms });
}
