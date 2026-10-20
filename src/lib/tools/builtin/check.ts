/**
 * Checking study material against the web with Tavily, the student's course first.
 *
 * - find_course_sources: from a syllabus (course, school, instructor, textbook), finds the course's
 *   own pages and open textbooks on its subject, and keeps them in a note ("Course: …") the owner
 *   can see and edit. (A search for the textbook's errata was tried and dropped: Tavily returned
 *   spam and pirated-book sites for it.)
 * - check_facts: one search per short claim, preferring the course's sites (from those notes) and
 *   open textbooks, and leaving out homework-answer sites. Only the claims go to Tavily, never the
 *   owner's files.
 *
 * Every search is a paid lookup: agent/run.ts counts and charges them. The course is what the
 * student is graded on, so the bot shows where the web disagrees; it doesn't overrule the class.
 */
import { z } from "zod";
import { and, eq, like } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import { config } from "@/lib/env";
import { newId, truncate } from "@/lib/utils";
import { defineTool, type ToolOutput, type ToolSource } from "../types";
import { tavilySearch, type TavilyResult, type TavilySearchOptions } from "./web";

/** Free, reviewed textbooks and course materials. */
export const OPEN_TEXTBOOK_DOMAINS = ["openstax.org", "libretexts.org", "ocw.mit.edu", "khanacademy.org", "open.umn.edu"];
/** Homework-answer and flashcard sites (what students post, not sources), and pirated-book sites. */
export const UNRELIABLE_DOMAINS = [
  "chegg.com",
  "coursehero.com",
  "quizlet.com",
  "studocu.com",
  "brainly.com",
  "scribd.com",
  "ratemyprofessors.com",
  "dokumen.pub",
  "pdfcoffee.com",
  "vdoc.pub",
  "ebin.pub",
  "epdf.pub",
];

export const MAX_CLAIMS = 8;
/** Notes whose title starts with this hold a course's sites. */
export const COURSE_NOTE_PREFIX = "Course: ";
/** Tavily works best with short domain lists. */
const MAX_PREFERRED = 20;

type Found = { answer?: string; results: TavilyResult[] };

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

const onDomain = (host: string, domains: string[]) => domains.some((d) => host === d || host.endsWith(`.${d}`));
const reliable = (r: TavilyResult) => {
  const host = hostOf(r.url);
  return host !== null && !onDomain(host, UNRELIABLE_DOMAINS);
};

