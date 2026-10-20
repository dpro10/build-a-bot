/**
 * Meeting notes: concurrency, deletion and housekeeping edge cases found in review.
 * Same in-memory Postgres + demo brain + demo transcript as tests/meetings.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
// The scripted meeting (tests only: without it, no speech-to-text means no transcript at all).
process.env.DEMO_SPEECH = "1";
delete process.env.DATABASE_URL;
delete process.env.TOKEN_FACTORY_API_KEY;
delete process.env.TRANSCRIBE_API_KEY;

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { addChunk, deleteMeeting, expireTranscripts, finishMeeting, renameMeeting, staleRecordings, startMeeting } = await import("@/lib/meetings");
const { rescueStuckNotes, writeMeetingNotes } = await import("@/lib/meetings/notes");
const { newId } = await import("@/lib/utils");
import type { Bot, Meeting, User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;

const AUDIO = new ArrayBuffer(4000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function newOwner(id: string): Promise<User> {
  const [u] = await db.insert(schema.users).values({ id, email: `${id}@example.com`, emailVerifiedAt: new Date(), name: "Dana", timezone: "America/Chicago", plan: "pro" }).returning();
  return u;
}

async function makeBot(owner: User): Promise<Bot> {
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
    timezone: "America/Chicago",
  });
  if (!res.ok) throw new Error(res.error);
  return res.bot;
}

async function recorded(bot: Bot, owner: User, chunks = 6): Promise<Meeting> {
  const started = await startMeeting(db, { bot, owner, source: "desktop", app: "zoom" });
  if (!started.ok) throw new Error(started.error);
  for (let c = 0; c < chunks; c++) {
    for (const track of ["mic", "system"] as const) {
      const r = await addChunk(db, { meeting: started.meeting, owner, track, chunk: c, startMs: c * 6000, durationMs: 6000, audio: AUDIO, mime: "audio/webm" });
      if (!r.ok) throw new Error(r.error);
    }
  }
  return finishMeeting(db, (await db.select().from(schema.meetings).where(eq(schema.meetings.id, started.meeting.id)))[0]);
}

async function notesMessages(meetingId: string) {
  const rows = await db.select().from(schema.messages);
  return rows.filter((m) => (m.meta as { meetingId?: string }).meetingId === meetingId);
}

async function row(id: string) {
  return (await db.select().from(schema.meetings).where(eq(schema.meetings.id, id)))[0];
}

/** A bare meeting row (no recorder, no transcript) for housekeeping tests. */
async function bareMeeting(bot: Bot, values: Partial<typeof schema.meetings.$inferInsert>) {
  const [m] = await db
    .insert(schema.meetings)
    .values({ id: newId("mtg"), botId: bot.id, ownerId: bot.ownerId, title: "Old call", source: "browser", status: "ready", ...values })
    .returning();
  return m;
}

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("finishing notes happens once", () => {
  it("two writers for the same meeting deliver the notes once", async () => {
    const owner = await newOwner("usr_twice");
    const bot = await makeBot(owner);
    const m = await recorded(bot, owner, 2);
    await Promise.all([writeMeetingNotes(db, m.id), writeMeetingNotes(db, m.id)]);
    expect(await notesMessages(m.id)).toHaveLength(1);
    const receipts = await db.select().from(schema.receipts).where(and(eq(schema.receipts.botId, bot.id), eq(schema.receipts.kind, "meeting")));
    expect(receipts.filter((r) => r.title.startsWith("Wrote notes"))).toHaveLength(1);
  });

  it("two housekeeping passes give a stuck meeting one honest ending, not two", async () => {
    const owner = await newOwner("usr_stuck");
    const bot = await makeBot(owner);
    const m = await recorded(bot, owner, 2);
    const longAgo = new Date(Date.now() - 30 * 60_000);
    await db
      .update(schema.meetings)
      .set({ meta: { ...(m.meta ?? {}), notesStartedAt: longAgo.toISOString(), notesVia: "llm" }, updatedAt: longAgo })
      .where(eq(schema.meetings.id, m.id));
    await Promise.all([rescueStuckNotes(db), rescueStuckNotes(db)]);
    expect((await row(m.id)).status).toBe("ready");
    expect(await notesMessages(m.id)).toHaveLength(1);
  });

  it("a meeting deleted while its notes are being written stays deleted and quiet", async () => {
    const owner = await newOwner("usr_deleted");
    const bot = await makeBot(owner);
    const m = await recorded(bot, owner, 6);
    const writing = writeMeetingNotes(db, m.id);
    await sleep(250); // the demo brain is still writing (it streams word by word)
    await deleteMeeting(db, bot, m);
    await writing;
    expect(await row(m.id)).toBeUndefined();
    expect(await notesMessages(m.id)).toHaveLength(0);
    const deliveries = await db.select().from(schema.deliveries).where(eq(schema.deliveries.botId, bot.id));
    expect(deliveries).toHaveLength(0);
  });

  it("a title the owner typed while the notes were being written is kept", async () => {
    const owner = await newOwner("usr_rename");
    const bot = await makeBot(owner);
    const m = await recorded(bot, owner, 6);
    const writing = writeMeetingNotes(db, m.id);
    await sleep(250);
    await renameMeeting(db, (await row(m.id))!, "Board prep with Sam");
    await writing;
    const done = await row(m.id);
    expect(done.status).toBe("ready");
    expect(done.title).toBe("Board prep with Sam");
    expect((done.meta as { renamed?: boolean }).renamed).toBe(true);
    expect(done.notes).toMatch(/## Action items/);
  });
});

describe("housekeeping reaches every meeting", () => {
  it("transcript retention isn't blocked by older meetings kept forever", async () => {
    const owner = await newOwner("usr_keep");
    const keeper = await makeBot(owner);
    await db.update(schema.bots).set({ limits: { transcriptDays: null } }).where(eq(schema.bots.id, keeper.id));
    const veryOld = new Date(Date.now() - 400 * 86400_000);
    await db.insert(schema.meetings).values(
      Array.from({ length: 205 }, (_, i) => ({ id: `mtg_forever_${i}`, botId: keeper.id, ownerId: owner.id, title: "Kept", source: "browser", status: "ready", startedAt: veryOld })),
    );

    const owner2 = await newOwner("usr_short");
    const short = await makeBot(owner2);
    await db.update(schema.bots).set({ limits: { transcriptDays: 30 } }).where(eq(schema.bots.id, short.id));
    const m = await bareMeeting(short, { startedAt: new Date(Date.now() - 40 * 86400_000) });
    await db.insert(schema.meetingSegments).values({ id: "seg_short", meetingId: m.id, track: "mic", chunk: 0, idx: 0, startMs: 0, endMs: 1000, speaker: "You", text: "Private words" });

    await expireTranscripts(db);
    expect(await db.select().from(schema.meetingSegments).where(eq(schema.meetingSegments.meetingId, m.id))).toHaveLength(0);
    expect(((await row(m.id)).meta as { transcriptDeletedBy?: string }).transcriptDeletedBy).toBe("retention");
    // The forever ones were never touched.
    expect(((await row("mtg_forever_0")).meta as { transcriptDeletedAt?: string }).transcriptDeletedAt).toBeUndefined();
  });

  it("an abandoned recording is wrapped up even when many paused ones are waiting", async () => {
    const owner = await newOwner("usr_paused_many");
    const bot = await makeBot(owner);
    const old = new Date(Date.now() - 60 * 60_000);
    await db.insert(schema.meetings).values(
      Array.from({ length: 45 }, (_, i) => ({
        id: `mtg_paused_${i}`,
        botId: bot.id,
        ownerId: owner.id,
        title: "Paused",
        source: "desktop",
        status: "recording",
        updatedAt: old,
        meta: { pausedAt: new Date(Date.now() - 50 * 60_000).toISOString() },
      })),
    );
    const gone = await bareMeeting(bot, { status: "recording", updatedAt: old });
    expect((await staleRecordings(db)).map((r) => r.id)).toContain(gone.id);
  });

  it("notes left waiting on an owner's computer when the Bridge went get an honest ending too", async () => {
    const owner = await newOwner("usr_bridge_left");
    const bot = await makeBot(owner);
    const old = new Date(Date.now() - 60 * 60_000);
    // Waiting on the owner's computer, from before 2026-10-20.
    const waiting = await bareMeeting(bot, { status: "processing", updatedAt: old, meta: { notesStartedAt: old.toISOString(), notesVia: "bridge" } });
    const stuck = await bareMeeting(bot, { status: "processing", updatedAt: old, meta: { notesStartedAt: old.toISOString(), notesVia: "llm" } });
    await rescueStuckNotes(db);
    for (const id of [waiting.id, stuck.id]) {
      const done = await row(id);
      expect(done.status).toBe("ready");
      expect(done.error).toMatch(/didn't get written/);
    }
  });
});

describe("follow-ups on meeting notes", () => {
  async function fullFaithBot(id: string) {
    const owner = await newOwner(id);
    const res = await createBot(db, owner, {
      avatar: "otto",
      color: "grape",
      name: "Inky",
      jobs: [],
      brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: ["meetings", "bot_inbox"],
      trust: "full",
      channels: [],
      contact: {},
      ageConfirmed: true,
      timezone: "America/Chicago",
    });
    if (!res.ok) throw new Error(res.error);
    return { owner, bot: res.bot };
  }

  async function say(bot: Bot, owner: User, text: string) {
    const { runTurn } = await import("@/lib/agent/run");
    const { ensureConversation } = await import("@/lib/channels/outbound");
    const conversation = await ensureConversation(db, bot.id, "web", "owner");
    const [fresh] = await db.select().from(schema.bots).where(eq(schema.bots.id, bot.id));
    return runTurn({ db, bot: fresh, owner, conversation, channelKind: "web", message: { text, author: "owner" } });
  }

  it("notes in the chat count as outside content: sending them to someone new asks, even under full faith", async () => {
    const { owner, bot } = await fullFaithBot("usr_followup");
    const m = await recorded(bot, owner, 6);
    await writeMeetingNotes(db, m.id);
    expect(await notesMessages(m.id)).toHaveLength(1);

    const res = await say(bot, owner, "forward the notes to new.person@example.com");
    expect(res.approvals).toHaveLength(1);
    expect(res.approvals[0].reasons).toContain("tainted_send_new_recipient");
    const sent = await db.select().from(schema.receipts).where(and(eq(schema.receipts.botId, bot.id), eq(schema.receipts.kind, "message")));
    expect(sent).toHaveLength(0);
  });

  it("without notes in the chat, full faith still sends on its own", async () => {
    const { owner, bot } = await fullFaithBot("usr_followup_clean");
    const res = await say(bot, owner, "forward the notes to new.person@example.com");
    expect(res.approvals).toHaveLength(0);
  });
});

describe("meeting minutes", () => {
  it("count the audio that was transcribed, even if a recorder keeps restarting its timeline", async () => {
    const owner = await newOwner("usr_minutes");
    const bot = await makeBot(owner);
    const started = await startMeeting(db, { bot, owner, source: "desktop", app: "zoom" });
    if (!started.ok) throw new Error(started.error);
    // Ten 60-second pieces, all claiming to start at 0:00 (an honest recorder never overlaps its own track).
    for (let c = 0; c < 10; c++) {
      const r = await addChunk(db, { meeting: started.meeting, owner, track: "mic", chunk: c, startMs: 0, durationMs: 60_000, audio: AUDIO, mime: "audio/webm" });
      if (!r.ok) throw new Error(r.error);
    }
    const m = await row(started.meeting.id);
    expect(m.durationSec).toBeGreaterThanOrEqual(600);
    const [usage] = await db.select().from(schema.usage).where(eq(schema.usage.userId, owner.id));
    expect(usage.meetingSeconds).toBeGreaterThanOrEqual(600);
  });

  it("an honest two-track recording still counts once (wall-clock), with silent pieces", async () => {
    const owner = await newOwner("usr_minutes_honest");
    const bot = await makeBot(owner);
    const started = await startMeeting(db, { bot, owner, source: "desktop", app: "zoom" });
    if (!started.ok) throw new Error(started.error);
    for (let c = 0; c < 8; c++) {
      for (const track of ["mic", "system"] as const) {
        const r = await addChunk(db, { meeting: started.meeting, owner, track, chunk: c, startMs: c * 6000, durationMs: 6000, audio: AUDIO, mime: "audio/webm", silent: c % 3 === 2 });
        if (!r.ok) throw new Error(r.error);
      }
    }
    expect((await row(started.meeting.id)).durationSec).toBe(48);
    const [usage] = await db.select().from(schema.usage).where(eq(schema.usage.userId, owner.id));
    expect(usage.meetingSeconds).toBe(48);
  });
});

describe("STOP", () => {
  it("a paused bot doesn't think or message about a meeting; the transcript waits for it", async () => {
    const { setPaused } = await import("@/lib/agent/run");
    const owner = await newOwner("usr_stop");
    const bot = await makeBot(owner);
    const m = await recorded(bot, owner, 3);
    await setPaused(db, bot, true, "STOP from telegram");
    await writeMeetingNotes(db, m.id);
    const done = await row(m.id);
    expect(done.status).toBe("ready");
    expect(done.notes).toBeNull();
    expect(done.error).toMatch(/paused/);
    expect(await notesMessages(m.id)).toHaveLength(0);
    const thought = await db.select().from(schema.receipts).where(and(eq(schema.receipts.botId, bot.id), eq(schema.receipts.kind, "billing")));
    expect(thought).toHaveLength(0);
  });
});

describe("audio uploads", () => {
  it("a streamed body without a length can't make the server buffer more than one chunk's limit", async () => {
    const { sha256 } = await import("@/lib/crypto");
    const audioRoute = await import("@/app/api/bots/[botId]/meetings/[meetingId]/audio/route");
    const { CHUNK_MAX_BYTES } = await import("@/lib/meetings");
    const owner = await newOwner("usr_stream");
    const bot = await makeBot(owner);
    await db.insert(schema.bridgeDevices).values({ id: "dev_stream", ownerId: owner.id, name: "Mac", tokenHash: sha256("bab_dev_stream_token"), platform: "desktop-darwin-arm64" });
    const started = await startMeeting(db, { bot, owner, source: "desktop", deviceId: "dev_stream" });
    if (!started.ok) throw new Error(started.error);
    let pulled = 0;
    const piece = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += piece.byteLength;
        if (pulled > 64 * 1024 * 1024) controller.close();
        else controller.enqueue(piece);
      },
    });
    const res = await audioRoute.POST(
      new Request(`http://localhost/api?track=mic&chunk=0&startMs=0&durationMs=6000`, {
        method: "POST",
        headers: { authorization: "Bearer bab_dev_stream_token", "content-type": "audio/webm" },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
      { params: Promise.resolve({ botId: bot.id, meetingId: started.meeting.id }) },
    );
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(CHUNK_MAX_BYTES + 4 * 1024 * 1024);
  });
});

describe("STOP while notes are stuck", () => {
  it("a paused bot's stuck meeting gets an honest ending, and nothing is sent while paused", async () => {
    const { setPaused } = await import("@/lib/agent/run");
    const owner = await newOwner("usr_stop_stuck");
    const bot = await makeBot(owner);
    const m = await recorded(bot, owner, 2);
    await setPaused(db, bot, true, "STOP from telegram");
    // A server crashed while writing them, a while ago.
    const longAgo = new Date(Date.now() - 20 * 60_000);
    await db
      .update(schema.meetings)
      .set({ meta: { ...(m.meta ?? {}), notesStartedAt: longAgo.toISOString(), notesVia: "llm" }, updatedAt: longAgo })
      .where(eq(schema.meetings.id, m.id));
    await rescueStuckNotes(db);
    const done = await row(m.id);
    expect(done.status).toBe("ready");
    expect(done.error).toMatch(/didn't get written/);
    expect(await notesMessages(m.id)).toHaveLength(0);
  });
});

describe("meeting settings changed during a recording", () => {
  it("pausing, renaming or copying the heads-up from an older copy of the meeting doesn't undo what uploads recorded", async () => {
    const { setPaused, markNoticeCopied } = await import("@/lib/meetings");
    const owner = await newOwner("usr_clobber");
    const bot = await makeBot(owner);
    const started = await startMeeting(db, { bot, owner, source: "desktop", app: "zoom" });
    if (!started.ok) throw new Error(started.error);
    const stale = started.meeting; // what a PATCH read before the uploads below finished
    for (let c = 0; c < 2; c++) {
      const r = await addChunk(db, { meeting: stale, owner, track: "mic", chunk: c, startMs: 0, durationMs: 60_000, audio: AUDIO, mime: "audio/webm" });
      if (!r.ok) throw new Error(r.error);
    }
    await setPaused(db, stale, true);
    await renameMeeting(db, stale, "Weekly sync");
    await markNoticeCopied(db, stale);
    await setPaused(db, stale, false);
    const r = await addChunk(db, { meeting: stale, owner, track: "mic", chunk: 2, startMs: 0, durationMs: 60_000, audio: AUDIO, mime: "audio/webm" });
    if (!r.ok) throw new Error(r.error);
    const m = await row(stale.id);
    expect(m.durationSec).toBeGreaterThanOrEqual(180);
    expect(m.title).toBe("Weekly sync");
    expect(m.meta).toMatchObject({ renamed: true, consent: { noticeCopied: true, via: "desktop" }, transcribedBy: "demo/demo" });
    expect((m.meta as { pausedAt?: string }).pausedAt).toBeUndefined();
  });
});

describe("a recording replaced by a new one", () => {
  it("is handed back so its notes get written now, not at the next rescue", async () => {
    const owner = await newOwner("usr_replaced");
    const bot = await makeBot(owner);
    const first = await startMeeting(db, { bot, owner, source: "desktop", app: "zoom" });
    if (!first.ok) throw new Error(first.error);
    expect(first.replaced).toEqual([]);
    const r = await addChunk(db, { meeting: first.meeting, owner, track: "mic", chunk: 0, startMs: 0, durationMs: 6000, audio: AUDIO, mime: "audio/webm" });
    if (!r.ok) throw new Error(r.error);

    // The same browser starts again (the tab was closed mid-call).
    const second = await startMeeting(db, { bot, owner, source: "desktop", app: "zoom" });
    if (!second.ok) throw new Error(second.error);
    expect(second.replaced).toEqual([first.meeting.id]);
    expect((await row(first.meeting.id)).status).toBe("processing");

    await writeMeetingNotes(db, first.meeting.id);
    expect((await row(first.meeting.id)).status).toBe("ready");
  });
});
