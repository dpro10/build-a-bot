import { z } from "zod";
import { appUrl } from "@/lib/env";
import { findFile, listFiles } from "@/lib/library";
import { pagesLabel } from "@/lib/library/limits";
import { readPassages, searchLibrary } from "@/lib/library/search";
import { cardInput, createStudySet, MAX_CARDS, MAX_QUESTIONS, questionInput, studyStatus, summarize } from "@/lib/library/study";
import { pagesReadRecently, sameLink } from "../sources";
import { defineTool, type ToolContext } from "../types";

const libraryUrl = (ctx: ToolContext) => `${appUrl()}/app/bots/${ctx.bot.id}/library`;

/** Files named in a tool call → their ids (unknown names are just left out). */
async function fileIds(ctx: ToolContext, names: string[] | undefined): Promise<string[]> {
  const ids: string[] = [];
  for (const n of names ?? []) {
    const f = await findFile(ctx.db, ctx.bot.id, n);
    if (f && !ids.includes(f.id)) ids.push(f.id);
  }
  return ids;
}

export const listFilesTool = defineTool({
  name: "list_files",
  title: "Look through the Library",
  description: "List the files in your Library (what the owner gave you: syllabi, slides, notes, readings): name, pages and when it was added, newest first.",
  input: z.object({}),
  connectorId: "library",
  capabilityId: "read_files",
  effect: "read",
  risk: "low",
  // Names the owner chose; the files' contents are what's outside content.
  taints: false,
  summarize: () => "Look through the Library",
  async run(_a, ctx) {
    const files = await listFiles(ctx.db, ctx.bot.id);
    if (!files.length) return { ok: true, content: `The Library is empty. The owner can add files with the paperclip in the chat, on the Library page (${libraryUrl(ctx)}), or by sending them on a chat app.`, summary: "Empty" };
    const lines = files.map((f) => {
      const status = f.status === "ready" ? pagesLabel(f.kind, f.pages) : f.status === "failed" ? `couldn't be read: ${f.error ?? "unknown reason"}` : "still being read";
      return `- ${f.name} · ${status} · added ${f.createdAt.toISOString().slice(0, 10)}`;
    });
    return { ok: true, content: lines.join("\n"), summary: `${files.length} file${files.length === 1 ? "" : "s"}` };
  },
});

export const searchFilesTool = defineTool({
  name: "search_files",
  title: "Search the Library",
  description:
    "Search the owner's files for passages about something (a topic, a term, a date, an assignment). Returns the best passages with their file and page, so you can quote and cite them. Optionally only in some files.",
  input: z.object({
    query: z.string().trim().min(1).max(300).describe("What to look for, in a few words"),
    files: z.array(z.string().max(200)).max(10).optional().describe("Only these files (names as list_files shows them)"),
  }),
  connectorId: "library",
  capabilityId: "read_files",
  effect: "read",
  risk: "low",
  taints: true,
  summarize: (a) => `Search the Library for “${a.query}”`,
  async run(args, ctx) {
    const ids = args.files?.length ? await fileIds(ctx, args.files) : undefined;
    if (args.files?.length && !ids?.length) return { ok: false, error: `No file called ${args.files.map((f) => `“${f}”`).join(" or ")}. Use list_files to see the names.` };
    const hits = await searchLibrary(ctx.db, ctx.bot.id, args.query, { fileIds: ids, limit: 8 });
    if (!hits.length) {
      const any = (await listFiles(ctx.db, ctx.bot.id)).some((f) => f.status === "ready");
      return { ok: true, content: any ? "Nothing in the Library matches. Try other words, or read_file to read a file from the start." : "The Library is empty.", summary: "No matches" };
    }
    const body = hits.map((h) => `### ${h.fileName} · ${h.label}\n${h.text}`).join("\n\n");
    return { ok: true, content: body, summary: `${hits.length} passage${hits.length === 1 ? "" : "s"}` };
  },
});

