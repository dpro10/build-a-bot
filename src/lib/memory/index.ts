/**
 * Memory that works on any brain. A bot keeps everything it remembers, but a turn only sends
 * the model what matters right now: pinned basics first, then the memories that match what's
 * being talked about, then the newest, up to a budget sized to the brain. A small fast model
 * gets a short list it can use well; a big model gets more. The bot looks up the rest with its
 * recall tool, so nothing is lost when memory grows (an import can bring hundreds of facts).
 *
 * Matching is word-based (light stemming, a few everyday synonyms, BM25 ranking), so it needs
 * no extra service and works the same in tests, on Supabase and offline.
 */
import { desc, eq } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { BrainConfig } from "@/lib/db/schema";
import { findModel, type ProviderId } from "@/lib/models/catalog";

/** Most memories a bot keeps. */
export const MAX_MEMORIES = 2000;
/** Most memories pinned as "always keep in mind" (they go to every turn). */
export const MAX_PINNED = 15;

export type Tier = "fast" | "balanced" | "smart";
export type MemoryBudget = { count: number; chars: number };

/** How much memory each kind of brain gets per turn. */
export const MEMORY_BUDGET: Record<Tier, MemoryBudget> = {
  fast: { count: 24, chars: 2_400 },
  balanced: { count: 40, chars: 4_500 },
  smart: { count: 80, chars: 9_000 },
};

export function brainTier(brain: Pick<BrainConfig, "kind" | "provider" | "model">): Tier {
  // Subscriptions run the owner's Claude or ChatGPT: top models.
  if (brain.kind === "subscription") return "smart";
  if (brain.kind === "included" || brain.provider === "demo") return findModel("nebius", brain.model)?.tier ?? "fast";
  return findModel(brain.provider as ProviderId, brain.model)?.tier ?? "balanced";
}

