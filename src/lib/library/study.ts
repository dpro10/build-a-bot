/**
 * Study sets: flashcards and practice quizzes a bot makes (usually from the Library), studied right
 * in the chat or on the Library page.
 *
 * Flashcards use spaced repetition (Leitner boxes): "Got it" moves a card up a box and pushes it
 * further out (1, 3, 7, 16, 35 days); "Again" sends it back to box 1, due in ten minutes. A quiz
 * keeps its last attempts (score and what was missed), so the bot can go over the mistakes.
 */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { QuizQuestion, StudyCard, StudyProgress, StudySet, StudySetSummary } from "@/lib/db/schema";
import { newId } from "@/lib/utils";
import { siteOf, type StudySetView } from "./views";

export const MAX_CARDS = 60;
export const MAX_QUESTIONS = 40;
/** Days until a card in box n (1-based) is due again after "Got it". */
export const BOX_DAYS = [1, 3, 7, 16, 35];
const AGAIN_MS = 10 * 60_000;

const text = (max: number) => z.string().trim().min(1).max(max);
/** A web page an answer was checked against: http(s) only (it becomes a link). */
const sourceUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "a web page's address (http or https)")
  .describe("For an answer that isn't from their files: the page you checked it against (a link from check_facts or web_search)");

export const cardInput = z.object({
  front: text(500).describe("The prompt: a term, a question, or a fill-in-the-blank"),
  back: text(1200).describe("The answer, short and exact"),
  source: z.string().trim().max(160).optional().describe('Where it came from, e.g. "Bio 101 syllabus, page 2"'),
  source_url: sourceUrl.optional(),
});

export const questionInput = z
  .object({
    type: z.enum(["multiple_choice", "true_false", "short_answer"]),
    question: text(800),
    choices: z.array(text(300)).min(2).max(6).optional().describe("multiple_choice only: 3 to 5 options, one of them exactly the answer"),
    answer: text(600).describe('The right answer. multiple_choice: the right choice, word for word. true_false: "True" or "False".'),
    explanation: z.string().trim().max(1200).optional().describe("Why that's the answer, in a sentence or two"),
    source: z.string().trim().max(160).optional(),
    source_url: sourceUrl.optional(),
  })
  .superRefine((q, ctx) => {
    if (q.type === "multiple_choice") {
      if (!q.choices?.length) ctx.addIssue({ code: "custom", message: "multiple_choice needs choices", path: ["choices"] });
      else {
        const plain = withoutLetters(q.choices, q.answer);
        if (!plain.choices.some((c) => sameAnswer(c, plain.answer))) ctx.addIssue({ code: "custom", message: "the answer must be one of the choices, word for word", path: ["answer"] });
      }
    }
    if (q.type === "true_false" && !/^(true|false)$/i.test(q.answer.trim())) ctx.addIssue({ code: "custom", message: 'true_false answers are "True" or "False"', path: ["answer"] });
  });

/** "A) Stroma", "b. Thylakoid", "(C) Granum": a choice's own letter, when it has one. */
const LETTER = /^\s*(?:\(([a-f])\)|([a-f])[.):])\s+/i;

/**
 * The quiz shows its own A, B, C beside each choice, so a model's "A) …" would show twice. When the
 * choices are lettered in order (a, b, c…), the letters go; the answer follows ("C) Stroma", "C" or
 * "Stroma" all become "Stroma"). Choices that only look lettered ("C. elegans", "E. coli") stay.
 */
export function withoutLetters(choices: string[], answer: string): { choices: string[]; answer: string } {
  const letters = choices.map((c) => {
    const m = LETTER.exec(c);
    return m ? (m[1] ?? m[2]).toLowerCase() : null;
  });
  if (!letters.every((l, i) => l === String.fromCharCode(97 + i))) return { choices, answer };
  const plain = choices.map((c) => c.replace(LETTER, "").trim());
  const asWritten = choices.findIndex((c) => sameAnswer(c, answer));
  const byLetter = /^\s*\(?([a-f])\)?\s*$/i.exec(answer);
  const at = asWritten >= 0 ? asWritten : byLetter ? byLetter[1].toLowerCase().charCodeAt(0) - 97 : -1;
  return { choices: plain, answer: plain[at] ?? answer.replace(LETTER, "").trim() };
}

export function sameAnswer(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\s.,;:!?'"()]+/g, " ").trim();
  return norm(a) === norm(b);
}

