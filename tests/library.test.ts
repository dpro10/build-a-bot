/**
 * The Library: files the owner gives a bot, read once into passages with their page, searched,
 * and turned into flashcards and quizzes.
 *
 * - Reading: what a file really is (from its bytes), PDFs page by page (scans through the vision
 *   model), Word with headings, lists, tables and page breaks, PowerPoint slides in the deck's order
 *   with speaker notes, text and HTML; damaged, locked and unsupported files say why.
 * - Storing: limits (25 MB a file, 500 MB an owner), the same bytes twice, each owner's files kept
 *   to their own bots, deleting a file (and its bot's whole Library).
 * - Search: stemming, any-word and plain-text fallbacks, page labels, reading in parts.
 * - The tools, and a whole turn on the demo brain: "make flashcards from <file>" reads it and makes
 *   a set, shown as a card with the reply.
 * - Study sets: spaced repetition, quiz attempts, CSV, and the routes the web app uses.
 */
import fs from "node:fs";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
for (const key of ["TOKEN_FACTORY_API_KEY", "TAVILY_API_KEY", "COMPOSIO_API_KEY"]) delete process.env[key];

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => session.user,
}));
const background = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => void background.push(Promise.resolve().then(fn)),
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { sniff } = await import("@/lib/library/read/sniff");
const { readDocx, readPptx } = await import("@/lib/library/read/office");
const { readFileBytes, htmlText } = await import("@/lib/library/read");
const { encodePng } = await import("@/lib/library/read/png");
const lib = await import("@/lib/library");
const { searchLibrary, readPassages } = await import("@/lib/library/search");
const study = await import("@/lib/library/study");
const { withFiles } = await import("@/lib/library/attachments");
const { libraryTools } = await import("@/lib/tools/builtin/library");
const { runTurn } = await import("@/lib/agent/run");
const { ensureConversation } = await import("@/lib/channels/outbound");
const { getUsage } = await import("@/lib/billing/usage");
const filesRoute = await import("@/app/api/bots/[botId]/files/route");
const fileRoute = await import("@/app/api/bots/[botId]/files/[fileId]/route");
const readRoute = await import("@/app/api/bots/[botId]/files/[fileId]/read/route");
const contentRoute = await import("@/app/api/bots/[botId]/files/[fileId]/content/route");
const setRoute = await import("@/app/api/bots/[botId]/study-sets/[setId]/route");
const reviewRoute = await import("@/app/api/bots/[botId]/study-sets/[setId]/review/route");
const attemptRoute = await import("@/app/api/bots/[botId]/study-sets/[setId]/attempt/route");
const exportRoute = await import("@/app/api/bots/[botId]/study-sets/[setId]/export/route");
const chatRoute = await import("@/app/api/bots/[botId]/chat/route");
import type { AgentEvent } from "@/lib/agent/run";
import type { Bot, User } from "@/lib/db/schema";
import type { AnyToolSpec, ToolContext } from "@/lib/tools/types";

const FIXTURES = path.join(process.cwd(), "tests", "fixtures", "library");
const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;
let other: User;
let bot: Bot;
let otherBot: Bot;

async function makeBot(user: User, name: string): Promise<Bot> {
  const res = await createBot(db, user, {
    avatar: "otto",
    color: "grape",
    name,
    role: "tutor",
    jobs: [],
    brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
    connectors: [],
    trust: "ask",
    channels: [],
    contact: {},
    ageConfirmed: true,
    timezone: "UTC",
  } as never);
  if (!res.ok) throw new Error(res.error);
  return res.bot;
}

function ctxFor(b: Bot, channelKind = "web"): ToolContext {
  return { db, bot: b, owner, conversationId: null, channelKind, demo: true, now: new Date() };
}

const tool = (name: string): AnyToolSpec => libraryTools.find((t) => t.name === name)! as unknown as AnyToolSpec;

// ---------------------------------------------------------------------------
// Office files, built here so it's clear what's in them

