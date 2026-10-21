/**
 * The tutor checks its work with Tavily, against the student's course first:
 *
 * - find_course_sources finds the course online once (its pages on the school's site, and open
 *   textbooks that cover its subject) and keeps them in a note the student can see and edit;
 * - check_facts checks short claims, one Tavily search each, preferring the course's sites and open
 *   textbooks and skipping homework-answer sites, and sends nothing but the claims;
 * - every search is a lookup: charged at Tavily's price and counted against the site's daily limit,
 *   and a check that would go past the limit doesn't run;
 * - flashcards and quizzes can cite a web page as an answer's source, but only a page the bot
 *   looked at; Activity lists the pages each lookup returned;
 * - the tutor is told to do all this, and that the course is what the student is graded on.
 *
 * A fake Tavily stands in, answering from a small made-up web.
 */
import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, like } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "0";
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.TAVILY_API_KEY = "tvly-test";
for (const name of ["DATABASE_URL", "TOKEN_FACTORY_API_KEY", "STRIPE_SECRET_KEY", "SEARCH_DAILY_LIMIT", "STARTER_CREDIT_USD"]) delete process.env[name];

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { buildToolset } = await import("@/lib/tools/registry");
const { executeToolCall, newRunState } = await import("@/lib/agent/run");
const { buildStablePrompt } = await import("@/lib/agent/prompt");
const { getUsage } = await import("@/lib/billing/usage");
const { UNIT_PRICES } = await import("@/lib/billing/prices");
const { BUILTIN_TOOLS } = await import("@/lib/tools/builtin");
import type { Bot, StudyCard, QuizQuestion, User } from "@/lib/db/schema";
import type { ToolContext } from "@/lib/tools/types";

let db: Awaited<ReturnType<typeof getDb>>;
let dana: User;
let tutor: Bot;

const COURSE_PAGE = "https://bio.tamu.edu/courses/biol-111/";
const CATALOG_PAGE = "https://catalog.tamu.edu/undergraduate/course-descriptions/biol/";
const OPEN_BOOK = "https://openstax.org/details/books/biology-2e";
const OPENSTAX_CELLS = "https://openstax.org/books/biology-2e/pages/4-3-eukaryotic-cells";
const COURSE_NOTES = "https://bio.tamu.edu/courses/biol-111/notes/respiration";

type Result = { title: string; url: string; content: string };
/** What the made-up web has, by what's asked. */
function fakeWeb(query: string): { answer?: string; results: Result[] } {
  if (/BIOL 111/.test(query))
    return {
      results: [
        { title: "BIOL 111 Introductory Biology | Department of Biology", url: COURSE_PAGE, content: "Syllabus, schedule and lecture notes for BIOL 111." },
        { title: "BIOL 111 flashcards", url: "https://quizlet.com/123456/biol-111-flash-cards/", content: "Study sets made by students." },
        { title: "BIOL - Biology < Texas A&M Catalog", url: CATALOG_PAGE, content: "BIOL 111 Introductory Biology I. Credits 4." },
      ],
    };
  if (/^Introductory Biology$/.test(query)) return { results: [{ title: "Biology 2e | OpenStax", url: OPEN_BOOK, content: "A free, peer-reviewed biology textbook." }] };
  return {
    answer: "Yes. Mitochondria make most of a cell's ATP through cellular respiration.",
    results: [
      { title: "4.3 Eukaryotic Cells - Biology 2e | OpenStax", url: OPENSTAX_CELLS, content: "Mitochondria are the sites of cellular respiration, where most ATP is made." },
      { title: "Cellular respiration (lecture notes)", url: COURSE_NOTES, content: "Lecture 9: oxidative phosphorylation makes most of the ATP." },
      { title: "Mitochondria answers", url: "https://www.chegg.com/homework-help/questions-and-answers/mitochondria", content: "Expert answer." },
    ],
  };
}

type TavilyCall = { path: string; body: Record<string, unknown>; auth: string | null };
let tavily: TavilyCall[] = [];
/** Answers like Tavily; `fail` makes some searches fail. */
function stubTavily(fail: (body: Record<string, unknown>) => boolean = () => false) {
  tavily = [];
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit) => {
    const u = String(url);
    if (!u.startsWith("https://api.tavily.com/")) throw new Error(`unexpected fetch: ${u}`);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    tavily.push({ path: u.slice("https://api.tavily.com".length), body, auth: new Headers(init.headers).get("authorization") });
    if (fail(body)) return new Response("busy", { status: 503 });
    return Response.json(fakeWeb(String(body.query)));
  });
}

function ctxFor(bot: Bot): ToolContext {
  return { db, bot, owner: dana, conversationId: null, channelKind: "web", demo: false, now: new Date() };
}