export const readFileTool = defineTool({
  name: "read_file",
  title: "Read a file",
  description:
    "Read one of the owner's files, in order: all of it, or some pages (or slides). Long files come in parts; ask for the next part to keep reading. Use it before making flashcards or a quiz from a file.",
  input: z.object({
    file: z.string().trim().min(1).max(200).describe("The file's name, as list_files shows it"),
    from_page: z.number().int().min(1).max(10_000).optional().describe("First page or slide to read"),
    to_page: z.number().int().min(1).max(10_000).optional().describe("Last page or slide to read"),
    part: z.number().int().min(1).max(200).optional().describe("Which part of a long read (default 1)"),
  }),
  connectorId: "library",
  capabilityId: "read_files",
  effect: "read",
  risk: "low",
  taints: true,
  summarize: (a) => `Read “${a.file}”${a.from_page ? ` from page ${a.from_page}` : ""}`,
  async run(args, ctx) {
    const file = await findFile(ctx.db, ctx.bot.id, args.file);
    if (!file) return { ok: false, error: `No file called “${args.file}” in the Library. Use list_files to see the names.` };
    const r = await readPassages(ctx.db, file.id, { from: args.from_page, to: args.to_page, part: args.part });
    if (!r.parts) return { ok: true, content: `Nothing in “${file.name}”${args.from_page ? " on those pages" : ""}.`, summary: file.name };
    const more = r.part < r.parts ? `\n\n(Part ${r.part} of ${r.parts}. Read on with part ${r.part + 1}.)` : r.parts > 1 ? `\n\n(Part ${r.part} of ${r.parts}: the end.)` : "";
    return { ok: true, content: `# ${file.name} (${pagesLabel(file.kind, file.pages)})\n\n${r.text}${more}`, summary: `${file.name}${r.parts > 1 ? ` · part ${r.part} of ${r.parts}` : ""}` };
  },
});

/** Items keep a web link only if it's a page the bot's lookups returned lately (never a made-up one). */
async function linksItRead<T extends { source_url?: string }>(ctx: ToolContext, items: T[]): Promise<{ items: T[]; leftOff: string }> {
  if (!items.some((i) => i.source_url)) return { items, leftOff: "" };
  const read = await pagesReadRecently(ctx.db, ctx.bot.id);
  let dropped = 0;
  const kept = items.map((item) => {
    const link = item.source_url ? sameLink(item.source_url) : null;
    if (!item.source_url || (link && read.has(link))) return item;
    dropped++;
    return { ...item, source_url: undefined };
  });
  const leftOff = dropped
    ? ` Left off ${dropped} link${dropped === 1 ? "" : "s"} that ${dropped === 1 ? "wasn't a page" : "weren't pages"} you looked at; check ${dropped === 1 ? "that answer" : "those answers"} with check_facts to give ${dropped === 1 ? "it" : "them"} a source.`
    : "";
  return { items: kept, leftOff };
}

const SOURCE_HINT =
  "and where it's from: the file and page (source) when it's from their files, or for an answer that isn't, the page you checked it against (source_url, from check_facts or web_search; only pages you looked at are kept)";

const studyReply = (ctx: ToolContext, what: string) =>
  ctx.channelKind === "web"
    ? `${what} The owner sees it as a card they can study right here (and on the Library page). Say what's in it in a sentence and invite them to try it. Don't list the items again.`
    : `${what} On this channel there's no card: offer to go through it here one at a time (ask, wait for their answer, then say if it's right), or to study it at ${libraryUrl(ctx)}.`;