export function summarize(set: StudySet): StudySetSummary {
  const sources = new Set<string>();
  for (const item of set.items as (StudyCard | QuizQuestion)[]) {
    const s = item.source?.replace(/,?\s*(page|slide|p\.)\s*\d+.*$/i, "").trim() || (item.sourceUrl ? siteOf(item.sourceUrl) : "");
    if (s) sources.add(s);
  }
  return { id: set.id, kind: set.kind === "quiz" ? "quiz" : "flashcards", title: set.title, count: set.items.length, sources: [...sources].slice(0, 3) };
}

export function studySetView(set: StudySet, now = new Date()): StudySetView {
  const flash = set.kind === "flashcards";
  const boxes: StudySetView["boxes"] = {};
  for (const [id, p] of Object.entries(set.progress?.cards ?? {})) boxes[id] = { box: p.box, due: p.due };
  return {
    id: set.id,
    kind: flash ? "flashcards" : "quiz",
    title: set.title,
    cards: flash ? (set.items as StudyCard[]) : [],
    questions: flash ? [] : (set.items as QuizQuestion[]).map((q) => (q.type === "multiple_choice" && q.choices ? { ...q, ...withoutLetters(q.choices, q.answer) } : q)),
    dueIds: dueCards(set, now).map((c) => c.id),
    boxes,
    attempts: set.progress?.attempts ?? [],
    sources: summarize(set).sources,
    createdAt: set.createdAt.toISOString(),
  };
}

export async function createStudySet(
  db: Db,
  input: { botId: string; kind: "flashcards" | "quiz"; title: string; items: z.infer<typeof cardInput>[] | z.infer<typeof questionInput>[]; fileIds?: string[] },
): Promise<StudySet> {
  const items =
    input.kind === "flashcards"
      ? (input.items as z.infer<typeof cardInput>[])
          .slice(0, MAX_CARDS)
          .map((c): StudyCard => ({ id: newId("card"), front: c.front, back: c.back, ...(c.source ? { source: c.source } : {}), ...(c.source_url ? { sourceUrl: c.source_url } : {}) }))
      : (input.items as z.infer<typeof questionInput>[]).slice(0, MAX_QUESTIONS).map((q): QuizQuestion => {
          const plain = q.type === "multiple_choice" && q.choices ? withoutLetters(q.choices, q.answer) : null;
          return {
            id: newId("q"),
            type: q.type,
            question: q.question,
            ...(plain ? { choices: plain.choices } : q.type === "true_false" ? { choices: ["True", "False"] } : {}),
            answer: plain ? plain.answer : q.type === "true_false" ? (/^t/i.test(q.answer) ? "True" : "False") : q.answer,
            ...(q.explanation ? { explanation: q.explanation } : {}),
            ...(q.source ? { source: q.source } : {}),
            ...(q.source_url ? { sourceUrl: q.source_url } : {}),
          };
        });
  const [row] = await db
    .insert(schema.studySets)
    .values({ id: newId("set"), botId: input.botId, kind: input.kind, title: input.title.trim().slice(0, 120) || "Study set", items, fileIds: input.fileIds ?? [] })
    .returning();
  return row;
}

export async function listStudySets(db: Db, botId: string): Promise<StudySet[]> {
  return db.select().from(schema.studySets).where(eq(schema.studySets.botId, botId)).orderBy(desc(schema.studySets.createdAt)).limit(200);
}


export async function getStudySet(db: Db, botId: string, id: string): Promise<StudySet | null> {
  const [row] = await db.select().from(schema.studySets).where(and(eq(schema.studySets.botId, botId), eq(schema.studySets.id, id))).limit(1);
  return row ?? null;
}

export async function deleteStudySet(db: Db, botId: string, id: string): Promise<boolean> {
  const rows = await db.delete(schema.studySets).where(and(eq(schema.studySets.botId, botId), eq(schema.studySets.id, id))).returning({ id: schema.studySets.id });
  return rows.length > 0;
}

/** Cards of a flashcard set that are due now (never seen counts as due). */
export function dueCards(set: Pick<StudySet, "kind" | "items" | "progress">, now = new Date()): StudyCard[] {
  if (set.kind !== "flashcards") return [];
  const cards = set.progress?.cards ?? {};
  return (set.items as StudyCard[]).filter((c) => !cards[c.id] || new Date(cards[c.id].due) <= now);
}

