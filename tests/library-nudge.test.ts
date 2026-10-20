/**
 * A small model sometimes answers "I'll make your flashcards" (even "[Reading notes.pdf...]") without
 * calling the tool. When the owner clearly asked for flashcards or a quiz, it's told once to do it,
 * and the narrated "[Reading …]" never reaches the owner.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
process.env.TOKEN_FACTORY_API_KEY = "tf-test-key";
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { runTurn, studyNudge } = await import("@/lib/agent/run");
const { ensureConversation } = await import("@/lib/channels/outbound");
import type { User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;

const tools = (names: string[]) => ({ byName: new Map(names.map((n) => [n, {} as never])) });
const noParts = { parts: [] };

describe("when it nudges", () => {
  it("only for flashcards or a made quiz, only with the tool, and only before one is made", () => {
    const both = tools(["make_flashcards", "make_quiz"]);
    expect(studyNudge("Make flashcards from my notes", both, noParts)).toMatch(/call make_flashcards/);
    expect(studyNudge("Can you make me a practice quiz on chapter 3?", both, noParts)).toMatch(/call make_quiz/);
    expect(studyNudge("give me a 10 question test", both, noParts)).toMatch(/call make_quiz/);
    expect(studyNudge("Quiz me on what we covered", both, noParts)).toBeNull();
    expect(studyNudge("What's on the midterm?", both, noParts)).toBeNull();
    expect(studyNudge("Make flashcards", tools([]), noParts)).toBeNull();
    expect(studyNudge("Make flashcards", both, { parts: [{ type: "tool_call", id: "1", name: "make_flashcards", args: {} }] })).toBeNull();
    expect(studyNudge(null, both, noParts)).toBeNull();
  });
});

/** The included model, played here: OpenAI-style streaming, text or a tool call. */
function stubModel(script: (body: { messages: { role: string; content: string }[] }) => { text?: string; tool?: { name: string; args: unknown } }) {
  const bodies: { messages: { role: string; content: string }[] }[] = [];
  vi.stubGlobal("fetch", async (_input: unknown, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body ?? "{}"));
    bodies.push(body);
    const step = script(body);
    const events = step.tool
      ? [{ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: step.tool.name, arguments: JSON.stringify(step.tool.args) } }] } }] }, { choices: [{ delta: {}, finish_reason: "tool_calls" }] }]
      : [{ choices: [{ delta: { content: step.text ?? "" } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }];
    const sse = [...events, { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } }].map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(sse, { headers: { "content-type": "text/event-stream" } });
  });
  return bodies;
}

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner] = await db.insert(schema.users).values({ id: "usr_dana", email: "dana@example.com", name: "Dana", emailVerifiedAt: new Date(), timezone: "UTC", plan: "free" }).returning();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await resetDbForTests();
});

describe("a turn where the model narrates instead of acting", () => {
  it("is told once to make the flashcards, makes them, and the narration's [Reading …] line is gone", async () => {
    const res = await createBot(db, owner, {
      avatar: "otto", color: "grape", name: "Otto", jobs: [], brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: [], trust: "ask", channels: [], contact: {}, ageConfirmed: true, timezone: "UTC",
    });
    if (!res.ok) throw new Error(res.error);
    const bodies = stubModel((body) => {
      const last = body.messages.at(-1);
      if (last?.role === "user" && /haven't made them yet/.test(last.content)) return { tool: { name: "make_flashcards", args: { title: "Cells", cards: [{ front: "Mitochondria", back: "Make ATP" }] } } };
      if (last?.role === "tool") return { text: "Here are your flashcards on cells." };
      return { text: "I'll read your notes and make flashcards.\n[Reading notes.pdf...]" };
    });
    const conversation = await ensureConversation(db, res.bot.id, "web", "owner");
    const out = await runTurn({ db, bot: res.bot, owner, conversation, channelKind: "web", message: { text: "Make flashcards about cells", author: "owner" } });
    expect(bodies).toHaveLength(3);
    const [msg] = await db.select().from(schema.messages).where(eq(schema.messages.id, out.messageId!));
    expect(msg.parts.some((p) => p.type === "study_set")).toBe(true);
    expect(msg.text).toBe("I'll read your notes and make flashcards.\n\nHere are your flashcards on cells.");
  });

  it("doesn't push when the model asks a question first (that's the owner's to answer)", async () => {
    const res = await createBot(db, owner, {
      avatar: "otto", color: "grape", name: "Asker", jobs: [], brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: [], trust: "ask", channels: [], contact: {}, ageConfirmed: true, timezone: "UTC",
    });
    if (!res.ok) throw new Error(res.error);
    const bodies = stubModel(() => ({ text: "Happy to! From your syllabus or your whiteboard photo?" }));
    const conversation = await ensureConversation(db, res.bot.id, "web", "owner");
    const out = await runTurn({ db, bot: res.bot, owner, conversation, channelKind: "web", message: { text: "Make me a practice quiz", author: "owner" } });
    expect(bodies).toHaveLength(1);
    expect(out.text).toBe("Happy to! From your syllabus or your whiteboard photo?");
  });

  it("doesn't push on a call, where a quiz is one question out loud", async () => {
    const res = await createBot(db, owner, {
      avatar: "otto", color: "grape", name: "Caller", jobs: [], brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: [], trust: "ask", channels: [], contact: {}, ageConfirmed: true, timezone: "UTC",
    });
    if (!res.ok) throw new Error(res.error);
    const bodies = stubModel(() => ({ text: "Okay. Where in the chloroplast does the Calvin cycle happen." }));
    const conversation = await ensureConversation(db, res.bot.id, "voice", "call:test");
    const out = await runTurn({ db, bot: res.bot, owner, conversation, channelKind: "voice", message: { text: "Give me a practice quiz on my Calvin cycle notes", author: "owner" } });
    expect(bodies).toHaveLength(1);
    expect(out.text).toMatch(/Where in the chloroplast does the Calvin cycle happen/);
    expect(out.text).not.toMatch(/\bA\)|make_quiz/);
  });
});
