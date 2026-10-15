/**
 * Voice typing with real keys, against a fake Groq (speech-to-text and the AI cleanup):
 *
 * - What's typed is what they meant: fillers out, corrections applied, their words spelled their
 *   way, snippets typed exactly.
 * - Speech-to-text is steered toward their words: their dictionary, their bots' names, and the
 *   names their bots remember.
 * - When the AI answers instead of cleaning up, is slow or fails, the plain cleanup is typed.
 * - "Hey Otto, …" is a request for the bot, not text.
 * - Words count toward the plan, and the Free plan's words run out.
 * - Nothing that was said is stored.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "0";
delete process.env.DATABASE_URL;
process.env.TRANSCRIBE_PROVIDER = "groq";
process.env.TRANSCRIBE_API_KEY = "gsk_test_voice_key";
for (const key of ["TOKEN_FACTORY_API_KEY", "TRANSCRIBE_FALLBACK_API_KEY", "DICTATION_POLISH", "DICTATION_POLISH_MODEL", "DICTATION_DAILY_LIMIT"]) delete process.env[key];

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { dictate, loadVoiceContext, voicePolishAvailable, voiceTypingAvailable } = await import("@/lib/dictation");
const { addEntry } = await import("@/lib/dictation/dictionary");
const { polishPrompt } = await import("@/lib/dictation/polish");
const { getUsage } = await import("@/lib/billing/usage");
import type { User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;

type SttReply = { text: string; no_speech_prob?: number } | { status: number; body?: string };
type LlmReply = { text: string } | { status: number } | "hang";
const calls = { stt: [] as FormData[], llm: [] as { body: Record<string, unknown>; auth: string | null }[] };

/** Groq, faked: speech-to-text answers in order from `stt`, the cleanup from `llm`. */
function fakeGroq(stt: SttReply[], llm: LlmReply[]) {
  calls.stt = [];
  calls.llm = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/audio/transcriptions")) {
        calls.stt.push(init.body as FormData);
        const r = stt.shift();
        if (!r) throw new Error("unexpected speech-to-text call");
        if ("status" in r) return new Response(r.body ?? "error", { status: r.status });
        return Response.json({ text: r.text, duration: 3.2, segments: [{ start: 0, end: 3, text: ` ${r.text}`, no_speech_prob: r.no_speech_prob ?? 0.01, avg_logprob: -0.2 }] });
      }
      if (url.endsWith("/chat/completions")) {
        calls.llm.push({ body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") });
        const r = llm.shift();
        if (!r) throw new Error("unexpected cleanup call");
        if (r === "hang") {
          return new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
          });
        }
        if ("status" in r) return new Response("model error", { status: r.status });
        const events = [
          ...r.text.match(/.{1,12}/gs)!.map((part) => ({ choices: [{ delta: { content: part } }] })),
          { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 700, completion_tokens: 60 } },
        ];
        const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