/** "Got it" or "Again" on one card: its new box and due time. */
export function reviewCard(progress: StudyProgress, cardId: string, result: "got_it" | "again", now = new Date()): StudyProgress {
  const cards = { ...(progress.cards ?? {}) };
  const cur = cards[cardId] ?? { box: 0, due: now.toISOString(), seen: 0, missed: 0 };
  const box = result === "got_it" ? Math.min(cur.box + 1, BOX_DAYS.length) : 1;
  const due = result === "got_it" ? new Date(now.getTime() + BOX_DAYS[box - 1] * 86_400_000) : new Date(now.getTime() + AGAIN_MS);
  cards[cardId] = { box, due: due.toISOString(), seen: cur.seen + 1, missed: cur.missed + (result === "again" ? 1 : 0) };
  return { ...progress, cards };
}

export async function saveReview(db: Db, set: StudySet, cardId: string, result: "got_it" | "again"): Promise<StudySet> {
  if (!(set.items as StudyCard[]).some((c) => c.id === cardId)) return set;
  const progress = reviewCard(set.progress ?? {}, cardId, result);
  const [row] = await db.update(schema.studySets).set({ progress, updatedAt: new Date() }).where(eq(schema.studySets.id, set.id)).returning();
  return row ?? set;
}

/** A finished quiz: its score and what was missed (the last 20 attempts are kept). */
export async function saveAttempt(db: Db, set: StudySet, attempt: { score: number; total: number; missed: string[] }): Promise<StudySet> {
  const ids = new Set((set.items as QuizQuestion[]).map((q) => q.id));
  const clean = { at: new Date().toISOString(), score: Math.max(0, Math.min(attempt.score, attempt.total)), total: attempt.total, missed: attempt.missed.filter((m) => ids.has(m)) };
  const progress: StudyProgress = { ...(set.progress ?? {}), attempts: [...(set.progress?.attempts ?? []), clean].slice(-20) };
  const [row] = await db.update(schema.studySets).set({ progress, updatedAt: new Date() }).where(eq(schema.studySets.id, set.id)).returning();
  return row ?? set;
}

/** How the owner is doing: cards due now and the most-missed, and recent quiz scores. */
export async function studyStatus(db: Db, botId: string): Promise<{ due: number; sets: { set: StudySet; due: number }[]; weak: { set: string; front: string; missed: number }[]; quizzes: { set: string; score: number; total: number; at: string }[] }> {
  const sets = await listStudySets(db, botId);
  const now = new Date();
  const withDue = sets.map((set) => ({ set, due: dueCards(set, now).length }));
  const weak: { set: string; front: string; missed: number }[] = [];
  const quizzes: { set: string; score: number; total: number; at: string }[] = [];
  for (const set of sets) {
    if (set.kind === "flashcards") {
      for (const c of set.items as StudyCard[]) {
        const p = set.progress?.cards?.[c.id];
        if (p && p.missed > 0) weak.push({ set: set.title, front: c.front, missed: p.missed });
      }
    } else for (const a of set.progress?.attempts ?? []) quizzes.push({ set: set.title, score: a.score, total: a.total, at: a.at });
  }
  weak.sort((a, b) => b.missed - a.missed);
  quizzes.sort((a, b) => b.at.localeCompare(a.at));
  return { due: withDue.reduce((n, s) => n + s.due, 0), sets: withDue, weak: weak.slice(0, 10), quizzes: quizzes.slice(0, 10) };
}

/** One CSV cell, quoted when it needs to be. */
function cell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * A set as CSV. Flashcards: "Front,Back" (Anki and Quizlet import it). Quizzes: question, answer,
 * choices, explanation, source.
 */
export function studySetCsv(set: StudySet): string {
  if (set.kind === "flashcards") return ["Front,Back", ...(set.items as StudyCard[]).map((c) => `${cell(c.front)},${cell(c.back)}`)].join("\r\n") + "\r\n";
  return (
    [
      "Question,Answer,Choices,Explanation,Source",
      ...(set.items as QuizQuestion[]).map((q) => [q.question, q.answer, (q.choices ?? []).join(" | "), q.explanation ?? "", [q.source, q.sourceUrl].filter(Boolean).join(" ")].map(cell).join(",")),
    ].join("\r\n") + "\r\n"
  );
}
