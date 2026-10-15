/**
 * Voice typing's API in demo mode (no speech-to-text key: the demo "hears" sample lines), the way
 * the desktop app and the Voice typing page use it:
 *
 * - The desktop app with its device token; the page with a signed-in session (same site only).
 * - /api/voice/dictate types the demo's line cleaned up, or hands "Hey {bot}, …" back as a command.
 * - /api/voice/ask runs the request in the bot's chat and streams the reply.
 * - /api/voice/dictionary keeps each person's words to themselves.
 * - /api/desktop/session says whether voice typing works and how many words are left.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
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
const { DEMO_DICTATIONS } = await import("@/lib/dictation/demo");
const dictateRoute = await import("@/app/api/voice/dictate/route");
const askRoute = await import("@/app/api/voice/ask/route");
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
  it("needs a paired computer or a signed-in session", async () => {
    session.user = null;
    expect((await dictateRoute.POST(dictateReq("durationMs=3000", {}))).status).toBe(401);
    expect((await dictateRoute.POST(dictateReq("durationMs=3000", { authorization: "Bearer bab_dev_revoked" }))).status).toBe(401);
  });

  it("types what the demo heard, cleaned up, and counts the words", async () => {
    const res = await dictateRoute.POST(dictateReq("durationMs=4200&speechMs=3500&category=chat&app=Slack&demo=0"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ kind: "text", text: DEMO_DICTATIONS[0].typed, heard: DEMO_DICTATIONS[0].heard, polished: true, simulated: true });
    expect(body.usage).toEqual({ words: body.words, limit: 8000 });

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

  it("works from the Voice typing page, on the same site only", async () => {
    session.user = owner;
    const ok = await dictateRoute.POST(dictateReq("durationMs=3000&speechMs=2500&demo=2", { origin: "http://localhost", host: "localhost" }));
    expect((await ok.json()).text).toBe(DEMO_DICTATIONS[2].typed);
    const cross = await dictateRoute.POST(dictateReq("durationMs=3000", { origin: "https://evil.example", host: "localhost" }));
    expect(cross.status).toBe(403);
    session.user = null;
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
    expect(messages.some((m) => m.role === "assistant")).toBe(true);
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
  it("says voice typing works (simulated) and how many words are left", async () => {
    const res = await sessionRoute.GET(new Request("http://localhost/api/desktop/session", { headers: device }));
    const body = await res.json();
    expect(body.voice).toMatchObject({ available: true, polish: true, simulated: true, usage: { limit: 8000 } });
    expect(body.voice.usage.words).toBeGreaterThan(0);
    expect(body.bots.map((b: { name: string }) => b.name)).toEqual(["Otto"]);
  });
});