export function memoryBudget(brain: Pick<BrainConfig, "kind" | "provider" | "model">): MemoryBudget {
  return MEMORY_BUDGET[brainTier(brain)];
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** Words that say nothing about the topic. Negations stay: "is not vegetarian" ≠ "is vegetarian". */
const STOP = new Set(
  (
    "a an the and or but if then than so as of to in on at for from with by about into over after before between " +
    "is are was were be been being am do does did done have has had having i me my mine myself you your yours " +
    "he him his she her hers they them their theirs we us our ours it its this that these those there here " +
    "what which who whom whose when where why how can could would should will shall may might must " +
    "just also very really too please thanks thank hi hey hello ok okay yeah yes sure some any all each every " +
    "more most much many other another such own same again ever still even only quite rather get got let lets " +
    "tell know remember recall think thing things something anything everything one ones up out off"
  ).split(" "),
);

/** Everyday words people use for the same thing, so "what does my mom like?" finds "Diego's mother loves tulips". */
const RELATED: string[][] = [
  ["mom", "mother", "mum", "mama", "mommy"],
  ["dad", "father", "papa", "daddy"],
  ["wife", "husband", "spouse", "partner", "girlfriend", "boyfriend", "fiance", "fiancee"],
  ["kid", "child", "children", "son", "daughter", "baby"],
  ["sister", "brother", "sibling"],
  ["grandma", "grandmother", "grandpa", "grandfather", "grandparent"],
  ["birthday", "bday", "born", "anniversary"],
  ["job", "work", "career", "employer", "company", "office", "boss"],
  ["doctor", "dentist", "physician", "therapist", "clinic"],
  ["food", "eat", "diet", "meal", "dinner", "lunch", "breakfast", "vegetarian", "vegan", "allergy", "allergic", "restaurant"],
  ["home", "live", "address", "city", "town", "house", "apartment", "neighborhood"],
  ["pet", "dog", "cat", "puppy"],
  ["gym", "workout", "exercise", "fitness", "run", "training"],
  ["school", "class", "college", "university", "student", "study", "course"],
  ["trip", "travel", "flight", "vacation", "holiday", "hotel"],
  ["money", "budget", "bank", "salary", "spend", "savings"],
  ["friend", "buddy", "bestie"],
];

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;

function stem(w: string): string {
  let s = w;
  if (s.length > 4 && s.endsWith("ies")) s = `${s.slice(0, -3)}y`;
  else if (s.length > 4 && /(?:ch|sh|x|ss|z)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !/(?:ss|us|is)$/.test(s)) s = s.slice(0, -1);
  else if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  if (s.length > 3 && s.endsWith("e")) s = s.slice(0, -1);
  // "running" → "runn" → "run"; "shopped" → "shopp" → "shop".
  if (s.length > 3 && /([bdfgklmnprtz])\1$/.test(s)) s = s.slice(0, -1);
  return s;
}

/** The meaningful words of a text, lowercased, without accents, lightly stemmed. */
export function terms(text: string): string[] {
  const out: string[] = [];
  const words = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(WORD) ?? [];
  for (const raw of words) {
    const w = raw.replace(/['’]s$/, "").replace(/['’]/g, "");
    // Single digits count: "2 kids" and "3 kids" are different facts.
    if ((w.length < 2 && !/^\d$/.test(w)) || STOP.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}

/** Broad words that find the specific ones ("family" finds a sister), but not the other way round. */
const BROADER: Record<string, string[]> = {
  family: ["mom", "mother", "dad", "father", "parent", "sister", "brother", "sibling", "wife", "husband", "spouse", "partner", "kid", "child", "children", "son", "daughter", "grandma", "grandpa", "cousin", "aunt", "uncle"],
  health: ["doctor", "dentist", "therapist", "clinic", "allergy", "allergic", "medication", "medicine", "condition", "diet"],
};

const RELATED_BY_STEM = new Map<string, string[]>();
const relate = (from: string, to: string[]) => RELATED_BY_STEM.set(from, [...new Set([...(RELATED_BY_STEM.get(from) ?? []), ...to.filter((x) => x !== from)])]);
for (const group of RELATED) {
  const stems = [...new Set(group.map(stem))];
  for (const s of stems) relate(s, stems);
}
for (const [broad, narrow] of Object.entries(BROADER)) relate(stem(broad), narrow.map(stem));

/** Weighted search words: what's said now counts most, the conversation around it less, related words a little. */
export function memoryQuery(parts: { text: string | null | undefined; weight: number }[]): Map<string, number> {
  const q = new Map<string, number>();
  const add = (t: string, w: number) => q.set(t, Math.max(q.get(t) ?? 0, w));
  for (const part of parts) {
    if (!part.text) continue;
    for (const t of terms(part.text)) {
      add(t, part.weight);
      for (const r of RELATED_BY_STEM.get(t) ?? []) add(r, part.weight * 0.4);
    }
  }
  return q;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/** BM25 scores of each document for the query. */
function bm25(docs: string[][], query: Map<string, number>): number[] {
  const n = docs.length;
  if (!n || !query.size) return docs.map(() => 0);
  const df = new Map<string, number>();
  let total = 0;
  for (const d of docs) {
    total += d.length;
    for (const t of new Set(d)) if (query.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const avg = total / n || 1;
  const k1 = 1.2;
  const b = 0.75;
  return docs.map((d) => {
    if (!d.length) return 0;
    const tf = new Map<string, number>();
    for (const t of d) if (query.has(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const [t, f] of tf) {
      const dft = df.get(t) ?? 0;
      const idf = Math.log(1 + (n - dft + 0.5) / (dft + 0.5));
      score += (query.get(t) ?? 0) * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg)));
    }
    return score;
  });
}

export type MemoryLike = { id: string; text: string; pinned: boolean; updatedAt: Date };

const newestFirst = (a: MemoryLike, b: MemoryLike) => b.updatedAt.getTime() - a.updatedAt.getTime();

/** Memories ranked by how well they match the query (best first), only those that match at all. */
export function rankMemories<T extends MemoryLike>(rows: T[], query: Map<string, number>): { row: T; score: number }[] {
  const scores = bm25(
    rows.map((r) => terms(r.text)),
    query,
  );
  return rows
    .map((row, i) => ({ row, score: scores[i] }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || newestFirst(a.row, b.row));
}

/**
 * What goes to the model this turn: pinned basics, then the best matches, then the newest
 * (a few places are kept for those, since new things are often what's being talked about),
 * within the brain's budget.
 */
export function selectMemories<T extends MemoryLike>(rows: T[], query: Map<string, number>, budget: MemoryBudget): T[] {
  const picked: T[] = [];
  const seen = new Set<string>();
  let chars = 0;
  const take = (m: T): boolean => {
    if (seen.has(m.id) || picked.length >= budget.count) return false;
    const cost = m.text.length + 3;
    if (picked.length && chars + cost > budget.chars) return false;
    picked.push(m);
    seen.add(m.id);
    chars += cost;
    return true;
  };
  for (const m of rows.filter((r) => r.pinned).sort(newestFirst).slice(0, MAX_PINNED)) take(m);
  const rest = rows.filter((r) => !r.pinned);
  const forNewest = Math.min(Math.max(3, Math.floor(budget.count / 4)), rest.length);
  const forMatches = Math.max(0, budget.count - picked.length - forNewest);
  let matched = 0;
  for (const { row } of rankMemories(rest, query)) {
    if (matched >= forMatches) break;
    if (take(row)) matched++;
  }
  for (const m of [...rest].sort(newestFirst)) {
    if (picked.length >= budget.count) break;
    take(m);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Same fact?
// ---------------------------------------------------------------------------

export type FactRelation = "same" | "more" | "less" | "different";

/**
 * How a new fact relates to one already remembered: the same thing, the same with a little more
 * detail ("has a sister" → "has a sister named Ana"), a little less, or something else. "A little"
 * is at most two words: "likes coffee" and "likes coffee shops near the office" are two facts.
 */
export function compareFacts(next: string, existing: string): FactRelation {
  return factRelation(new Set(terms(next)), new Set(terms(existing)), next, existing);
}

function factRelation(a: Set<string>, b: Set<string>, next: string, existing: string): FactRelation {
  if (!a.size || !b.size) return next.trim().toLowerCase() === existing.trim().toLowerCase() ? "same" : "different";
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  if (shared / (a.size + b.size - shared) >= 0.85) return "same";
  if (b.size >= 2 && shared === b.size && a.size - shared <= 2) return "more";
  if (a.size >= 2 && shared === a.size && b.size - shared <= 2) return "less";
  return "different";
}

// An import checks up to 200 facts against up to 2,000 memories: read each memory's words once.
const termsByRow = new WeakMap<object, Set<string>>();
function rowTerms(row: { text: string }): Set<string> {
  let words = termsByRow.get(row);
  if (!words) termsByRow.set(row, (words = new Set(terms(row.text))));
  return words;
}

/** The remembered fact this one repeats or adds detail to, if any. */
export function findSameFact<T extends { text: string }>(rows: T[], text: string): { row: T; relation: Exclude<FactRelation, "different"> } | null {
  let best: { row: T; relation: Exclude<FactRelation, "different"> } | null = null;
  const words = new Set(terms(text));
  for (const row of rows) {
    const relation = factRelation(words, rowTerms(row), text, row.text);
    if (relation === "same" || relation === "less") return { row, relation };
    if (relation === "more" && !best) best = { row, relation };
  }
  return best;
}

/** The memory someone means by a few of its words ("my sister's birthday"), when one clearly fits. */
export function findMemory<T extends MemoryLike>(rows: T[], words: string): T | null {
  const wanted = new Set(terms(words));
  if (!wanted.size) return null;
  for (const { row } of rankMemories(rows, memoryQuery([{ text: words, weight: 1 }]))) {
    const have = new Set(terms(row.text));
    let shared = 0;
    for (const t of wanted) if (have.has(t)) shared++;
    // Most of the words have to be there, not just a name they share.
    if (shared / wanted.size >= 0.6) return row;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function loadMemories(db: Db, botId: string) {
  return db
    .select({ id: schema.memories.id, text: schema.memories.text, pinned: schema.memories.pinned, source: schema.memories.source, updatedAt: schema.memories.updatedAt })
    .from(schema.memories)
    .where(eq(schema.memories.botId, botId))
    .orderBy(desc(schema.memories.updatedAt))
    .limit(MAX_MEMORIES);
}

/** The memories for one turn, picked for what's being talked about. */
export async function memoriesForTurn(
  db: Db,
  bot: { id: string; brain: Pick<BrainConfig, "kind" | "provider" | "model"> },
  about: { text: string | null | undefined; weight: number }[],
): Promise<{ lines: string[]; total: number }> {
  const rows = await loadMemories(db, bot.id);
  if (!rows.length) return { lines: [], total: 0 };
  const picked = selectMemories(rows, memoryQuery(about), memoryBudget(bot.brain));
  return { lines: picked.map((m) => m.text), total: rows.length };
}
