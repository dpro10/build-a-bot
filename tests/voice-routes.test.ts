/**
 * Voice typing's API in demo mode with scripted speech (DEMO_SPEECH: no speech-to-text key, and the
 * demo "hears" sample lines), the way the desktop app and the Voice typing page use it:
 *
 * - Talking, editing by voice and "Hey {bot}" answer only the desktop app (its device token); the
 *   page, with a signed-in session (same site only), manages the dictionary.
 * - /api/voice/dictate types the demo's line cleaned up, or hands "Hey {bot}, …" back as a command.
 * - /api/voice/ask runs the request in the bot's chat and streams the reply.
 * - /api/voice/edit changes the selected text the way they said (demo: by rule), or writes it.
 * - /api/voice/dictionary keeps each person's words to themselves.
 * - /api/desktop/session says whether voice typing works and how many words are left.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
process.env.DEMO_SPEECH = "1";
delete process.env.DATABASE_URL;
for (const key of ["TOKEN_FACTORY_API_KEY", "TRANSCRIBE_API_KEY", "TRANSCRIBE_FALLBACK_API_KEY", "TAVILY_API_KEY", "COMPOSIO_API_KEY"]) delete process.env[key];

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => session.user,
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { sha256 } = await import("@/lib/crypto");
const { DEMO_DICTATIONS, DEMO_INSTRUCTIONS } = await import("@/lib/dictation/demo");
const dictateRoute = await import("@/app/api/voice/dictate/route");
const askRoute = await import("@/app/api/voice/ask/route");
const editRoute = await import("@/app/api/voice/edit/route");
const dictionaryRoute = await import("@/app/api/voice/dictionary/route");
const entryRoute = await import("@/app/api/voice/dictionary/[entryId]/route");
const sessionRoute = await import("@/app/api/desktop/session/route");
import type { Bot, User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;
let stranger: User;
let bot: Bot;
const TOKEN = "bab_dev_voice_test_token";
const device = { authorization: `Bearer ${TOKEN}` };
const AUDIO = new Uint8Array(4000).fill(1);

function dictateReq(query: string, headers: Record<string, string> = device, contentType = "audio/webm;codecs=opus") {
  return new Request(`http://localhost/api/voice/dictate?${query}`, { method: "POST", headers: { ...headers, "content-type": contentType }, body: AUDIO });
}

function jsonReq(method: string, url: string, body?: unknown, headers: Record<string, string> = device) {
  return new Request(url, { method, headers: { ...headers, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}

const entryParams = (entryId: string) => ({ params: Promise.resolve({ entryId }) });

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner] = await db.insert(schema.users).values({ id: "usr_dana", email: "dana@example.com", name: "Dana", emailVerifiedAt: new Date(), timezone: "UTC", plan: "free" }).returning();
  [stranger] = await db.insert(schema.users).values({ id: "usr_eve", email: "eve@example.com", name: "Eve", emailVerifiedAt: new Date(), timezone: "UTC", plan: "free" }).returning();
  await db.insert(schema.bridgeDevices).values({ id: "dev_mac", ownerId: owner.id, name: "Dana's Mac", tokenHash: sha256(TOKEN), platform: "desktop-darwin-arm64", clis: {} });
  const res = await createBot(db, owner, {
    avatar: "otto",
    color: "grape",
    name: "Otto",
    jobs: [],
    brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
    connectors: [],
    trust: "ask",
    channels: [],
    contact: {},
    ageConfirmed: true,
    timezone: "UTC",
  });
  if (!res.ok) throw new Error(res.error);
  bot = res.bot;
});

afterAll(async () => {
  await resetDbForTests();
});

describe("dictating", () => {
  it("needs a paired computer", async () => {
    session.user = null;
    expect((await dictateRoute.POST(dictateReq("durationMs=3000", {}))).status).toBe(403);
    expect((await dictateRoute.POST(dictateReq("durationMs=3000", { authorization: "Bearer bab_dev_revoked" }))).status).toBe(401);
  });

  it("types what the demo heard, cleaned up, and counts the words", async () => {
    const res = await dictateRoute.POST(dictateReq("durationMs=4200&speechMs=3500&category=chat&app=Slack&demo=0"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ kind: "text", text: DEMO_DICTATIONS[0].typed, heard: DEMO_DICTATIONS[0].heard, polished: true, simulated: true });
    expect(body.usage).toEqual({ words: body.words, limit: null });

    // With the cleanup off, the plain cleanup: fillers out, the words kept.
    const plain = await (await dictateRoute.POST(dictateReq("durationMs=4200&speechMs=3500&polish=0&demo=0"))).json();
    expect(plain.text).toBe("So I was thinking we could move the team meeting to Thursday. No wait, Friday at three.");
    expect(plain.polished).toBe(false);
  });

  it("hands \"Hey Otto, …\" back as a command", async () => {
    const body = await (await dictateRoute.POST(dictateReq("durationMs=3000&speechMs=2500&demo=command"))).json();
    expect(body).toMatchObject({ kind: "command", bot: { id: bot.id, name: "Otto", paused: false }, command: "Remind me to call Mom tomorrow at 5." });
    expect(body.text).toBe("Hey Otto, remind me to call Mom tomorrow at 5.");
  });

  it("skips a tap, and checks what it's sent", async () => {
    expect(await (await dictateRoute.POST(dictateReq("durationMs=300&speechMs=0"))).json()).toMatchObject({ kind: "empty" });
    expect((await dictateRoute.POST(dictateReq("durationMs=3000", device, "text/plain"))).status).toBe(415);
    expect((await dictateRoute.POST(dictateReq("durationMs=0"))).status).toBe(422);
    expect((await dictateRoute.POST(dictateReq(`durationMs=${11 * 60_000}`))).status).toBe(422);
    expect((await dictateRoute.POST(dictateReq("durationMs=3000&lang=english"))).status).toBe(422);
  });

  it("takes what the computer already heard (on-device speech): cleaned up and counted, with no audio and nothing simulated", async () => {
    const said = "Hey Otto, remind me to call Priya tomorrow at 3:30.";
    const cmd = await dictateRoute.POST(jsonReq("POST", "http://localhost/api/voice/dictate?durationMs=3500&speechMs=3000", { heard: said }));
    expect(cmd.status).toBe(200);
    expect(await cmd.json()).toMatchObject({ kind: "command", command: "Remind me to call Priya tomorrow at 3:30.", heard: said, simulated: false });

    const before = (await (await dictateRoute.POST(jsonReq("POST", "http://localhost/api/voice/dictate?durationMs=2000&speechMs=1800&commands=0", { heard: "Sounds good, see you then." }))).json()) as { kind: string; text: string; words: number; usage: { words: number }; simulated: boolean; ms: { stt: number } };
    expect(before).toMatchObject({ kind: "text", text: "Sounds good, see you then.", words: 5, simulated: false });
    expect(before.ms.stt).toBeLessThan(50);

    // Silence on the computer: nothing to type, nothing counted.
    expect(await (await dictateRoute.POST(jsonReq("POST", "http://localhost/api/voice/dictate?durationMs=2000&speechMs=1500", { heard: "  " }))).json()).toMatchObject({ kind: "empty" });
    // Not JSON, too long, or the wrong shape.
    expect((await dictateRoute.POST(new Request("http://localhost/api/voice/dictate?durationMs=2000", { method: "POST", headers: { ...device, "content-type": "application/json" }, body: "{not json" }))).status).toBe(400);
    expect((await dictateRoute.POST(jsonReq("POST", "http://localhost/api/voice/dictate?durationMs=2000", { heard: "x".repeat(20_001) }))).status).toBe(422);
    expect((await dictateRoute.POST(jsonReq("POST", "http://localhost/api/voice/dictate?durationMs=2000", { text: "hi" }))).status).toBe(422);
  });

  it("happens in the desktop app: the website, even signed in, is told so (talking, editing, asking)", async () => {
    session.user = owner;
    const site = { origin: "http://localhost", host: "localhost" };
    const talk = await dictateRoute.POST(dictateReq("durationMs=3000&speechMs=2500&demo=2", site));
    expect(talk.status).toBe(403);
    expect(await talk.json()).toMatchObject({ code: "app_only", error: "Voice typing works in the desktop app." });
    expect((await dictateRoute.POST(jsonReq("POST", "http://localhost/api/voice/dictate?durationMs=2000", { heard: "Hello there." }, site))).status).toBe(403);
    expect((await editRoute.POST(jsonReq("POST", "http://localhost/api/voice/edit", { instruction: "Make this friendlier.", selection: "Send the slides." }, site))).status).toBe(403);
    const ask = await askRoute.POST(jsonReq("POST", "http://localhost/api/voice/ask", { botId: bot.id, text: "Remind me to call Mom." }, site));
    expect(ask.status).toBe(403);
    // The page still keeps the owner's words.
    expect((await dictionaryRoute.GET(new Request("http://localhost/api/voice/dictionary", { headers: site }))).status).toBe(200);
    session.user = null;
  });
});

describe("editing by voice", () => {
  it("hears an instruction (demo), then changes the selection with it", async () => {
    // The instruction is dictated with the cleanup and commands off, so "Hey Otto" can't hijack it.
    const heard = await (await dictateRoute.POST(dictateReq("durationMs=2000&speechMs=1500&polish=0&commands=0&demo=edit"))).json();
    expect(heard).toMatchObject({ kind: "text", text: DEMO_INSTRUCTIONS.edit });

    const res = await editRoute.POST(jsonReq("POST", "http://localhost/api/voice/edit", { instruction: heard.text, selection: "Can you send me the slides from yesterday's call?", category: "chat", app: "Slack" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ kind: "replace", text: "Hi! Can you send me the slides from yesterday's call? Thanks so much!", simulated: true, usage: { limit: null } });
    expect(body.words).toBe(13);
  });

  it("writes at the cursor when nothing is selected, and asks for a selection when it needs one", async () => {
    const wrote = await (await editRoute.POST(jsonReq("POST", "http://localhost/api/voice/edit", { instruction: DEMO_INSTRUCTIONS.write, selection: null }))).json();
    expect(wrote).toMatchObject({ kind: "replace", simulated: true });
    expect(wrote.text.length).toBeGreaterThan(10);

    const none = await editRoute.POST(jsonReq("POST", "http://localhost/api/voice/edit", { instruction: "Make this shorter.", selection: "" }));
    expect(none.status).toBe(422);
    expect(await none.json()).toMatchObject({ code: "no-selection", error: "Select the text you want to change first." });
  });

  it("checks who's asking and what it's sent", async () => {
    session.user = null;
    // Only the desktop app (a revoked one is unpaired).
    expect((await editRoute.POST(jsonReq("POST", "http://localhost/api/voice/edit", { instruction: "shorter", selection: "x" }, {}))).status).toBe(403);
    expect((await editRoute.POST(jsonReq("POST", "http://localhost/api/voice/edit", { instruction: "shorter", selection: "x" }, { authorization: "Bearer bab_dev_revoked" }))).status).toBe(401);
    expect((await editRoute.POST(jsonReq("POST", "http://localhost/api/voice/edit", { instruction: "", selection: "x" }))).status).toBe(422);
    expect((await editRoute.POST(jsonReq("POST", "http://localhost/api/voice/edit", { instruction: "shorter", selection: "x".repeat(20_001) }))).status).toBe(422);
    expect((await editRoute.POST(jsonReq("POST", "http://localhost/api/voice/edit", { instruction: "shorter", selection: "x", category: "spaceship" }))).status).toBe(422);
    const ok = await editRoute.POST(jsonReq("POST", "http://localhost/api/voice/edit", { instruction: "make it shorter", selection: "One. Two." }));
    expect(await ok.json()).toMatchObject({ kind: "replace", text: "One." });
  });
});

describe("asking the bot", () => {
  it("runs the request in the bot's chat and streams the reply", async () => {
    const res = await askRoute.POST(jsonReq("POST", "http://localhost/api/voice/ask", { botId: bot.id, text: "Remind me to call Mom tomorrow at 5." }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = (await res.text())
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)));
    const done = events.find((e) => e.type === "done");
    expect(done?.text?.length).toBeGreaterThan(0);
    // It's in the chat, marked as said by voice.
    const messages = await db.select().from(schema.messages).where(eq(schema.messages.botId, bot.id));
    const asked = messages.find((m) => m.role === "user" && m.text === "Remind me to call Mom tomorrow at 5.");
    expect(asked?.meta).toMatchObject({ via: "voice" });
    const answer = messages.find((m) => m.role === "assistant");
    expect(answer).toBeTruthy();
    // An answer to the owner, not the bot reaching out on its own.
    expect((answer?.meta as { proactive?: boolean }).proactive).toBeUndefined();
  });

  it("sends what they selected along with the request, kept with it in the chat", async () => {
    const selection = "Team lunch Friday at 12:30 at Tartine. Bring the Q3 slides.";
    const res = await askRoute.POST(jsonReq("POST", "http://localhost/api/voice/ask", { botId: bot.id, text: "Remind me about this tomorrow at 9.", selection }));
    await res.text();
    const messages = await db.select().from(schema.messages).where(eq(schema.messages.botId, bot.id));
    const asked = messages.find((m) => m.role === "user" && m.text === "Remind me about this tomorrow at 9.");
    expect(asked?.meta).toMatchObject({ via: "voice", selection });
    // A blank selection is no selection; one too long is refused.
    const blank = await askRoute.POST(jsonReq("POST", "http://localhost/api/voice/ask", { botId: bot.id, text: "Hi there.", selection: "   " }));
    await blank.text();
    const hi = (await db.select().from(schema.messages).where(eq(schema.messages.botId, bot.id))).find((m) => m.text === "Hi there.");
    expect(hi?.meta).toEqual({ via: "voice" });
    expect((await askRoute.POST(jsonReq("POST", "http://localhost/api/voice/ask", { botId: bot.id, text: "Hi", selection: "x".repeat(8001) }))).status).toBe(422);
  });

  it("only for the owner's own bots", async () => {
    const theirs = await createBot(db, stranger, {
      avatar: "blip",
      color: "sunny",
      name: "Blip",
      jobs: [],
      brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: [],
      trust: "ask",
      channels: [],
      contact: {},
      ageConfirmed: true,
      timezone: "UTC",
    });
    if (!theirs.ok) throw new Error(theirs.error);
    expect((await askRoute.POST(jsonReq("POST", "http://localhost/api/voice/ask", { botId: theirs.bot.id, text: "Hi" }))).status).toBe(404);
  });
});

describe("the dictionary", () => {
  it("adds, changes and deletes the owner's words and snippets", async () => {
    const add = await dictionaryRoute.POST(jsonReq("POST", "http://localhost/api/voice/dictionary", { kind: "word", text: "Prozzi", heard: ["pro zee", "Prozzi"] }));
    expect(add.status).toBe(201);
    const { entry } = await add.json();
    expect(entry).toMatchObject({ kind: "word", text: "Prozzi", heard: ["pro zee"], source: "manual" });

    const snip = await dictionaryRoute.POST(jsonReq("POST", "http://localhost/api/voice/dictionary", { kind: "snippet", text: "https://cal.com/dana", heard: ["my booking link"] }));
    expect(snip.status).toBe(201);
    expect((await dictionaryRoute.POST(jsonReq("POST", "http://localhost/api/voice/dictionary", { kind: "snippet", text: "x" }))).status).toBe(422);

    const patched = await entryRoute.PATCH(jsonReq("PATCH", "http://localhost/api", { heard: ["pro zee", "prozy"] }), entryParams(entry.id));
    expect((await patched.json()).entry.heard).toEqual(["pro zee", "prozy"]);

    const list = await (await dictionaryRoute.GET(new Request("http://localhost/api/voice/dictionary", { headers: device }))).json();
    expect(list.entries.map((e: { text: string }) => e.text)).toEqual(["Prozzi", "https://cal.com/dana"]);
    expect(list.bots).toEqual([{ id: bot.id, name: "Otto" }]);

    // The words are used right away: the demo's line comes out with the owner's spelling.
    await dictionaryRoute.POST(jsonReq("POST", "http://localhost/api/voice/dictionary", { kind: "word", text: "Friday", heard: ["thursday"] }));
    const typed = await (await dictateRoute.POST(dictateReq("durationMs=4200&speechMs=3500&polish=0&demo=0"))).json();
    expect(typed.text).toContain("move the team meeting to Friday. No wait, Friday at three.");

    expect((await entryRoute.DELETE(jsonReq("DELETE", "http://localhost/api"), entryParams(entry.id))).status).toBe(200);
    expect((await entryRoute.DELETE(jsonReq("DELETE", "http://localhost/api"), entryParams(entry.id))).status).toBe(404);
  });

  it("keeps each person's words to themselves", async () => {
    session.user = stranger;
    const theirs = await (await dictionaryRoute.GET(new Request("http://localhost/api/voice/dictionary"))).json();
    expect(theirs.entries).toEqual([]);
    const [danas] = await db.select().from(schema.dictionary).where(eq(schema.dictionary.ownerId, owner.id));
    const edit = await entryRoute.PATCH(jsonReq("PATCH", "http://localhost/api", { text: "hacked" }, { origin: "http://localhost", host: "localhost" }), entryParams(danas.id));
    expect(edit.status).toBe(404);
    const del = await entryRoute.DELETE(jsonReq("DELETE", "http://localhost/api", undefined, { origin: "http://localhost", host: "localhost" }), entryParams(danas.id));
    expect(del.status).toBe(404);
    session.user = null;
  });
});

describe("the desktop session", () => {
  it("says voice typing works (simulated), with this month's words and no limit", async () => {
    const res = await sessionRoute.GET(new Request("http://localhost/api/desktop/session", { headers: device }));
    const body = await res.json();
    expect(body.voice).toMatchObject({ available: true, polish: true, edit: true, simulated: true, local: true, usage: { limit: null } });
    expect(body.voice.usage.words).toBeGreaterThan(0);
    expect(body.bots.map((b: { name: string }) => b.name)).toEqual(["Otto"]);
  });
});
