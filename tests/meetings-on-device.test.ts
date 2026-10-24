/**
 * Meeting notes as build-a-bot.site takes them: demo mode, no speech-to-text of its own, and no
 * scripted speech (DEMO_SPEECH=0). Diego (2026-10-16): "Maybe meeting notes, then, should also be
 * something you can only have if you download the app."
 *
 * - The desktop app hears the call on the computer (NVIDIA Parakeet) and sends only the lines:
 *   start → lines → live transcript → finish → notes, through the real routes.
 * - The website can't start a meeting or send what was said (it lists, stops and deletes).
 * - A recording sent to a server that can't hear it is refused: nothing is made up.
 * - A meeting the computer is still hearing (Parakeet was downloading) isn't wrapped up early.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
// As on the live site (a production build): no scripted speech.
process.env.DEMO_SPEECH = "0";
delete process.env.DATABASE_URL;
for (const key of ["TOKEN_FACTORY_API_KEY", "TRANSCRIBE_API_KEY", "TRANSCRIBE_FALLBACK_API_KEY"]) delete process.env[key];

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => session.user,
}));
// The notes are written right after the finish route answers.
const background = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => void background.push(Promise.resolve().then(fn)),
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { sha256 } = await import("@/lib/crypto");
const { cleanHeard, HEARD_ON_DEVICE, STOP_GRACE, staleRecordings } = await import("@/lib/meetings");
// Stopped from the website, the notes wait for the app's last pieces: not in these tests.
STOP_GRACE.notesDelayMs = 0;
const meetingsRoute = await import("@/app/api/bots/[botId]/meetings/route");
const meetingRoute = await import("@/app/api/bots/[botId]/meetings/[meetingId]/route");
const audioRoute = await import("@/app/api/bots/[botId]/meetings/[meetingId]/audio/route");
const finishRoute = await import("@/app/api/bots/[botId]/meetings/[meetingId]/finish/route");
const sessionRoute = await import("@/app/api/desktop/session/route");
import type { Bot, User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;
let bot: Bot;
const TOKEN = "bab_dev_on_device_meetings";
const device = { authorization: `Bearer ${TOKEN}` };
const site = { origin: "http://localhost", host: "localhost" };

const botParams = () => ({ params: Promise.resolve({ botId: bot.id }) });
const meetingParams = (meetingId: string) => ({ params: Promise.resolve({ botId: bot.id, meetingId }) });

function heardReq(meetingId: string, q: string, heard: unknown, headers: Record<string, string> = device) {
  return audioRoute.POST(
    new Request(`http://localhost/api?${q}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ heard }) }),
    meetingParams(meetingId),
  );
}

async function startOnTheComputer(app = "zoom") {
  const res = await meetingsRoute.POST(new Request("http://localhost/api", { method: "POST", headers: { ...device, "content-type": "application/json" }, body: JSON.stringify({ app }) }), botParams());
  expect(res.status).toBe(201);
  return (await res.json()) as { meeting: { id: string; source: string; status: string }; chunkMs: number };
}

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner] = await db.insert(schema.users).values({ id: "usr_dana", email: "dana@example.com", name: "Dana", emailVerifiedAt: new Date(), timezone: "UTC", plan: "free" }).returning();
  const res = await createBot(db, owner, {
    avatar: "otto",
    color: "grape",
    name: "Inky",
    jobs: [],
    brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
    connectors: ["meetings"],
    trust: "ask",
    channels: [],
    contact: {},
    ageConfirmed: true,
    timezone: "UTC",
  });
  if (!res.ok) throw new Error(res.error);
  bot = res.bot;
  await db.insert(schema.bridgeDevices).values({ id: "dev_mac", ownerId: owner.id, name: "Dana's Mac", tokenHash: sha256(TOKEN), platform: "desktop-darwin-arm64" });
});

afterAll(async () => {
  await resetDbForTests();
});

describe("meeting notes heard on the computer (no speech-to-text here)", () => {
  it("are offered to the desktop app, from what it hears", async () => {
    const body = await (await sessionRoute.GET(new Request("http://localhost/api", { headers: device }))).json();
    // This server can't hear audio itself, but takes the lines the app heard.
    expect(body.meetings).toMatchObject({ available: false, local: true, chunkMs: 20_000 });
    expect(body.bots.find((b: { id: string }) => b.id === bot.id)).toMatchObject({ meetingsOn: true });
  });

  it("start → lines heard on the computer → live transcript → finish → notes", async () => {
    const { meeting, chunkMs } = await startOnTheComputer();
    expect(meeting.source).toBe("desktop");
    expect(chunkMs).toBe(20_000);

    const pieces = [
      { q: "track=mic&chunk=0&startMs=0&durationMs=20000", heard: [{ startMs: 500, endMs: 4200, text: "Thanks for joining. Let's lock the launch plan." }] },
      { q: "track=system&chunk=0&startMs=0&durationMs=20000", heard: [{ startMs: 5200, endMs: 9800, text: "Priya will send the release notes by Thursday." }] },
      { q: "track=mic&chunk=1&startMs=20000&durationMs=20000&silent=1", heard: [] },
      {
        q: "track=system&chunk=1&startMs=20000&durationMs=20000",
        heard: [
          { startMs: 1000, endMs: 6000, text: "We ship the beta on Friday." },
          { startMs: 7000, endMs: 9000, text: "Great, see you then." },
        ],
      },
    ];
    for (const p of pieces) {
      const res = await heardReq(meeting.id, p.q, p.heard);
      expect(res.status).toBe(200);
    }
    // A retry of the same piece gets the same lines back, and isn't counted twice.
    const again = await heardReq(meeting.id, pieces[0].q, pieces[0].heard);
    expect(await again.json()).toMatchObject({ duplicate: true, segments: [{ text: "Thanks for joining. Let's lock the launch plan." }] });

    const live = await (await meetingRoute.GET(new Request("http://localhost/api", { headers: device }), meetingParams(meeting.id))).json();
    expect(live.meeting.status).toBe("recording");
    expect(live.segments.map((s: { speaker: string; startMs: number; text: string }) => [s.speaker, s.startMs, s.text])).toEqual([
      ["You", 500, "Thanks for joining. Let's lock the launch plan."],
      ["Others", 5200, "Priya will send the release notes by Thursday."],
      ["Others", 21_000, "We ship the beta on Friday."],
      ["Others", 27_000, "Great, see you then."],
    ]);

    const [row] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, meeting.id));
    expect(row.durationSec).toBe(40);
    expect(row.meta).toMatchObject({ transcribedBy: HEARD_ON_DEVICE, heardMs: { mic: 20_000, system: 40_000 } });
    const [usage] = await db.select().from(schema.usage).where(eq(schema.usage.userId, owner.id));
    expect(usage.meetingSeconds).toBe(40);

    const done = await finishRoute.POST(new Request("http://localhost/api", { method: "POST", headers: device }), meetingParams(meeting.id));
    expect((await done.json()).meeting.status).toBe("processing");
    await Promise.all(background.splice(0));
    const [written] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, meeting.id));
    expect(written.status).toBe("ready");
    expect(written.notes).toBeTruthy();
    expect(written.summary).toBeTruthy();
  });

  it("refuses a recording it can't hear: nothing is made up", async () => {
    const { meeting } = await startOnTheComputer("meet");
    const audio = (q: string) =>
      audioRoute.POST(new Request(`http://localhost/api?${q}`, { method: "POST", headers: { ...device, "content-type": "audio/webm" }, body: new Uint8Array(4000).fill(1) }), meetingParams(meeting.id));
    const res = await audio("track=mic&chunk=0&startMs=0&durationMs=20000");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "unavailable" });
    // A silent piece needs no hearing: it only marks the time.
    expect((await audio("track=system&chunk=0&startMs=0&durationMs=20000&silent=1")).status).toBe(200);
    const live = await (await meetingRoute.GET(new Request("http://localhost/api", { headers: device }), meetingParams(meeting.id))).json();
    expect(live.segments).toEqual([]);
    await finishRoute.POST(new Request("http://localhost/api", { method: "POST", headers: device }), meetingParams(meeting.id));
    await Promise.all(background.splice(0));
  });

  it("checks what the app sends", async () => {
    const { meeting } = await startOnTheComputer();
    const send = (body: string, type = "application/json") =>
      audioRoute.POST(new Request("http://localhost/api?track=mic&chunk=0&startMs=0&durationMs=20000", { method: "POST", headers: { ...device, "content-type": type }, body }), meetingParams(meeting.id));
    expect((await send("{not json")).status).toBe(400);
    expect((await send(JSON.stringify({ heard: "hello" }))).status).toBe(422);
    expect((await send(JSON.stringify({ heard: [{ startMs: -1, endMs: 2, text: "x" }] }))).status).toBe(422);
    expect((await send("x".repeat(300 * 1024))).status).toBe(413);
    expect((await send("hi", "text/plain")).status).toBe(415);
    await finishRoute.POST(new Request("http://localhost/api", { method: "POST", headers: device }), meetingParams(meeting.id));
    await Promise.all(background.splice(0));
  });

  it("tidies the lines and keeps them within their piece", () => {
    expect(
      cleanHeard(
        [
          { startMs: 9000, endMs: 30_000, text: "  Second\u0007 line  " },
          { startMs: -5, endMs: 2000, text: "First line." },
          { startMs: 3000, endMs: 1000, text: "   " },
        ],
        20_000,
      ),
    ).toEqual([
      { startMs: 0, endMs: 2000, text: "First line." },
      { startMs: 9000, endMs: 20_000, text: "Second line" },
    ]);
    const many = cleanHeard(Array.from({ length: 400 }, (_, i) => ({ startMs: i, endMs: i + 1, text: "y".repeat(500) })), 20_000);
    expect(many.reduce((n, l) => n + l.text.length, 0)).toBeLessThanOrEqual(30_000);
  });

  it("keeps a meeting the computer is still hearing", async () => {
    const { meeting } = await startOnTheComputer();
    const longAgo = new Date(Date.now() - 25 * 60_000);
    await db.update(schema.meetings).set({ updatedAt: longAgo }).where(eq(schema.meetings.id, meeting.id));
    expect((await staleRecordings(db)).map((m) => m.id)).toContain(meeting.id);
    // NVIDIA Parakeet was still downloading: the app says it's still hearing this one.
    const res = await meetingRoute.PATCH(
      new Request("http://localhost/api", { method: "PATCH", headers: { ...device, "content-type": "application/json" }, body: JSON.stringify({ hearing: true }) }),
      meetingParams(meeting.id),
    );
    expect(res.status).toBe(200);
    expect((await staleRecordings(db)).map((m) => m.id)).not.toContain(meeting.id);
    const [row] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, meeting.id));
    expect(typeof (row.meta as { hearingAt?: string }).hearingAt).toBe("string");
    await finishRoute.POST(new Request("http://localhost/api", { method: "POST", headers: device }), meetingParams(meeting.id));
    await Promise.all(background.splice(0));
  });
});

describe("the website", () => {
  it("stopped from the website, a piece already on its way keeps only what was said before the Stop", async () => {
    const { meeting } = await startOnTheComputer();
    const now = Date.now();
    // 30 s in, the owner pressed Stop on the website; the app hasn't heard of it yet.
    await db.update(schema.meetings).set({ startedAt: new Date(now - 30_000), endedAt: new Date(now), status: "processing" }).where(eq(schema.meetings.id, meeting.id));
    const res = await heardReq(meeting.id, "track=system&chunk=1&startMs=20000&durationMs=20000", [
      { startMs: 5000, endMs: 8000, text: "Before the stop." },
      { startMs: 15_000, endMs: 18_000, text: "After the stop." },
    ]);
    expect(res.status).toBe(200);
    const segments = await db.select().from(schema.meetingSegments).where(eq(schema.meetingSegments.meetingId, meeting.id));
    expect(segments.map((s) => s.text).filter(Boolean)).toEqual(["Before the stop."]);
    // Its length ends at the Stop too (with two seconds for the clocks).
    const [row] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, meeting.id));
    expect(row.durationSec).toBe(32);
  });

  it("can't start a meeting or send what was said, only the desktop app can", async () => {
    session.user = owner;
    try {
      const start = await meetingsRoute.POST(new Request("http://localhost/api", { method: "POST", headers: { ...site, "content-type": "application/json" }, body: JSON.stringify({ app: "zoom" }) }), botParams());
      expect(start.status).toBe(403);
      expect(await start.json()).toMatchObject({ code: "app_only", error: "Meeting notes are taken in the desktop app." });

      session.user = null;
      const { meeting } = await startOnTheComputer();
      session.user = owner;
      const sent = await heardReq(meeting.id, "track=mic&chunk=0&startMs=0&durationMs=20000", [{ startMs: 0, endMs: 1000, text: "Hi." }], site);
      expect(sent.status).toBe(403);
      const audio = await audioRoute.POST(
        new Request("http://localhost/api?track=mic&chunk=0&startMs=0&durationMs=20000", { method: "POST", headers: { ...site, "content-type": "audio/webm" }, body: new Uint8Array(4000) }),
        meetingParams(meeting.id),
      );
      expect(audio.status).toBe(403);

      // The website lists meetings and can stop the app's recording.
      const list = await (await meetingsRoute.GET(new Request("http://localhost/api"), botParams())).json();
      expect(list).toMatchObject({ enabled: true, available: true });
      expect(list.meetings.find((m: { id: string }) => m.id === meeting.id)).toMatchObject({ status: "recording", source: "desktop" });
      const stop = await finishRoute.POST(new Request("http://localhost/api", { method: "POST", headers: site }), meetingParams(meeting.id));
      expect((await stop.json()).meeting.status).toBe("processing");
      await Promise.all(background.splice(0));
    } finally {
      session.user = null;
    }
  });
});