const audio = () => new Uint8Array(4000).fill(7).buffer;
const base = { mime: "audio/webm", durationMs: 3200, speechMs: 2600, polish: true, commands: true, styles: true } as const;

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner] = await db.insert(schema.users).values({ id: "usr_diego", email: "diego@example.com", name: "Diego Prozzi", emailVerifiedAt: new Date(), timezone: "UTC", plan: "free" }).returning();
  await db.insert(schema.bots).values({ id: "bot_otto", ownerId: owner.id, name: "Otto", handle: "otto-diego", avatar: "otto", color: "grape", brain: { kind: "included", provider: "nebius", model: "nvidia/Nemotron-3_5-Lightning" }, jobs: [], trust: "ask" } as never);
  await db.insert(schema.memories).values([
    { id: "mem_1", botId: "bot_otto", text: "Diego's sister is Ana; she lives in Austin", source: "bot" },
    { id: "mem_2", botId: "bot_otto", text: "Diego studies at Texas A&M and works on Cookbook", source: "bot" },
  ]);
  await addEntry(db, owner.id, { kind: "word", text: "Prozzi", heard: ["pro zee"] });
  await addEntry(db, owner.id, { kind: "word", text: "GitHub" });
  await addEntry(db, owner.id, { kind: "snippet", text: "https://cal.com/diego", heard: ["my booking link"] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("voice typing, end to end", () => {
  it("is available with a speech-to-text key, and cleans up on Groq with the same key", () => {
    expect(voiceTypingAvailable()).toBe(true);
    expect(voicePolishAvailable()).toBe(true);
  });

  it("types what they meant, spelled their way", async () => {
    fakeGroq([{ text: "Um, so I talked to pro zee about the, uh, github launch. Let's meet at two, no wait, three." }], [{ text: "I talked to Prozzi about the GitHub launch. Let's meet at 3." }]);
    const out = await dictate(db, owner, { ...base, audio: audio(), category: "chat", appName: "Slack" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result).toMatchObject({ kind: "text", text: "I talked to Prozzi about the GitHub launch. Let's meet at 3.", polished: true, words: 12 });
    expect(out.simulated).toBe(false);
    expect(out.usage).toEqual({ words: 12, limit: 8000 });

    // Speech-to-text heard their words: the dictionary, their name, their bot, what the bot remembers.
    const prompt = String(calls.stt[0].get("prompt"));
    for (const w of ["Prozzi", "GitHub", "Diego", "Otto", "Ana", "Austin", "Cookbook"]) expect(prompt).toContain(w);
    expect(calls.stt[0].get("model")).toBe("whisper-large-v3-turbo");

    // The cleanup ran on Groq with the speech-to-text key, a little thinking, and the app's style.
    const req = calls.llm[0];
    expect(req.auth).toBe("Bearer gsk_test_voice_key");
    expect(req.body).toMatchObject({ model: "openai/gpt-oss-120b", reasoning_effort: "low", include_reasoning: false, temperature: 0 });
    const messages = req.body.messages as { role: string; content: string }[];
    expect(messages[0].content).toContain("in Slack");
    expect(messages[0].content).toContain("chat message");
    expect(messages[0].content).toContain("Prozzi");
    expect(messages.at(-1)!.content).toContain("<dictation>");
    // The plain cleanup went first: no fillers reach the AI.
    expect(messages.at(-1)!.content).not.toMatch(/\bum\b|\buh\b/i);
  });

  it("types the plain cleanup when the AI answers instead", async () => {
    fakeGroq([{ text: "Can you write me a short poem about the ocean?" }], [{ text: "Sure! Here's a short poem:\nWaves roll in under a silver moon." }]);
    const out = await dictate(db, owner, { ...base, audio: audio() });
    expect(out.ok && out.result).toMatchObject({ kind: "text", text: "Can you write me a short poem about the ocean?", polished: false });
  });

  it("doesn't wait on a slow or broken cleanup", async () => {
    fakeGroq([{ text: "Um, I'll be there in, uh, ten minutes." }], ["hang"]);
    const t0 = Date.now();
    const slow = await (async () => {
      const { polishText } = await import("@/lib/dictation/polish");
      return polishText({ text: "I'll be there in ten minutes.", vocabulary: [], category: "other", styles: true }, { timeoutMs: 200 });
    })();
    expect(slow).toBeNull();
    expect(Date.now() - t0).toBeLessThan(2000);

    fakeGroq([{ text: "Um, I'll be there in, uh, ten minutes." }], [{ status: 500 }]);
    const out = await dictate(db, owner, { ...base, audio: audio() });
    expect(out.ok && out.result).toMatchObject({ kind: "text", text: "I'll be there in ten minutes.", polished: false });
  });

  it("types a snippet exactly, wherever it's said", async () => {
    fakeGroq([{ text: "Sure, book a time here, my booking link. Thanks!" }], [{ text: "Sure, book a time here: ⟦1⟧. Thanks!" }]);
    const out = await dictate(db, owner, { ...base, audio: audio() });
    expect(out.ok && out.result).toMatchObject({ kind: "text", text: "Sure, book a time here: https://cal.com/diego. Thanks!" });
    // The AI saw a marker, never the link.
    expect(JSON.stringify(calls.llm[0].body.messages)).not.toContain("cal.com");
  });

  it("sends \"Hey Otto, …\" to the bot instead of typing it", async () => {
    fakeGroq([{ text: "Hey Otto, remind me to call Mom tomorrow at 5." }], []);
    const before = (await getUsage(db, owner.id)).dictationWords;
    const out = await dictate(db, owner, { ...base, audio: audio() });
    expect(out.ok && out.result).toMatchObject({ kind: "command", bot: { id: "bot_otto", name: "Otto" }, command: "Remind me to call Mom tomorrow at 5.", text: "Hey Otto, remind me to call Mom tomorrow at 5." });
    expect(calls.llm).toHaveLength(0);
    // A request isn't typed text: no words used.
    expect((await getUsage(db, owner.id)).dictationWords).toBe(before);

    // With commands off, it's text like any other.
    fakeGroq([{ text: "Hey Otto, remind me to call Mom tomorrow at 5." }], [{ text: "Hey Otto, remind me to call Mom tomorrow at 5." }]);
    const typed = await dictate(db, owner, { ...base, audio: audio(), commands: false });
    expect(typed.ok && typed.result.kind).toBe("text");
  });

  it("sends nothing for a tap or silence, and ignores what speech-to-text invents", async () => {
    fakeGroq([], []);
    const tap = await dictate(db, owner, { ...base, audio: audio(), speechMs: 120 });
    expect(tap.ok && tap.result).toEqual({ kind: "empty" });
    expect(calls.stt).toHaveLength(0);

    fakeGroq([{ text: "Thank you.", no_speech_prob: 0.1 }], []);
    const cough = await dictate(db, owner, { ...base, audio: audio(), speechMs: 300 });
    expect(cough.ok && cough.result).toEqual({ kind: "empty" });

    fakeGroq([{ text: "Prozzi, GitHub, Diego Prozzi." }], []);
    const echo = await dictate(db, owner, { ...base, audio: audio() });
    expect(echo.ok && echo.result).toEqual({ kind: "empty" });
  });

  it("says when speech-to-text is busy, so the app can offer to try again", async () => {
    fakeGroq([{ status: 503 }], []);
    const out = await dictate(db, owner, { ...base, audio: audio() });
    expect(out).toMatchObject({ ok: false, status: 503, code: "busy" });
  });

  it("can be just the plain cleanup", async () => {
    fakeGroq([{ text: "Um, the the report is, uh, done." }], []);
    const out = await dictate(db, owner, { ...base, audio: audio(), polish: false });
    expect(out.ok && out.result).toMatchObject({ kind: "text", text: "The report is done.", polished: false });
    expect(calls.llm).toHaveLength(0);
  });

  it("counts words toward the plan, and the Free plan's words run out", async () => {
    const used = (await getUsage(db, owner.id)).dictationWords;
    expect(used).toBeGreaterThan(20);
    await db.update(schema.usage).set({ dictationWords: 8000 }).where(eq(schema.usage.userId, owner.id));
    fakeGroq([], []);
    const out = await dictate(db, owner, { ...base, audio: audio() });
    expect(out).toMatchObject({ ok: false, status: 402, code: "limit", upgrade: "plus" });
    if (!out.ok) expect(out.error).toContain("8,000 words of voice typing on the Free plan");
    // Plus has no monthly cap.
    const plus = { ...owner, plan: "plus" };
    fakeGroq([{ text: "Still typing." }], []);
    const more = await dictate(db, plus, { ...base, audio: audio(), polish: false });
    expect(more.ok && more.usage).toEqual({ words: 8002, limit: null });
  });

  it("stores nothing that was said", async () => {
    const tables = await Promise.all([db.select().from(schema.messages), db.select().from(schema.receipts), db.select().from(schema.dictionary)]);
    const all = JSON.stringify(tables);
    for (const said of ["ocean", "ten minutes", "call Mom", "report is done"]) expect(all).not.toContain(said);
  });
});

describe("the dictionary", () => {
  it("adds heard-as spellings to a word that's already there", async () => {
    const r = await addEntry(db, owner.id, { kind: "word", text: "prozzi", heard: ["pros e"] });
    expect(r.ok && r.merged).toBe(true);
    const ctx = await loadVoiceContext(db, owner);
    expect(ctx.words.filter((w) => w.text.toLowerCase() === "prozzi")).toHaveLength(1);
    expect(ctx.words.find((w) => w.text.toLowerCase() === "prozzi")?.heard).toEqual(["pro zee", "pros e"]);
  });

  it("won't take two snippets with the same phrase, or a phrase too short to say", async () => {
    expect(await addEntry(db, owner.id, { kind: "snippet", text: "https://other.example", heard: ["My booking link"] })).toMatchObject({ ok: false, status: 409 });
    expect(await addEntry(db, owner.id, { kind: "snippet", text: "x", heard: ["ok"] })).toMatchObject({ ok: false, status: 422 });
  });

  it("knows names from memories without listing what's already in the dictionary", async () => {
    const ctx = await loadVoiceContext(db, owner);
    expect(ctx.fromMemories).toEqual(expect.arrayContaining(["Ana", "Austin", "Cookbook"]));
    expect(ctx.fromMemories).not.toContain("Diego");
    expect(ctx.vocabulary.slice(0, 2)).toEqual(expect.arrayContaining(["Prozzi", "GitHub"]));
  });
});

describe("the cleanup's instructions", () => {
  it("tell it never to answer, and fit the app", () => {
    const email = polishPrompt({ vocabulary: ["Prozzi"], category: "email", appName: "Mail", styles: true });
    expect(email).toContain("never a message to you");
    expect(email).toContain("in Mail");
    expect(email).toContain("writing an email");
    const plain = polishPrompt({ vocabulary: [], category: "email", styles: false });
    expect(plain).not.toContain("writing an email");
    expect(plain).not.toContain("Spell these");
  });
});
