/**
 * Finding things in the Library: Postgres full-text search over the passages (English stemming, so
 * "cells" finds "cell"), best first. When every word together finds nothing, any of the words; when
 * that finds nothing either (a course code, a name stemming mangles), plain text matching.
 */
import { and, asc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import { truncate } from "@/lib/utils";

export type Hit = { fileId: string; fileName: string; page: number; label: string; text: string; rank: number };

const WORD = /[\p{L}\p{N}]{2,}/gu;

/** The query's words, for the any-word and plain-text fallbacks. */
export function queryWords(q: string): string[] {
  const stop = new Set(["the", "and", "for", "with", "what", "when", "where", "which", "who", "how", "are", "was", "this", "that", "from", "about", "into", "does", "did", "can"]);
  return [...new Set((q.toLowerCase().match(WORD) ?? []).filter((w) => !stop.has(w)))].slice(0, 12);
}

/** The bit of a passage around the first word of the query that's in it. */
export function snippet(text: string, words: string[], max = 700): string {
  if (text.length <= max) return text;
  const lower = text.toLowerCase();
  const at = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, Math.min(at - Math.floor(max / 3), text.length - max));
  return `${start > 0 ? "…" : ""}${text.slice(start, start + max).trim()}${start + max < text.length ? "…" : ""}`;
}

export async function searchLibrary(db: Db, botId: string, query: string, opts: { fileIds?: string[]; limit?: number } = {}): Promise<Hit[]> {
  const q = query.trim().slice(0, 300);
  if (!q) return [];
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 20);
  const words = queryWords(q);
  const scope = and(eq(schema.filePassages.botId, botId), eq(schema.files.status, "ready"), opts.fileIds?.length ? inArray(schema.filePassages.fileId, opts.fileIds) : undefined);
  const run = async (tsquery: ReturnType<typeof sql>) => {
    const rank = sql<number>`ts_rank_cd(${schema.filePassages.tsv}, ${tsquery})`;
    return db
      .select({
        fileId: schema.filePassages.fileId,
        fileName: schema.files.name,
        page: schema.filePassages.page,
        label: schema.filePassages.label,
        text: schema.filePassages.text,
        rank,
      })
      .from(schema.filePassages)
      .innerJoin(schema.files, eq(schema.files.id, schema.filePassages.fileId))
      .where(and(scope, sql`${schema.filePassages.tsv} @@ ${tsquery}`))
      .orderBy(sql`${rank} desc`, asc(schema.filePassages.idx))
      .limit(limit);
  };

  let rows = await run(sql`websearch_to_tsquery('english', ${q})`);
  if (!rows.length && words.length > 1) {
    rows = await run(sql`to_tsquery('english', ${words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean).join(" | ")})`);
  }
  if (!rows.length && words.length) {
    const like = words.slice(0, 4).map((w) => sql`${schema.filePassages.text} ilike ${`%${w.replace(/[%_\\]/g, (c) => `\\${c}`)}%`}`);
    rows = (
      await db
        .select({
          fileId: schema.filePassages.fileId,
          fileName: schema.files.name,
          page: schema.filePassages.page,
          label: schema.filePassages.label,
          text: schema.filePassages.text,
        })
        .from(schema.filePassages)
        .innerJoin(schema.files, eq(schema.files.id, schema.filePassages.fileId))
        // or(): parenthesized, so a match can't escape the bot's own files (a AND b OR c is (a AND b) OR c).
        .where(and(scope, or(...like)))
        .orderBy(asc(schema.filePassages.idx))
        .limit(limit)
    ).map((r) => ({ ...r, rank: 0 }));
  }
  return rows.map((r) => ({ ...r, rank: Number(r.rank) || 0, text: snippet(r.text, words) }));
}

/**
 * A file's text from page `from` to `to` (pages or slides), cut into parts of at most `maxChars`
 * at passage boundaries; returns part `part` (1-based) and how many there are.
 */
export async function readPassages(
  db: Db,
  fileId: string,
  opts: { from?: number; to?: number; part?: number; maxChars?: number } = {},
): Promise<{ text: string; part: number; parts: number; firstLabel: string | null; lastLabel: string | null }> {
  const maxChars = opts.maxChars ?? 24_000;
  const conds = [eq(schema.filePassages.fileId, fileId)];
  if (opts.from) conds.push(gte(schema.filePassages.page, opts.from));
  if (opts.to) conds.push(lte(schema.filePassages.page, opts.to));
  const rows = await db
    .select({ idx: schema.filePassages.idx, label: schema.filePassages.label, text: schema.filePassages.text })
    .from(schema.filePassages)
    .where(and(...conds))
    .orderBy(asc(schema.filePassages.idx))
    .limit(5000);
  const parts: { text: string[]; used: number; first: string; last: string }[] = [];
  let header: string | null = null;
  for (const r of rows) {
    const piece = `${r.label !== header ? `[${r.label}]\n` : ""}${truncate(r.text, maxChars - 20)}`;
    header = r.label;
    const cur = parts[parts.length - 1];
    if (!cur || cur.used + piece.length > maxChars) parts.push({ text: [piece.startsWith("[") ? piece : `[${r.label}]\n${piece}`], used: piece.length, first: r.label, last: r.label });
    else {
      cur.text.push(piece);
      cur.used += piece.length;
      cur.last = r.label;
    }
  }
  if (!parts.length) return { text: "", part: 1, parts: 0, firstLabel: null, lastLabel: null };
  const n = Math.min(Math.max(opts.part ?? 1, 1), parts.length);
  const p = parts[n - 1];
  return { text: p.text.join("\n\n"), part: n, parts: parts.length, firstLabel: p.first, lastLabel: p.last };
}