export const makeFlashcardsTool = defineTool({
  name: "make_flashcards",
  title: "Make flashcards",
  description: `Make a set of flashcards (up to ${MAX_CARDS}) the owner can study with spaced repetition. Write them from what you read (read_file or search_files first when it's from their files): one idea per card, the front a short prompt, the back a short exact answer, ${SOURCE_HINT}. Always use this instead of writing flashcards out as text.`,
  input: z.object({
    title: z.string().trim().min(1).max(120).describe('e.g. "Bio 101: Unit 1 cells"'),
    cards: z.array(cardInput).min(1).max(MAX_CARDS),
    files: z.array(z.string().max(200)).max(10).optional().describe("The files they're from"),
  }),
  connectorId: "library",
  capabilityId: "make_study",
  effect: "write",
  risk: "low",
  taints: false,
  // It makes something for the owner to study and reaches no one else.
  ownerOnly: true,
  summarize: (a) => `Make ${a.cards.length} flashcards: “${a.title}”`,
  async run(args, ctx) {
    const { items, leftOff } = await linksItRead(ctx, args.cards);
    const set = await createStudySet(ctx.db, { botId: ctx.bot.id, kind: "flashcards", title: args.title, items, fileIds: await fileIds(ctx, args.files) });
    return {
      ok: true,
      content: studyReply(ctx, `Made “${set.title}”: ${set.items.length} flashcards.${leftOff}`),
      summary: `${set.items.length} flashcards`,
      card: { type: "study_set", set: summarize(set) },
    };
  },
});

export const makeQuizTool = defineTool({
  name: "make_quiz",
  title: "Make a practice quiz",
  description: `Make a practice quiz (up to ${MAX_QUESTIONS} questions) the owner takes one question at a time and gets scored on. Mix multiple choice (3 to 5 choices, the answer one of them word for word), true/false and short answer. Give each an explanation, ${SOURCE_HINT}. Write it from what you read (read_file or search_files first when it's from their files). Always use this instead of writing a quiz out as text.`,
  input: z.object({
    title: z.string().trim().min(1).max(120),
    questions: z.array(questionInput).min(1).max(MAX_QUESTIONS),
    files: z.array(z.string().max(200)).max(10).optional(),
  }),
  connectorId: "library",
  capabilityId: "make_study",
  effect: "write",
  risk: "low",
  taints: false,
  ownerOnly: true,
  summarize: (a) => `Make a ${a.questions.length}-question quiz: “${a.title}”`,
  async run(args, ctx) {
    const { items, leftOff } = await linksItRead(ctx, args.questions);
    const set = await createStudySet(ctx.db, { botId: ctx.bot.id, kind: "quiz", title: args.title, items, fileIds: await fileIds(ctx, args.files) });
    return {
      ok: true,
      content: studyReply(ctx, `Made “${set.title}”: a ${set.items.length}-question quiz.${leftOff}`),
      summary: `${set.items.length} questions`,
      card: { type: "study_set", set: summarize(set) },
    };
  },
});

export const studyProgressTool = defineTool({
  name: "study_progress",
  title: "Check study progress",
  description: "See how the owner is doing: flashcards due for review, the cards they miss most, and recent quiz scores. Use it to plan a review or before a check-in.",
  input: z.object({}),
  connectorId: "library",
  capabilityId: "read_files",
  effect: "read",
  risk: "low",
  taints: false,
  summarize: () => "Check study progress",
  async run(_a, ctx) {
    const s = await studyStatus(ctx.db, ctx.bot.id);
    if (!s.sets.length) return { ok: true, content: "No flashcards or quizzes yet.", summary: "Nothing yet" };
    const lines = [
      `Flashcards due now: ${s.due}${s.due ? ` (study them at ${libraryUrl(ctx)})` : ""}.`,
      s.sets.length ? `Sets:\n${s.sets.map(({ set, due }) => `- ${set.title} (${set.kind === "quiz" ? `quiz, ${set.items.length} questions` : `${set.items.length} cards, ${due} due`})`).join("\n")}` : "",
      s.weak.length ? `Most missed cards:\n${s.weak.map((w) => `- ${w.front} (${w.set}, missed ${w.missed}×)`).join("\n")}` : "",
      s.quizzes.length ? `Recent quizzes:\n${s.quizzes.map((q) => `- ${q.set}: ${q.score}/${q.total} on ${q.at.slice(0, 10)}`).join("\n")}` : "",
    ];
    return { ok: true, content: lines.filter(Boolean).join("\n\n"), summary: `${s.due} due` };
  },
});

export const libraryTools = [listFilesTool, searchFilesTool, readFileTool, makeFlashcardsTool, makeQuizTool, studyProgressTool];