function docx(bodyXml: string, footnotes?: string): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(`<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${bodyXml}</w:body></w:document>`),
    ...(footnotes ? { "word/footnotes.xml": strToU8(`<w:footnotes>${footnotes}</w:footnotes>`) } : {}),
  });
}
const para = (text: string, opts: { style?: string; list?: boolean; pageBreakBefore?: boolean } = {}) =>
  `<w:p><w:pPr>${opts.style ? `<w:pStyle w:val="${opts.style}"/>` : ""}${opts.list ? "<w:numPr><w:ilvl w:val=\"0\"/></w:numPr>" : ""}</w:pPr><w:r>${opts.pageBreakBefore ? "<w:lastRenderedPageBreak/>" : ""}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

function pptx(slides: { title: string; bullets: string[]; notes?: string }[], order: number[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8("<Types/>"),
    "ppt/presentation.xml": strToU8(`<p:presentation><p:sldIdLst>${order.map((n, i) => `<p:sldId id="${256 + i}" r:id="rId${n}"/>`).join("")}</p:sldIdLst></p:presentation>`),
    "ppt/_rels/presentation.xml.rels": strToU8(`<Relationships>${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>`),
  };
  slides.forEach((s, i) => {
    const n = i + 1;
    files[`ppt/slides/slide${n}.xml`] = strToU8(
      `<p:sld><p:cSld><p:spTree>` +
        `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${s.title}</a:t></a:r></a:p></p:txBody></p:sp>` +
        `<p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody>${s.bullets.map((b) => `<a:p><a:r><a:t>${b}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp>` +
        `<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${n}</a:t></a:r></a:p></p:txBody></p:sp>` +
        `</p:spTree></p:cSld></p:sld>`,
    );
    if (s.notes) {
      files[`ppt/slides/_rels/slide${n}.xml.rels`] = strToU8(`<Relationships><Relationship Id="rId9" Target="../notesSlides/notesSlide${n}.xml"/></Relationships>`);
      files[`ppt/notesSlides/notesSlide${n}.xml`] = strToU8(
        `<p:notes><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${s.notes}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
      );
    }
  });
  return zipSync(files);
}

const SYLLABUS_DOCX = docx(
  para("Biology 101", { style: "Title" }) +
    para("Unit 1: Cells", { style: "Heading1" }) +
    para("Mitochondria: the powerhouse of the cell, where ATP is made") +
    para("Read chapter 3", { list: true }) +
    `<w:tbl><w:tr><w:tc>${para("Midterm")}</w:tc><w:tc>${para("October 28")}</w:tc></w:tr></w:tbl>` +
    para("Unit 2: Genetics", { style: "Heading1", pageBreakBefore: true }) +
    para("DNA: a double helix that carries genes &amp; traits"),
  `<w:footnote w:id="0"><w:p><w:r><w:t>sep</w:t></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:t>Office hours: Tuesdays</w:t></w:r></w:p></w:footnote>`,
);

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner] = await db.insert(schema.users).values({ id: "usr_dana", email: "dana@example.com", name: "Dana", emailVerifiedAt: new Date(), timezone: "UTC", plan: "free" }).returning();
  [other] = await db.insert(schema.users).values({ id: "usr_eve", email: "eve@example.com", name: "Eve", emailVerifiedAt: new Date(), timezone: "UTC", plan: "free" }).returning();
  bot = await makeBot(owner, "Otto");
  otherBot = await makeBot(other, "Eve's tutor");
});

afterAll(async () => {
  await Promise.all(background);
  await resetDbForTests();
});

// ---------------------------------------------------------------------------

describe("reading files", () => {
  it("knows a file by its bytes, not its name, and says plainly what it can't read", () => {
    expect(sniff(fixture("syllabus.pdf"), "notes.txt")).toEqual({ kind: "pdf", mime: "application/pdf" });
    expect(sniff(SYLLABUS_DOCX, "whatever.bin")).toMatchObject({ kind: "docx" });
    expect(sniff(pptx([{ title: "Hi", bullets: [] }], [1]), "deck")).toMatchObject({ kind: "pptx" });
    expect(sniff(encodePng({ data: new Uint8Array(4 * 4), width: 4, height: 4, channels: 1 }), "x")).toEqual({ kind: "image", mime: "image/png" });
    expect(sniff(strToU8("# Notes\n\nCells are small."), "notes.md")).toEqual({ kind: "text", mime: "text/markdown" });
    expect(sniff(strToU8("<!doctype html><p>Hi</p>"), "page")).toEqual({ kind: "text", mime: "text/html" });
    expect(sniff(zipSync({ "xl/workbook.xml": strToU8("<x/>") }), "grades.xlsx")).toEqual({ error: expect.stringMatching(/CSV/) });
    expect(sniff(zipSync({ "a.txt": strToU8("a") }), "a.zip")).toEqual({ error: expect.stringMatching(/Unzip/) });
    expect(sniff(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), "old.doc")).toEqual({ error: expect.stringMatching(/older Office/) });
    expect(sniff(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]), "IMG_1.HEIC")).toEqual({ error: expect.stringMatching(/HEIC/) });
    expect(sniff(new Uint8Array([1, 2, 0, 3, 255, 254, 0]), "blob")).toEqual({ error: expect.stringMatching(/can't read/) });
    expect(sniff(new Uint8Array(), "empty.txt")).toEqual({ error: "The file is empty." });
  });

  it("reads a PDF page by page", async () => {
    const r = await readFileBytes(fixture("syllabus.pdf"), "pdf", "application/pdf", { canPayForVision: false });
    expect(r.pageCount).toBe(2);
    expect(r.pages.map((p) => p.label)).toEqual(["Page 1", "Page 2"]);
    expect(r.pages[0].text).toMatch(/mitochondria produce ATP/);
    expect(r.pages[1].text).toMatch(/Final exam: December 12/);
    expect(r.costMicros).toBe(0);
  });

  it("sends a scanned page's image to the vision model, as a PNG, and only with credit", async () => {
    const seen: { mime: string; png: boolean }[] = [];
    const vision = async (bytes: Uint8Array, mime: string) => {
      seen.push({ mime, png: bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 });
      return { text: "Unit 3: Evolution\nNatural selection: survival of the fittest", costMicros: 2100, model: "fake" };
    };
    const r = await readFileBytes(fixture("scanned.pdf"), "pdf", "application/pdf", { canPayForVision: true, vision });
    expect(seen).toEqual([{ mime: "image/png", png: true }]);
    expect(r.pages[0].text).toMatch(/Natural selection/);
    expect(r.costMicros).toBe(2100);
    const broke = await readFileBytes(fixture("scanned.pdf"), "pdf", "application/pdf", { canPayForVision: false, vision });
    expect(broke.note).toMatch(/needs credit/);
    expect(seen).toHaveLength(1);
  });

  it("says why a damaged PDF can't be read", async () => {
    await expect(readFileBytes(strToU8("%PDF-1.4\nnot really"), "pdf", "application/pdf", { canPayForVision: false })).rejects.toThrow(/damaged|No text|couldn't/i);
  });

  it("reads Word: headings, lists, tables, page breaks Word recorded, and footnotes", () => {
    const pages = readDocx(SYLLABUS_DOCX);
    expect(pages.map((p) => p.label)).toEqual(["Page 1", "Page 2"]);
    expect(pages[0].text).toBe("# Biology 101\n# Unit 1: Cells\nMitochondria: the powerhouse of the cell, where ATP is made\n- Read chapter 3\nMidterm | October 28");
    expect(pages[1].text).toContain("# Unit 2: Genetics\nDNA: a double helix that carries genes & traits");
    expect(pages[1].text).toContain("Footnotes:\n[1] Office hours: Tuesdays");
    // Without recorded page breaks it's one document, not "page 1".
    expect(readDocx(docx(para("Just one page")))).toEqual([{ page: 0, label: "Document", text: "Just one page" }]);
  });

  it("reads PowerPoint slides in the deck's order, titles first, with speaker notes and without slide numbers", () => {
    const deck = pptx(
      [
        { title: "Photosynthesis", bullets: ["Light reactions", "Calvin cycle"], notes: "Draw the chloroplast on the board" },
        { title: "Welcome", bullets: ["Bio 101, week 4"] },
      ],
      [2, 1],
    );
    const pages = readPptx(deck);
    expect(pages.map((p) => p.label)).toEqual(["Slide 1", "Slide 2"]);
    expect(pages[0].text).toBe("# Welcome\n- Bio 101, week 4");
    expect(pages[1].text).toBe("# Photosynthesis\n- Light reactions\n- Calvin cycle\nSpeaker notes:\nDraw the chloroplast on the board");
  });

  it("refuses an Office file that would unpack to too much", () => {
    const bomb = zipSync({ "word/document.xml": new Uint8Array(41 * 1024 * 1024) }, { level: 9 });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(() => readDocx(bomb)).toThrow(/too big/);
  });

  it("turns HTML into its readable text", () => {
    expect(htmlText("<html><head><title>x</title><style>p{}</style></head><body><h1>Cells</h1><script>alert(1)</script><ul><li>Nucleus</li><li>Ribosome &amp; more</li></ul></body></html>")).toBe(
      "Cells\n- Nucleus\n- Ribosome & more",
    );
  });

  it("splits long pages into passages a page long, at paragraph boundaries, keeping the page", () => {
    const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}. ${"Cells divide by mitosis. ".repeat(6)}`).join("\n\n");
    const passages = lib.toPassages([{ page: 4, label: "Page 4", text: long }]);
    expect(passages.length).toBeGreaterThan(2);
    expect(passages.every((p) => p.page === 4 && p.label === "Page 4" && p.text.length <= 1800 * 1.3)).toBe(true);
    expect(passages[0].text.startsWith("Paragraph 1.")).toBe(true);
    const text = lib.toPassages([{ page: 0, label: "Text", text: long }]);
    expect(text.map((p) => p.label).slice(0, 2)).toEqual(["Part 1", "Part 2"]);
  });
});