/** A tool call as a turn makes it: through the policy engine, paid-lookup checks and receipts. */
async function use(bot: Bot, name: string, args: Record<string, unknown>) {
  const ctx = ctxFor(bot);
  const toolset = await buildToolset(ctx);
  if (!toolset.byName.has(name)) throw new Error(`${bot.name} doesn't have ${name}`);
  return executeToolCall({ id: `call_${crypto.randomUUID()}`, name, args, argsText: JSON.stringify(args) }, toolset, ctx, newRunState(), () => {}, "web");
}

async function spent() {
  const u = await getUsage(db, dana.id);
  return { costMicros: u.costMicros, searches: u.searches };
}

async function makeBot(name: string, connectors: string[], jobs: string[] = ["school"]): Promise<Bot> {
  const made = await createBot(db, dana, {
    avatar: "otto",
    color: "grape",
    name,
    role: "tutor",
    jobs,
    brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
    connectors,
    trust: "ask",
    channels: [],
    contact: {},
    ageConfirmed: true,
    timezone: "UTC",
  } as never);
  if (!made.ok) throw new Error(made.error);
  return made.bot;
}

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [dana] = await db.insert(schema.users).values({ id: "usr_dana", email: "dana@example.com", name: "Dana Diaz", emailVerifiedAt: new Date(), timezone: "UTC" }).returning();
  tutor = await makeBot("Otto", ["web_search", "notes"]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SEARCH_DAILY_LIMIT;
});

afterAll(async () => {
  await resetDbForTests();
});

describe("finding the course online", () => {
  it("searches for the course and for open textbooks on its subject, and keeps what it finds in a note", async () => {
    stubTavily();
    const before = await spent();
    const out = await use(tutor, "find_course_sources", { course: "BIOL 111 Introductory Biology", school: "Texas A&M University", textbook: "Campbell Biology, 12th edition", instructor: "Dr. Rivera" });
    expect(out.isError).toBeFalsy();

    expect(tavily.map((c) => c.path)).toEqual(["/search", "/search"]);
    expect(tavily.every((c) => c.auth === "Bearer tvly-test")).toBe(true);
    const [course, open] = tavily.map((c) => c.body);
    // The course by its name, school and instructor. (Tavily refuses a "*.edu" filter, so there's none.)
    expect(course).toMatchObject({ search_depth: "basic" });
    expect(course.include_domains).toBeUndefined();
    expect(String(course.query)).toMatch(/BIOL 111 Introductory Biology/);
    expect(String(course.query)).toMatch(/Texas A&M University/);
    expect(String(course.query)).toMatch(/Dr\. Rivera/);
    // Neither homework-answer sites nor pirated-book sites.
    expect(course.exclude_domains).toEqual(expect.arrayContaining(["quizlet.com", "chegg.com", "coursehero.com", "dokumen.pub"]));
    // Open textbooks on the course's subject, from open-textbook sites only.
    expect(open).toMatchObject({ query: "Introductory Biology" });
    expect(open.include_domains).toEqual(expect.arrayContaining(["openstax.org", "libretexts.org", "ocw.mit.edu"]));
    expect(open.include_domains_mode).toBeUndefined();
    // The textbook stays in the note; it isn't searched for.
    expect(tavily.some((c) => /Campbell/.test(String(c.body.query)))).toBe(false);

    const [note] = await db.select().from(schema.notes).where(and(eq(schema.notes.botId, tutor.id), eq(schema.notes.title, "Course: BIOL 111 Introductory Biology")));
    expect(note.body).toContain(COURSE_PAGE);
    expect(note.body).toContain(CATALOG_PAGE);
    expect(note.body).toContain(OPEN_BOOK);
    expect(note.body).toContain("School: Texas A&M University");
    expect(note.body).toContain("Instructor: Dr. Rivera");
    expect(note.body).toContain("Textbook: Campbell Biology, 12th edition");
    // Homework-answer sites aren't sources, even when a search returns one.
    expect(note.body).not.toContain("quizlet.com");
    expect(out.content).toContain("Course: BIOL 111 Introductory Biology");

    // Two searches: two lookups, at Tavily's price.
    expect(await spent()).toEqual({ costMicros: before.costMicros + 2 * UNIT_PRICES.lookup, searches: before.searches + 2 });
  });

  it("finding the course again replaces its note", async () => {
    stubTavily();
    const before = await spent();
    await use(tutor, "find_course_sources", { course: "BIOL 111 Introductory Biology", school: "Texas A&M University" });
    expect(tavily).toHaveLength(2);
    const notes = await db.select().from(schema.notes).where(and(eq(schema.notes.botId, tutor.id), eq(schema.notes.title, "Course: BIOL 111 Introductory Biology")));
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain(COURSE_PAGE);
    expect(notes[0].body).not.toContain("Textbook:");
    expect(notes[0].body).not.toContain("Instructor:");
    expect(await spent()).toEqual({ costMicros: before.costMicros + 2 * UNIT_PRICES.lookup, searches: before.searches + 2 });
  });

  it("a search that fails is left out of the note and isn't charged", async () => {
    stubTavily((body) => Array.isArray(body.include_domains));
    const before = await spent();
    const out = await use(tutor, "find_course_sources", { course: "BIOL 111 Introductory Biology", school: "Texas A&M University" });
    expect(out.isError).toBeFalsy();
    const [note] = await db.select().from(schema.notes).where(and(eq(schema.notes.botId, tutor.id), eq(schema.notes.title, "Course: BIOL 111 Introductory Biology")));
    expect(note.body).toContain(COURSE_PAGE);
    expect(note.body).not.toContain(OPEN_BOOK);
    expect(await spent()).toEqual({ costMicros: before.costMicros + UNIT_PRICES.lookup, searches: before.searches + 1 });
  });
});

