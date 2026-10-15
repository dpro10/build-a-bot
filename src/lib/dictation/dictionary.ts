/**
 * Adding, changing and removing the owner's dictionary words and snippets (voice typing).
 * The same rules for the desktop app and the Voice typing page; inputs are checked here, never
 * trusted from either.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/lib/db";
import type { DictionaryEntry } from "@/lib/db/schema";
import { newId } from "@/lib/utils";
import { MAX_SNIPPETS, MAX_WORDS, getDictionaryEntry, listDictionary } from "./index";
import { normalizeSpeech } from "./text";

const phrase = (max: number) => z.string().trim().max(max);

export const entryInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("word"),
    text: z.string().trim().min(1, "Type the word").max(80, "Words can be up to 80 characters"),
    /** What speech-to-text writes instead. */
    heard: z.array(phrase(80)).max(8).optional(),
    source: z.enum(["manual", "correction"]).optional(),
  }),
  z.object({
    kind: z.literal("snippet"),
    text: z.string().trim().min(1, "Type what it should type").max(4000, "A snippet can be up to 4,000 characters"),
    /** The phrases that type it. */
    heard: z.array(phrase(60)).min(1, "Add the phrase you'll say").max(3),
  }),
]);
export type EntryInput = z.infer<typeof entryInput>;

export const entryPatch = z.object({
  text: z.string().trim().min(1).max(4000).optional(),
  heard: z.array(phrase(80)).max(8).optional(),
});
export type EntryPatch = z.infer<typeof entryPatch>;

type Fail = { ok: false; status: number; error: string };

/** Phrases tidied: spaces collapsed, blanks, repeats and the word itself out. */
function cleanList(list: string[] | undefined, exclude?: string): string[] {
  const seen = new Set<string>(exclude ? [normalizeSpeech(exclude)] : []);
  const out: string[] = [];
  for (const raw of list ?? []) {
    const p = raw.replace(/\s+/g, " ").trim();
    const key = normalizeSpeech(p);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function checkTriggers(triggers: string[], others: DictionaryEntry[]): Fail | null {
  if (!triggers.length) return { ok: false, status: 422, error: "Add the phrase you'll say to type this snippet." };
  for (const t of triggers) {
    if (normalizeSpeech(t).length < 3) return { ok: false, status: 422, error: `"${t}" is too short to say. Use a phrase of a few words.` };
    const taken = others.find((o) => o.kind === "snippet" && o.heard.some((h) => normalizeSpeech(h) === normalizeSpeech(t)));
    if (taken) return { ok: false, status: 409, error: `You already have a snippet for "${t}".` };
  }
  return null;
}

/**
 * Add a word or a snippet. A word that's already there gets the new "heard as" spellings added
 * to it instead of a second entry.
 */
export async function addEntry(db: Db, ownerId: string, input: EntryInput): Promise<{ ok: true; entry: DictionaryEntry; merged: boolean } | Fail> {
  const all = await listDictionary(db, ownerId);
  if (input.kind === "word") {
    let text = input.text.replace(/\s+/g, " ");
    const same = all.find((e) => e.kind === "word" && e.text.toLowerCase() === text.toLowerCase());
    if (same) {
      // "prozzi" again doesn't undo "Prozzi"; "GitHub" does fix "Github".
      if (text === text.toLowerCase() && same.text !== same.text.toLowerCase()) text = same.text;
      const heard = cleanList([...same.heard, ...(input.heard ?? [])], text).slice(0, 8);
      const [entry] = await db
        .update(schema.dictionary)
        .set({ text, heard, updatedAt: new Date() })
        .where(and(eq(schema.dictionary.id, same.id), eq(schema.dictionary.ownerId, ownerId)))
        .returning();
      return { ok: true, entry, merged: true };
    }
    if (all.filter((e) => e.kind === "word").length >= MAX_WORDS) return { ok: false, status: 422, error: `Your dictionary is full (${MAX_WORDS} words). Delete some to add more.` };
    const [entry] = await db
      .insert(schema.dictionary)
      .values({ id: newId("dict"), ownerId, kind: "word", text, heard: cleanList(input.heard, text), source: input.source ?? "manual" })
      .returning();
    return { ok: true, entry, merged: false };
  }
  if (all.filter((e) => e.kind === "snippet").length >= MAX_SNIPPETS) return { ok: false, status: 422, error: `You have ${MAX_SNIPPETS} snippets already. Delete some to add more.` };
  const heard = cleanList(input.heard);
  const bad = checkTriggers(heard, all);
  if (bad) return bad;
  const [entry] = await db.insert(schema.dictionary).values({ id: newId("dict"), ownerId, kind: "snippet", text: input.text, heard, source: "manual" }).returning();
  return { ok: true, entry, merged: false };
}

export async function updateEntry(db: Db, ownerId: string, id: string, patch: EntryPatch): Promise<{ ok: true; entry: DictionaryEntry } | Fail> {
  const entry = await getDictionaryEntry(db, ownerId, id);
  if (!entry) return { ok: false, status: 404, error: "That word isn't in your dictionary anymore." };
  const text = (patch.text ?? entry.text).trim();
  let heard = patch.heard ?? entry.heard;
  if (entry.kind === "word") {
    if (text.length > 80) return { ok: false, status: 422, error: "Words can be up to 80 characters" };
    heard = cleanList(heard, text);
  } else {
    heard = cleanList(heard).slice(0, 3);
    const others = (await listDictionary(db, ownerId)).filter((e) => e.id !== id);
    const bad = checkTriggers(heard, others);
    if (bad) return bad;
  }
  const [updated] = await db
    .update(schema.dictionary)
    .set({ text, heard, updatedAt: new Date() })
    .where(and(eq(schema.dictionary.id, id), eq(schema.dictionary.ownerId, ownerId)))
    .returning();
  return { ok: true, entry: updated };
}

export async function deleteEntry(db: Db, ownerId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(schema.dictionary)
    .where(and(eq(schema.dictionary.id, id), eq(schema.dictionary.ownerId, ownerId)))
    .returning({ id: schema.dictionary.id });
  return rows.length > 0;
}