describe("the Library", () => {
  let syllabusId = "";

  it("takes a file, reads it, and finds things in it by meaning-ish words (stemming), with the page", async () => {
    const out = await lib.addFileBytes(db, { bot, owner, name: "Bio 101 Syllabus.pdf", bytes: fixture("syllabus.pdf") });
    if ("error" in out) throw new Error(out.error);
    expect(out.file).toMatchObject({ status: "ready", kind: "pdf", pages: 2, error: null });
    syllabusId = out.file.id;
    const hits = await searchLibrary(db, bot.id, "when is the final exam");
    expect(hits[0]).toMatchObject({ fileName: "Bio 101 Syllabus.pdf", label: "Page 2" });
    expect(hits[0].text).toMatch(/December 12/);
    // "cell" finds "cellular" and "Cells" (English stemming).
    expect((await searchLibrary(db, bot.id, "cell")).some((h) => h.label === "Page 1")).toBe(true);
  });

  it("falls back to any of the words, then to plain text matching", async () => {
    expect((await searchLibrary(db, bot.id, "mitochondria zebras")).length).toBeGreaterThan(0);
    await lib.addFileBytes(db, { bot, owner, name: "codes.txt", bytes: strToU8("Course code BIO101-X7 meets in room 2B.") });
    expect((await searchLibrary(db, bot.id, "BIO101-X7"))[0]?.fileName).toBe("codes.txt");
    expect(await searchLibrary(db, bot.id, "quantum chromodynamics")).toEqual([]);
  });

  it("keeps each owner's files to their own bots", async () => {
    expect(await searchLibrary(db, otherBot.id, "final exam")).toEqual([]);
    expect(await lib.findFile(db, otherBot.id, "Bio 101 Syllabus.pdf")).toBeNull();
    const r = await tool("search_files").run({ query: "final exam" }, { ...ctxFor(otherBot), owner: other });
    expect(r).toMatchObject({ ok: true, content: expect.stringMatching(/empty/i) });
  });

  it("the same bytes again don't make a second copy", async () => {
    const again = await lib.addFileBytes(db, { bot, owner, name: "copy of syllabus.pdf", bytes: fixture("syllabus.pdf") });
    if ("error" in again) throw new Error(again.error);
    expect(again.duplicateOf?.id).toBe(syllabusId);
    expect((await lib.listFiles(db, bot.id)).filter((f) => f.name.includes("yllabus"))).toHaveLength(1);
  });

  it("checks the limits: 25 MB a file, 500 MB an owner", async () => {
    expect(await lib.uploadRefusal(db, owner.id, 26 * 1024 * 1024)).toMatch(/up to 25 MB/);
    expect(await lib.uploadRefusal(db, owner.id, 0)).toMatch(/empty/);
    await db.insert(schema.files).values({ id: "file_huge", botId: bot.id, ownerId: owner.id, name: "huge.pdf", size: 499 * 1024 * 1024, storageKey: "library/x", status: "ready" });
    expect(await lib.uploadRefusal(db, owner.id, 2 * 1024 * 1024)).toMatch(/Library is full/);
    await db.delete(schema.files).where(eq(schema.files.id, "file_huge"));
    expect(await lib.uploadRefusal(db, owner.id, 2 * 1024 * 1024)).toBeNull();
  });

  it("marks a file it can't read as failed, with the reason in words", async () => {
    const out = await lib.addFileBytes(db, { bot, owner, name: "grades.xlsx", bytes: zipSync({ "xl/workbook.xml": strToU8("<x/>") }) });
    if ("error" in out) throw new Error(out.error);
    expect(out.file).toMatchObject({ status: "failed", error: expect.stringMatching(/Spreadsheets/) });
  });

  it("reads photos with the vision model (charged at cost), and without credit says so", async () => {
    const photo = encodePng({ data: new Uint8Array(300 * 300).fill(255), width: 300, height: 300, channels: 1 });
    const before = (await getUsage(db, owner.id)).costMicros;
    const out = await lib.addFileBytes(db, { bot, owner, name: "whiteboard.png", bytes: photo, vision: async () => ({ text: "Osmosis: water moves toward more solute", costMicros: 900, model: "fake" }) });
    if ("error" in out) throw new Error(out.error);
    expect(out.file).toMatchObject({ status: "ready", kind: "image" });
    expect((await getUsage(db, owner.id)).costMicros - before).toBe(900);
    expect((await searchLibrary(db, bot.id, "osmosis"))[0]?.fileName).toBe("whiteboard.png");
  });

  it("reads a whole file in parts, or some pages", async () => {
    const all = await readPassages(db, syllabusId);
    expect(all).toMatchObject({ part: 1, parts: 1, firstLabel: "Page 1", lastLabel: "Page 2" });
    expect(all.text).toMatch(/^\[Page 1\]\n/);
    const two = await readPassages(db, syllabusId, { from: 2 });
    expect(two.text).not.toMatch(/mitochondria/);
    const small = await readPassages(db, syllabusId, { maxChars: 150 });
    expect(small.parts).toBeGreaterThan(1);
    expect((await readPassages(db, syllabusId, { maxChars: 150, part: 2 })).text).toMatch(/^\[Page/);
  });

  it("deleting a file deletes its passages; deleting a bot's Library deletes everything", async () => {
    const out = await lib.addFileBytes(db, { bot, owner, name: "temp.md", bytes: strToU8("# Temporary\nphotosynthesis happens in chloroplasts") });
    if ("error" in out) throw new Error(out.error);
    expect(await lib.deleteFile(db, bot.id, out.file.id)).toBe(true);
    expect(await searchLibrary(db, bot.id, "chloroplasts")).toEqual([]);
    const spare = await makeBot(owner, "Spare");
    await lib.addFileBytes(db, { bot: spare, owner, name: "a.txt", bytes: strToU8("ribosome synthesis") });
    await lib.deleteLibrary(db, [spare.id]);
    expect(await lib.listFiles(db, spare.id)).toEqual([]);
  });

  it("tells the model what's in the Library, and names a message's attached files", async () => {
    const prompt = await lib.libraryPrompt(db, bot.id);
    expect(prompt).toMatch(/Bio 101 Syllabus\.pdf \(2 pages\)/);
    expect(prompt).not.toMatch(/grades\.xlsx/);
    expect(withFiles("Quiz me", { files: [{ id: "f", name: "Bio.pdf", kind: "pdf", pages: 6, status: "ready" }] })).toBe(
      "Quiz me\n\n[Attached to this message, and now in your Library: Bio.pdf (6 pages). Read them with read_file or search_files before answering about them.]",
    );
    expect(withFiles("", { files: [{ id: "f", name: "x.zip", kind: "unknown", pages: 0, status: "failed", note: "Unzip it" }] })).toMatch(/^\(Sent a file, no message\.\)\n\n\[Attached to this message: x\.zip \(couldn't be read: Unzip it\)\.\]$/);
  });
});

describe("the tools", () => {
  it("search and read cite the file and page; reading marks the turn as outside content", async () => {
    const s = await tool("search_files").run({ query: "midterm" }, ctxFor(bot));
    expect(s).toMatchObject({ ok: true, content: expect.stringMatching(/### Bio 101 Syllabus\.pdf · Page 1\n/) });
    const r = await tool("read_file").run({ file: "bio 101 syllabus" }, ctxFor(bot));
    expect(r).toMatchObject({ ok: true, content: expect.stringMatching(/^# Bio 101 Syllabus\.pdf \(2 pages\)/) });
    expect(tool("search_files").taints).toBe(true);
    expect(tool("read_file").taints).toBe(true);
    expect(await tool("read_file").run({ file: "nope.pdf" }, ctxFor(bot))).toMatchObject({ ok: false, error: expect.stringMatching(/No file called/) });
  });

  it("make_flashcards stores a set and hands back a card for the chat", async () => {
    const out = await tool("make_flashcards").run(
      { title: "Unit 1", cards: [{ front: "Mitochondria", back: "Make ATP", source: "Bio 101 Syllabus.pdf, page 1" }, { front: "DNA", back: "Double helix" }], files: ["Bio 101 Syllabus.pdf"] },
      ctxFor(bot),
    );
    expect(out).toMatchObject({ ok: true, card: { type: "study_set", set: { kind: "flashcards", title: "Unit 1", count: 2, sources: ["Bio 101 Syllabus.pdf"] } } });
    expect(out.ok && out.content).toMatch(/card they can study right here/);
    expect(tool("make_flashcards").ownerOnly).toBe(true);
    // On a chat app there's no card: it offers to go through it there.
    const tg = await tool("make_flashcards").run({ title: "T", cards: [{ front: "a", back: "b" }] }, ctxFor(bot, "telegram"));
    expect(tg.ok && tg.content).toMatch(/one at a time/);
  });

  it("make_quiz checks its questions: the right choice must be one of the choices", () => {
    const schema = tool("make_quiz").input;
    expect(schema.safeParse({ title: "Q", questions: [{ type: "multiple_choice", question: "2+2?", choices: ["3", "5"], answer: "4" }] }).success).toBe(false);
    expect(schema.safeParse({ title: "Q", questions: [{ type: "true_false", question: "Sky is blue", answer: "Yes" }] }).success).toBe(false);
    expect(schema.safeParse({ title: "Q", questions: [{ type: "multiple_choice", question: "2+2?", choices: ["3", "4."], answer: "4" }, { type: "short_answer", question: "Name a cell part", answer: "Nucleus" }] }).success).toBe(true);
  });
});

describe("a turn on the demo brain", () => {
  it("“make flashcards from <file>” reads it and makes a set, shown as a card with the reply", async () => {
    const conversation = await ensureConversation(db, bot.id, "web", "owner");
    const events: AgentEvent[] = [];
    const res = await runTurn({ db, bot, owner, conversation, channelKind: "web", message: { text: 'Make flashcards from "Bio 101 Syllabus.pdf".', author: "owner" }, emit: (e) => events.push(e) });
    expect(res.status).toBe("ok");
    const tools = events.filter((e): e is Extract<AgentEvent, { type: "tool" }> => e.type === "tool" && e.state === "ok").map((e) => e.name);
    expect(tools).toEqual(["read_file", "make_flashcards"]);
    const card = events.find((e): e is Extract<AgentEvent, { type: "study_set" }> => e.type === "study_set");
    expect(card?.set).toMatchObject({ kind: "flashcards", title: "Bio 101 Syllabus: flashcards" });
    expect(card!.set.count).toBeGreaterThan(1);
    const [msg] = await db.select().from(schema.messages).where(eq(schema.messages.id, res.messageId!));
    expect(msg.parts.some((p) => p.type === "study_set" && p.set.id === card!.set.id)).toBe(true);
    expect(msg.text).toMatch(/Tap \*\*Study\*\*/);
  });

  it("a file sent with no words gets offered flashcards, a quiz or a summary", async () => {
    const conversation = await ensureConversation(db, bot.id, "web", "owner");
    const file = (await lib.listFiles(db, bot.id)).find((f) => f.name === "codes.txt")!;
    const res = await runTurn({
      db, bot, owner, conversation, channelKind: "web",
      message: { text: "", author: "owner", meta: { files: [{ id: file.id, name: file.name, kind: file.kind, pages: file.pages, status: "ready" }] } },
    });
    expect(res.text).toMatch(/flashcards, a practice quiz, or a summary/);
  });
});

describe("study sets", () => {
  it("spaced repetition: Got it moves a card out (1, 3, 7 days); Again brings it back in ten minutes", () => {
    const now = new Date("2026-10-17T12:00:00Z");
    let p = study.reviewCard({}, "c1", "got_it", now);
    expect(p.cards!.c1).toEqual({ box: 1, due: "2026-10-18T12:00:00.000Z", seen: 1, missed: 0 });
    p = study.reviewCard(p, "c1", "got_it", now);
    expect(p.cards!.c1.due).toBe("2026-10-20T12:00:00.000Z");
    p = study.reviewCard(p, "c1", "again", now);
    expect(p.cards!.c1).toEqual({ box: 1, due: "2026-10-17T12:10:00.000Z", seen: 3, missed: 1 });
    const set = { kind: "flashcards", items: [{ id: "c1", front: "a", back: "b" }, { id: "c2", front: "c", back: "d" }], progress: p };
    expect(study.dueCards(set as never, now).map((c) => c.id)).toEqual(["c2"]);
    expect(study.dueCards(set as never, new Date("2026-10-17T12:11:00Z")).map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("exports CSV that Anki and Quizlet import, quoting what needs it", async () => {
    const set = await study.createStudySet(db, { botId: bot.id, kind: "flashcards", title: "CSV", items: [{ front: 'Say "hi"', back: "a, b\nc" }] });
    expect(study.studySetCsv(set)).toBe('Front,Back\r\n"Say ""hi""","a, b\nc"\r\n');
  });

  it("the routes: open a set, review a card, finish a quiz, export, delete; nobody else's", async () => {
    session.user = owner;
    const p = (setId: string) => ({ params: Promise.resolve({ botId: bot.id, setId }) });
    const flash = await study.createStudySet(db, { botId: bot.id, kind: "flashcards", title: "Routes", items: [{ front: "Q", back: "A" }] });
    const opened = await (await setRoute.GET(new Request("http://localhost/x"), p(flash.id))).json();
    expect(opened.set).toMatchObject({ kind: "flashcards", dueIds: [flash.items[0].id] });
    const reviewed = await (await reviewRoute.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ cardId: flash.items[0].id, result: "got_it" }) }), p(flash.id))).json();
    expect(reviewed.set.dueIds).toEqual([]);
    expect(reviewed.set.boxes[flash.items[0].id].box).toBe(1);

    const quiz = await study.createStudySet(db, { botId: bot.id, kind: "quiz", title: "Quiz", items: [{ type: "true_false", question: "Cells are small", answer: "true" }] });
    expect((quiz.items[0] as { answer: string; choices?: string[] }).answer).toBe("True");
    expect((quiz.items[0] as { choices?: string[] }).choices).toEqual(["True", "False"]);
    const tried = await (await attemptRoute.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ score: 0, total: 1, missed: [quiz.items[0].id, "q_not_in_it"] }) }), p(quiz.id))).json();
    expect(tried.set.attempts).toEqual([expect.objectContaining({ score: 0, total: 1, missed: [quiz.items[0].id] })]);

    const csv = await exportRoute.GET(new Request("http://localhost/x"), p(flash.id));
    expect(csv.headers.get("content-disposition")).toMatch(/Routes\.csv/);
    // A byte-order mark first, so Excel reads it as UTF-8 (text() drops it, so check the bytes).
    const bytes = new Uint8Array(await csv.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toBe("Front,Back\r\nQ,A\r\n");

    session.user = other;
    expect((await setRoute.GET(new Request("http://localhost/x"), p(flash.id))).status).toBe(404);
    session.user = owner;
    expect((await setRoute.DELETE(new Request("http://localhost/x", { method: "DELETE" }), p(flash.id))).status).toBe(200);
    expect((await setRoute.GET(new Request("http://localhost/x"), p(flash.id))).status).toBe(404);
  });
});

describe("uploading from the web app (no Blob store: through this server)", () => {
  it("start → upload → read → ready, then it goes with a chat message", async () => {
    session.user = owner;
    const bp = { params: Promise.resolve({ botId: bot.id }) };
    const started = await (await filesRoute.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ name: "Lecture 4.pptx", size: 5000 }) }), bp)).json();
    expect(started.upload).toEqual({ mode: "local", url: `/api/bots/${bot.id}/files/${started.file.id}/content` });
    expect(started.file.status).toBe("uploading");
    const fp = { params: Promise.resolve({ botId: bot.id, fileId: started.file.id }) };
    const deck = pptx([{ title: "Meiosis", bullets: ["Two divisions", "Four cells"], notes: "Compare with mitosis" }], [1]);
    expect((await contentRoute.PUT(new Request("http://localhost/x", { method: "PUT", body: new Uint8Array(deck).buffer as ArrayBuffer }), fp)).status).toBe(204);
    const reading = await (await readRoute.POST(new Request("http://localhost/x", { method: "POST" }), fp)).json();
    expect(reading.file.status).toBe("reading");
    await Promise.all(background);
    const done = await (await fileRoute.GET(new Request("http://localhost/x"), fp)).json();
    expect(done.file).toMatchObject({ status: "ready", kind: "pptx", detail: "1 slide" });

    // The original comes back to its owner only, as an attachment (not a page on this site).
    const back = await contentRoute.GET(new Request(`http://localhost/x`), fp);
    expect(back.headers.get("content-disposition")).toMatch(/^attachment; filename\*=UTF-8''Lecture%204\.pptx$/);
    expect(back.headers.get("content-security-policy")).toMatch(/sandbox/);
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(deck);
    session.user = other;
    expect((await contentRoute.GET(new Request("http://localhost/x"), fp)).status).toBe(404);
    session.user = owner;

    // The same bytes, announced by their hash: nothing to upload.
    const hash = (await import("node:crypto")).createHash("sha256").update(deck).digest("hex");
    const dup = await (await filesRoute.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ name: "again.pptx", size: deck.length, sha256: hash }) }), bp)).json();
    expect(dup).toMatchObject({ duplicate: true, file: { id: started.file.id } });

    // Attached to a message: the message keeps a light copy, and the model is told.
    const res = await chatRoute.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ text: "", fileIds: [started.file.id] }) }), bp);
    expect(res.status).toBe(200);
    await res.text();
    const msgs = await db.select().from(schema.messages).where(eq(schema.messages.botId, bot.id));
    const sent = msgs.find((m) => m.role === "user" && (m.meta as { files?: { id: string }[] }).files?.[0]?.id === started.file.id);
    expect(sent?.text).toBe("");
    expect((sent?.meta as { files: unknown[] }).files[0]).toMatchObject({ name: "Lecture 4.pptx", kind: "pptx", pages: 1, status: "ready" });
  });

  it("refuses a file over 25 MB before anything is uploaded", async () => {
    session.user = owner;
    const res = await filesRoute.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ name: "big.pdf", size: 30 * 1024 * 1024 }) }), { params: Promise.resolve({ botId: bot.id }) });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/up to 25 MB/);
  });
});