/** The sites in the owner's "Course: …" notes (find_course_sources writes them; the owner can add their own). */
export async function courseSites(db: Db, botId: string): Promise<string[]> {
  const rows = await db
    .select({ body: schema.notes.body })
    .from(schema.notes)
    .where(and(eq(schema.notes.botId, botId), like(schema.notes.title, `${COURSE_NOTE_PREFIX}%`)))
    .limit(10);
  const sites = new Set<string>();
  for (const { body } of rows) {
    for (const m of body.matchAll(/https?:\/\/[^\s<>)"']+/g)) {
      const host = hostOf(m[0]);
      if (host && !onDomain(host, UNRELIABLE_DOMAINS)) sites.add(host);
    }
  }
  return [...sites];
}

function demoFound(query: string): Found {
  return {
    answer: `Demo mode: live search isn't connected yet, so these are placeholder sources for "${query}". Add a TAVILY_API_KEY to search the real web.`,
    results: [{ title: `${query}: overview`, url: `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(query)}`, content: `A general overview of ${query}. (Demo result.)` }],
  };
}

/** What the model reads: each claim's sources, numbered across claims so it can cite them. */
function checkReport(items: { claim: string; found: Found | null }[], course: string[]): Extract<ToolOutput, { ok: true }> {
  const sources: ToolSource[] = [];
  const blocks = items.map(({ claim, found }, i) => {
    const head = `Claim ${i + 1}: "${claim}"`;
    if (!found) return `${head}\nCouldn't check this one: the search didn't answer.`;
    const results = found.results.filter(reliable).slice(0, 3);
    if (!results.length) return `${head}\nNo sources found.`;
    const lines = results.map((r) => {
      sources.push({ title: r.title, url: r.url });
      const host = hostOf(r.url)!;
      const tag = onDomain(host, OPEN_TEXTBOOK_DOMAINS) ? ", open textbook" : onDomain(host, course) ? ", your course's site" : "";
      return `[${sources.length}] ${r.title} (${host}${tag})\n${r.url}\n${truncate(r.content ?? "", 400)}`;
    });
    return [head, found.answer ? `Summary: ${truncate(found.answer, 400)}` : "", ...lines].filter(Boolean).join("\n");
  });
  return {
    ok: true,
    content:
      `${blocks.join("\n\n")}\n\n` +
      "For each claim, say whether these sources back it up, contradict it, or don't settle it, citing them as [n] with links. " +
      "If a claim came from their class materials and the sources disagree, keep the class's version for exams and tell them what the sources say.",
    summary: `${items.length} claim${items.length === 1 ? "" : "s"} checked`,
    sources,
  };
}

export const checkFacts = defineTool({
  name: "check_facts",
  title: "Check facts",
  description:
    `Check short claims against the web with Tavily, one search each, preferring the course's own sites (from "Course: …" notes) and open textbooks. ` +
    "Use it before putting an answer that isn't from the owner's files into flashcards or a quiz, and when they ask whether their notes or an answer are right. " +
    `Each claim is one self-contained fact in your own words (up to ${MAX_CLAIMS}); never paste passages from their files. It returns sources for each claim, and you judge whether they back it up.`,
  input: z.object({
    claims: z
      .array(z.string().trim().min(3).max(300))
      .min(1)
      .max(MAX_CLAIMS)
      .describe("One fact each, e.g. \"Mitochondria make most of a cell's ATP\""),
  }),
  connectorId: "web_search",
  capabilityId: "search",
  effect: "read",
  risk: "low",
  taints: true,
  summarize: (a) => `Check ${a.claims.length === 1 ? "a fact" : `${a.claims.length} facts`}: “${truncate(a.claims[0], 60)}”${a.claims.length > 1 ? " and more" : ""}`,
  async run(args, ctx) {
    if (!config.tavily.apiKey) {
      if (!ctx.demo) return { ok: false, error: "Checking facts on the web is coming soon. Say which parts you're unsure of instead." };
      return checkReport(args.claims.map((claim) => ({ claim, found: demoFound(claim) })), []);
    }
    const course = await courseSites(ctx.db, ctx.bot.id);
    const prefer = [...new Set([...course, ...OPEN_TEXTBOOK_DOMAINS])].slice(0, MAX_PREFERRED);
    const items = await Promise.all(
      args.claims.map(async (claim) => {
        try {
          const found = await tavilySearch(claim, { maxResults: 3, includeDomains: prefer, includeDomainsMode: "prefer", excludeDomains: UNRELIABLE_DOMAINS, signal: ctx.signal });
          return { claim, found };
        } catch {
          return { claim, found: null };
        }
      }),
    );
    const lookups = items.filter((i) => i.found).length;
    if (!lookups) return { ok: false, error: "Couldn't reach the web to check these. Try again in a moment." };
    return { ...checkReport(items, course), lookups };
  },
});

/** "BIOL 111 Introductory Biology" → "Introductory Biology". */
function subjectOf(course: string): string {
  return course.replace(/^[A-Za-z&]{2,6}\s*-?\s*\d{2,4}[A-Za-z]?\s*[:\-–]?\s*/, "").trim() || course;
}

const GROUP_LABEL = { course: "The course", open: "Open textbooks on the subject" } as const;

export const findCourseSources = defineTool({
  name: "find_course_sources",
  title: "Find the course online",
  description:
    "Find a class online once, from its syllabus: its pages on the school's site, and open textbooks that cover its subject. " +
    'It saves them in a note called "Course: <course>" the owner can see and edit, and check_facts then prefers those sites. ' +
    "Use it when they share a syllabus or name a class you haven't looked up yet, not again for the same class.",
  input: z.object({
    course: z.string().trim().min(2).max(100).describe('Its code and name, as on the syllabus: "BIOL 111 Introductory Biology"'),
    school: z.string().trim().min(2).max(100).describe('"Texas A&M University"'),
    textbook: z.string().trim().min(2).max(160).optional().describe("The required textbook: title, edition, authors"),
    instructor: z.string().trim().min(2).max(80).optional(),
  }),
  connectorId: "web_search",
  capabilityId: "search",
  effect: "write",
  risk: "low",
  taints: true,
  // It keeps a note for the owner and reaches no one else.
  ownerOnly: true,
  summarize: (a) => `Find ${a.course} online`,
  async run(args, ctx) {
    const live = Boolean(config.tavily.apiKey);
    if (!live && !ctx.demo) return { ok: false, error: "Looking up a course online is coming soon." };
    // Two searches: the course itself (its name and school find the catalog and department pages;
    // Tavily refuses a "*.edu" filter), and open textbooks on its subject.
    const plan: { kind: keyof typeof GROUP_LABEL; query: string; opts: TavilySearchOptions; keep: number }[] = [
      { kind: "course", query: `${[args.course, args.school, args.instructor].filter(Boolean).join(" ")} course`, opts: { maxResults: 5, excludeDomains: UNRELIABLE_DOMAINS }, keep: 3 },
      { kind: "open", query: subjectOf(args.course), opts: { maxResults: 3, includeDomains: OPEN_TEXTBOOK_DOMAINS }, keep: 3 },
    ];
    const searched = await Promise.all(
      plan.map(async (p) => {
        if (!live) return { ...p, found: demoFound(p.query) };
        try {
          return { ...p, found: (await tavilySearch(p.query, { ...p.opts, signal: ctx.signal })) as Found | null };
        } catch {
          return { ...p, found: null };
        }
      }),
    );
    const lookups = live ? searched.filter((s) => s.found).length : 0;
    if (live && !lookups) return { ok: false, error: "Couldn't reach the web to look the course up. Try again in a moment." };

    const seen = new Set<string>();
    const groups = searched.map((s) => {
      const links: TavilyResult[] = [];
      for (const r of (s.found?.results ?? []).filter(reliable)) {
        if (links.length >= s.keep || seen.has(r.url)) continue;
        seen.add(r.url);
        links.push(r);
      }
      return { kind: s.kind, links };
    });
    const sources: ToolSource[] = groups.flatMap((g) => g.links.map((l) => ({ title: l.title, url: l.url })));
    const paid = lookups ? { lookups } : {};
    if (!sources.length) {
      return { ok: true, content: `Found nothing reliable for ${args.course} online. check_facts will still prefer open textbooks.`, summary: "Nothing found", ...paid };
    }

    const title = truncate(`${COURSE_NOTE_PREFIX}${args.course}`, 120);
    const body = [
      `Found online with Tavily on ${ctx.now.toISOString().slice(0, 10)}. Fact checks prefer these sites; add or remove links any time.`,
      `School: ${args.school}`,
      ...(args.instructor ? [`Instructor: ${args.instructor}`] : []),
      ...(args.textbook ? [`Textbook: ${args.textbook}`] : []),
      ...groups.filter((g) => g.links.length).flatMap((g) => ["", `${GROUP_LABEL[g.kind]}:`, ...g.links.map((l) => `- ${truncate(l.title, 120)}: ${l.url}`)]),
    ].join("\n");
    await ctx.db
      .insert(schema.notes)
      .values({ id: newId("note"), botId: ctx.bot.id, title, body })
      .onConflictDoUpdate({ target: [schema.notes.botId, schema.notes.title], set: { body, updatedAt: new Date() } });
    return {
      ok: true,
      content: `Saved in the note “${title}”:\n\n${body}\n\nTell them what you found in a sentence or two. check_facts now prefers these sites. If you can read web pages, read one when you need what's on it (the schedule, the topics).`,
      summary: `${sources.length} source${sources.length === 1 ? "" : "s"} for ${args.course}`,
      sources,
      ...paid,
    };
  },
});