describe("checking facts", () => {
  it("checks each claim with its own search, preferring the course's sites and open textbooks", async () => {
    stubTavily();
    const before = await spent();
    const claims = ["Mitochondria make most of a cell's ATP", "The nucleus stores the cell's DNA"];
    const out = await use(tutor, "check_facts", { claims });
    expect(out.isError).toBeFalsy();

    expect(tavily).toHaveLength(2);
    for (const [i, call] of tavily.entries()) {
      // Only the claim goes out: nothing from the student's files or the chat.
      expect(call.body.query).toBe(claims[i]);
      expect(Object.keys(call.body).sort()).toEqual(["exclude_domains", "include_answer", "include_domains", "include_domains_mode", "max_results", "query", "search_depth", "topic"]);
      expect(call.body).toMatchObject({ search_depth: "basic", include_domains_mode: "prefer" });
      // The course's own sites (from the note) and open textbooks first.
      expect(call.body.include_domains).toEqual(expect.arrayContaining(["bio.tamu.edu", "catalog.tamu.edu", "openstax.org"]));
      expect(call.body.exclude_domains).toEqual(expect.arrayContaining(["chegg.com"]));
    }

    const text = out.content;
    expect(text).toContain(`Claim 1: "${claims[0]}"`);
    expect(text).toContain(`Claim 2: "${claims[1]}"`);
    expect(text).toMatch(/\[1\] 4\.3 Eukaryotic Cells - Biology 2e \| OpenStax \(openstax\.org, open textbook\)/);
    expect(text).toMatch(/\(bio\.tamu\.edu, your course's site\)/);
    // Sources are numbered across claims, for citing.
    expect(text).toMatch(/\[4\] Cellular respiration/);
    // A homework-answer site that slips through isn't shown.
    expect(text).not.toContain("chegg.com");
    // The course is what they're graded on.
    expect(text).toMatch(/keep the class's version/);

    expect(await spent()).toEqual({ costMicros: before.costMicros + 2 * UNIT_PRICES.lookup, searches: before.searches + 2 });
  });

  it("sends only short claims, a few at a time", async () => {
    stubTavily();
    const long = await use(tutor, "check_facts", { claims: ["x".repeat(301)] });
    expect(long.isError).toBe(true);
    const many = await use(tutor, "check_facts", { claims: Array.from({ length: 9 }, (_, i) => `Fact number ${i + 1}`) });
    expect(many.isError).toBe(true);
    expect(tavily).toEqual([]);
  });

  it("a search that fails is said so and isn't charged", async () => {
    stubTavily((body) => body.query === "The nucleus stores the cell's DNA");
    const before = await spent();
    const out = await use(tutor, "check_facts", { claims: ["Mitochondria make most of a cell's ATP", "The nucleus stores the cell's DNA"] });
    expect(out.isError).toBeFalsy();
    expect(out.content).toMatch(/Claim 2: "The nucleus stores the cell's DNA"\nCouldn't check this one/);
    expect(await spent()).toEqual({ costMicros: before.costMicros + UNIT_PRICES.lookup, searches: before.searches + 1 });
  });

  it("counts every claim against the site's daily limit, and a check that would go past it doesn't run", async () => {
    stubTavily();
    // A fresh day with room for five lookups (a ceiling too small to be shared out between accounts).
    await db.delete(schema.rateLimits).where(like(schema.rateLimits.key, "ceiling:search%"));
    process.env.SEARCH_DAILY_LIMIT = "5";
    expect((await use(tutor, "check_facts", { claims: ["Fact one", "Fact two"] })).isError).toBeFalsy();
    const before = await spent();
    const refused = await use(tutor, "check_facts", { claims: ["Fact three", "Fact four", "Fact five", "Fact six"] });
    expect(refused.content).toMatch(/today's limit for everyone/);
    expect(tavily).toHaveLength(2);
    expect(await spent()).toEqual(before);
    // What didn't run isn't counted: the three lookups left are still there.
    expect((await use(tutor, "check_facts", { claims: ["Fact seven", "Fact eight", "Fact nine"] })).isError).toBeFalsy();
    expect(tavily).toHaveLength(5);
  });

  it("Activity lists the pages a lookup returned", async () => {
    stubTavily();
    await use(tutor, "check_facts", { claims: ["Ribosomes make proteins"] });
    const receipts = await db.select().from(schema.receipts).where(and(eq(schema.receipts.botId, tutor.id), eq(schema.receipts.kind, "tool")));
    const last = receipts.filter((r) => r.detail.tool === "check_facts").at(-1)!;
    expect(last.detail.sources).toEqual([OPENSTAX_CELLS, COURSE_NOTES]);
  });
});

describe("where each answer came from", () => {
  it("a card can cite a page the bot looked at; a link it didn't look at is left off", async () => {
    stubTavily();
    await use(tutor, "check_facts", { claims: ["Mitochondria make most of a cell's ATP"] });
    const out = await use(tutor, "make_flashcards", {
      title: "Cells",
      cards: [
        { front: "Where is most ATP made?", back: "In the mitochondria", source: "OpenStax Biology 2e, 4.3", source_url: OPENSTAX_CELLS },
        { front: "What do ribosomes make?", back: "Proteins", source_url: "https://made-up.example/ribosomes" },
        { front: "When is the midterm?", back: "October 28", source: "Bio 101 Syllabus.pdf, page 1" },
      ],
    });
    expect(out.isError).toBeFalsy();
    expect(out.content).toMatch(/Left off 1 link/);
    const [set] = await db.select().from(schema.studySets).where(and(eq(schema.studySets.botId, tutor.id), eq(schema.studySets.title, "Cells")));
    const cards = set.items as StudyCard[];
    expect(cards[0]).toMatchObject({ source: "OpenStax Biology 2e, 4.3", sourceUrl: OPENSTAX_CELLS });
    expect(cards[1].sourceUrl).toBeUndefined();
    expect(cards[2]).toMatchObject({ source: "Bio 101 Syllabus.pdf, page 1" });
    expect(cards[2].sourceUrl).toBeUndefined();
  });

  it("a quiz answer can cite one too, and only a web link (never a script) is taken", async () => {
    stubTavily();
    await use(tutor, "check_facts", { claims: ["Mitochondria make most of a cell's ATP"] });
    const bad = await use(tutor, "make_quiz", {
      title: "Bad",
      questions: [{ type: "short_answer", question: "Where is ATP made?", answer: "Mitochondria", source_url: "javascript:alert(1)" }],
    });
    expect(bad.isError).toBe(true);
    const out = await use(tutor, "make_quiz", {
      title: "Cells quiz",
      questions: [{ type: "true_false", question: "Mitochondria make most of a cell's ATP.", answer: "True", explanation: "Cellular respiration happens there.", source_url: COURSE_NOTES }],
    });
    expect(out.isError).toBeFalsy();
    const [set] = await db.select().from(schema.studySets).where(and(eq(schema.studySets.botId, tutor.id), eq(schema.studySets.title, "Cells quiz")));
    expect((set.items as QuizQuestion[])[0]).toMatchObject({ sourceUrl: COURSE_NOTES });
  });
});

describe("who gets these tools", () => {
  it("they come with web search, so they're only offered where Tavily is set up and the owner picked it", async () => {
    expect(BUILTIN_TOOLS.web_search.map((t) => t.name)).toEqual(expect.arrayContaining(["web_search", "check_facts", "find_course_sources"]));
    // (The School job brings web search along, so this bot has no job.)
    const noWeb = await makeBot("Quiet", ["notes"], []);
    const toolset = await buildToolset(ctxFor(noWeb));
    expect(toolset.byName.has("check_facts")).toBe(false);
    expect(toolset.byName.has("find_course_sources")).toBe(false);
  });

  it("the tutor is told to find the course, check what it makes, and go with the class for exams", () => {
    const prompt = buildStablePrompt(tutor, dana, "web", null);
    expect(prompt).toContain("find_course_sources");
    expect(prompt).toMatch(/check every answer that isn't from their files against the web \(check_facts\)/);
    expect(prompt).toMatch(/what they're graded on/);
  });
});
