/**
 * Meeting notes: the desktop app notices a call and asks; only after the owner says yes does it
 * listen. NVIDIA Parakeet turns each ~20-second piece of the call into text on the owner's own
 * computer, and only those lines come here. When the meeting ends, the bot writes the notes.
 *
 *   start → lines heard on the computer (mic = the owner, system = everyone else) → live transcript
 *   → finish → notes by the bot's own brain (src/lib/meetings/notes.ts) → sent to the owner
 *
 * The audio never leaves the computer. A server with speech-to-text of its own also takes the
 * audio of a piece from an app that can't run Parakeet (it's turned into text in memory and thrown
 * away); one without never makes words up. Only the text is kept, and the owner can delete any
 * meeting.
 */
import { and, asc, desc, eq, gt, ilike, inArray, lt, ne, or, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Bot, Meeting, MeetingSegment, User } from "@/lib/db/schema";
import { recordUsage } from "@/lib/billing/usage";
import { hasCredit, outOfCreditMessage } from "@/lib/billing/credit";
import { config, creditOpen, demoMode, demoSpeech } from "@/lib/env";
import { receipt } from "@/lib/agent/run";
import { transcribe, transcriptionAvailable, TranscriptionError } from "@/lib/transcribe";
import { newId, sortableId, truncate } from "@/lib/utils";
import { defaultMeetingTitle, isMeetingApp, meetingAppName, type MeetingAppId } from "./apps";

export const MEETINGS_CONNECTOR = "meetings";
/** How long each piece of a call is. Shorter with scripted speech (tests) so the script shows up quickly. */
export const CHUNK_MS = demoSpeech ? 6_000 : 20_000;
export const CHUNK_MAX_BYTES = 8 * 1024 * 1024;
export const CHUNK_MAX_MS = 5 * 60_000;
export const MAX_MEETING_MS = 4 * 3600_000;
/** No audio for this long: the recorder is gone (closed laptop, crashed app), so wrap the meeting up. */
export const STALE_RECORDING_MS = 20 * 60_000;

export type MeetingTrack = "mic" | "system";
export const TRACKS: MeetingTrack[] = ["mic", "system"];

/**
 * The desktop app (desktop/) as the pages show it: its download once signed builds are published
 * (NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL), how to run it from the repo in demo mode, or "Coming soon".
 */
export type DesktopApp = { status: "download"; url: string } | { status: "repo" } | { status: "soon" };

export function desktopApp(): DesktopApp {
  if (config.desktop.downloadUrl) return { status: "download", url: config.desktop.downloadUrl };
  return demoMode ? { status: "repo" } : { status: "soon" };
}

/**
 * Meeting notes can be taken here: they happen in the desktop app (it hears the call on the
 * computer), so they're offered wherever the app can be had. Otherwise they're "Coming soon".
 */
export function meetingNotesAvailable(): boolean {
  return desktopApp().status !== "soon";
}

/**
 * Writing this bot's notes costs money: they're written by an included model (paid from credit),
 * not the owner's own AI key or subscription (free here).
 */
export async function notesCostCredit(db: Db, bot: Bot): Promise<boolean> {
  const { resolveBrain } = await import("@/lib/agent/brain");
  const brain = await resolveBrain(db, bot);
  return brain.kind === "llm" && brain.included && brain.providerId !== "demo";
}

export type MeetingView = {
  id: string;
  botId: string;
  title: string;
  app: MeetingAppId;
  appName: string;
  source: "browser" | "desktop";
  status: "recording" | "processing" | "ready" | "failed";
  startedAt: string;
  endedAt: string | null;
  durationSec: number;
  summary: string | null;
  notes: string | null;
  actionItems: { text: string; owner?: string; due?: string; done?: boolean }[];
  error: string | null;
  /** Which brain wrote the notes, e.g. "Nemotron 3.5 Lightning". */
  notesBy: string | null;
  /** The notes are being written on the owner's computer (Bridge). */
  waitingForComputer: boolean;
  /** One microphone in a room: lines are labeled "Room", not the owner. */
  inPerson: boolean;
  /** The transcript was deleted (by the owner or the retention setting); the notes stay. */
  transcriptDeleted: boolean;
  /** The owner copied the heads-up for the call (before or during the recording). */
  noticeCopied: boolean;
  /** Recording, but paused by the owner. */
  paused: boolean;
};

/** Transcripts are kept this long unless the owner picks otherwise (notes stay until deleted). */
export const DEFAULT_TRANSCRIPT_DAYS = 90;

export type SegmentView = { id: string; track: MeetingTrack; speaker: string; startMs: number; endMs: number; text: string; createdAt: string };

export function meetingView(m: Meeting): MeetingView {
  const meta = m.meta ?? {};
  return {
    id: m.id,
    botId: m.botId,
    title: m.title,
    app: isMeetingApp(m.app) ? m.app : "other",
    appName: meetingAppName(m.app),
    source: m.source === "desktop" ? "desktop" : "browser",
    status: (["recording", "processing", "ready", "failed"].includes(m.status) ? m.status : "failed") as MeetingView["status"],
    startedAt: m.startedAt.toISOString(),
    endedAt: m.endedAt?.toISOString() ?? null,
    durationSec: m.durationSec,
    summary: m.summary,
    notes: m.notes,
    actionItems: m.actionItems ?? [],
    error: m.error,
    notesBy: typeof meta.notesBy === "string" ? meta.notesBy : null,
    waitingForComputer: m.status === "processing" && meta.notesVia === "bridge",
    inPerson: meta.inPerson === true,
    transcriptDeleted: typeof meta.transcriptDeletedAt === "string",
    noticeCopied: Boolean((meta.consent as { noticeCopied?: boolean } | undefined)?.noticeCopied),
    paused: m.status === "recording" && typeof meta.pausedAt === "string",
  };
}

export function segmentView(s: MeetingSegment): SegmentView {
  return {
    id: s.id,
    track: s.track === "mic" ? "mic" : "system",
    speaker: s.speaker,
    startMs: s.startMs,
    endMs: s.endMs,
    text: s.text,
    createdAt: s.createdAt.toISOString(),
  };
}

export type MeetingFailure = { ok: false; status: number; error: string; code?: string; meetingId?: string };

export async function meetingsEnabled(db: Db, botId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: schema.connections.status })
    .from(schema.connections)
    .where(and(eq(schema.connections.botId, botId), eq(schema.connections.connectorId, MEETINGS_CONNECTOR)))
    .limit(1);
  return Boolean(row && row.status !== "disabled");
}

export async function listMeetings(db: Db, botId: string, limit = 50): Promise<Meeting[]> {
  return db.select().from(schema.meetings).where(eq(schema.meetings.botId, botId)).orderBy(desc(schema.meetings.startedAt)).limit(limit);
}

export async function getMeeting(db: Db, botId: string, meetingId: string): Promise<Meeting | null> {
  const [m] = await db
    .select()
    .from(schema.meetings)
    .where(and(eq(schema.meetings.id, meetingId), eq(schema.meetings.botId, botId)))
    .limit(1);
  return m ?? null;
}

/** Transcript lines in time order; `since` returns lines stored after that moment (minus a little slack for concurrent uploads). */
export async function getSegments(db: Db, meetingId: string, opts: { since?: Date } = {}): Promise<MeetingSegment[]> {
  const conds = [eq(schema.meetingSegments.meetingId, meetingId), ne(schema.meetingSegments.text, "")];
  if (opts.since) conds.push(gt(schema.meetingSegments.createdAt, new Date(opts.since.getTime() - 15_000)));
  return db
    .select()
    .from(schema.meetingSegments)
    .where(and(...conds))
    .orderBy(asc(schema.meetingSegments.startMs), asc(schema.meetingSegments.track), asc(schema.meetingSegments.idx));
}

export function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** "[2:05] Dana: …" lines for the notes writer and the bot's tools. */
export function transcriptLines(segments: Pick<MeetingSegment, "startMs" | "speaker" | "track" | "text">[], ownerLabel: string): string[] {
  return segments
    .filter((s) => s.text.trim())
    .map((s) => `[${clock(s.startMs)}] ${s.track === "mic" && s.speaker !== "Room" ? ownerLabel : s.speaker || "Others"}: ${s.text.trim()}`);
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.max(sec, 0)} sec`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} hr${m % 60 ? ` ${m % 60} min` : ""}`;
}

// ---------------------------------------------------------------------------
// start → chunks → finish

export async function startMeeting(
  db: Db,
  input: {
    bot: Bot;
    owner: User;
    /** Notes are taken in the desktop app ("browser" is for meetings recorded before it was the only way). */
    source: "desktop";
    app?: string;
    title?: string;
    deviceId?: string | null;
    /** One microphone in a room (no call audio). */
    inPerson?: boolean;
    /** The owner copied the heads-up for the call before starting. */
    consentNotice?: boolean;
  },
): Promise<{ ok: true; meeting: Meeting; replaced: string[] } | MeetingFailure> {
  const { bot, owner } = input;
  if (bot.status === "paused") return { ok: false, status: 409, code: "paused", error: `${bot.name} is paused. Resume it to take notes.` };
  if (!meetingNotesAvailable()) return { ok: false, status: 503, code: "unavailable", error: "Meeting notes are coming soon." };
  if (!(await meetingsEnabled(db, bot.id))) {
    return { ok: false, status: 409, code: "meetings_off", error: `Turn on Meeting notes for ${bot.name} first.` };
  }
  // The call is heard on the computer (free); writing the notes costs what the bot's brain does.
  if (!(await hasCredit(db, owner.id)) && (await notesCostCredit(db, bot))) {
    return { ok: false, status: 402, code: "no_credit", error: outOfCreditMessage({ canAdd: creditOpen, ownBrain: true }) };
  }

  // One recording per bot at a time. A leftover from the same recorder (crash, closed tab) is wrapped up instead.
  const active = await db
    .select()
    .from(schema.meetings)
    .where(and(eq(schema.meetings.botId, bot.id), eq(schema.meetings.status, "recording")));
  /** Leftovers wrapped up here: the caller writes their notes (as the finish route does). */
  const replaced: string[] = [];
  for (const m of active) {
    const stale = Date.now() - m.updatedAt.getTime() > STALE_RECORDING_MS;
    const sameRecorder = m.source === input.source && (m.deviceId ?? null) === (input.deviceId ?? null);
    if (stale || sameRecorder) {
      const done = await finishMeeting(db, m, { reason: "replaced" });
      if (done.status === "processing") replaced.push(done.id);
    } else return { ok: false, status: 409, code: "already_recording", meetingId: m.id, error: `${bot.name} is already taking notes in another meeting.` };
  }

  const app: MeetingAppId = isMeetingApp(input.app) ? input.app : "other";
  const now = new Date();
  const [meeting] = await db
    .insert(schema.meetings)
    .values({
      id: newId("mtg"),
      botId: bot.id,
      ownerId: owner.id,
      title: input.title?.trim().slice(0, 120) || defaultMeetingTitle(app, now, owner.timezone || "UTC"),
      app,
      source: input.source,
      deviceId: input.deviceId ?? null,
      status: "recording",
      startedAt: now,
      meta: {
        ...(input.title?.trim() ? { renamed: true } : {}),
        ...(input.inPerson ? { inPerson: true } : {}),
        // Proof that we asked: who said yes, when, where, and whether they told the others.
        consent: { acceptedAt: now.toISOString(), via: input.source, deviceId: input.deviceId ?? null, noticeCopied: Boolean(input.consentNotice) },
      },
    })
    .returning();
  await receipt(db, bot, "meeting", "ok", `Started taking notes${app === "other" || app === "browser" ? "" : ` in ${meetingAppName(app)}`}`, {
    meetingId: meeting.id,
    source: input.source,
    deviceId: input.deviceId ?? null,
  });
  return { ok: true, meeting, replaced };
}

/** A line heard in one piece of a call, its times within that piece. */
export type HeardLine = { startMs: number; endMs: number; text: string };
export const HEARD_MAX_LINES = 300;
export const HEARD_MAX_CHARS = 30_000;
/** The label kept with the meeting for lines heard on the owner's computer. */
export const HEARD_ON_DEVICE = "nvidia/parakeet-tdt-0.6b-v3 (on the computer)";

/**
 * What the desktop app heard in one piece of a call (NVIDIA Parakeet, on the owner's computer):
 * tidied, kept within the piece and in time order. Empty lines are dropped.
 */
export function cleanHeard(lines: HeardLine[], durationMs: number): HeardLine[] {
  const out: HeardLine[] = [];
  let chars = 0;
  for (const line of lines.slice(0, HEARD_MAX_LINES)) {
    // Control characters (nothing a speech model writes) become spaces.
    // eslint-disable-next-line no-control-regex
    const text = String(line.text ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);
    if (!text) continue;
    chars += text.length;
    if (chars > HEARD_MAX_CHARS) break;
    const startMs = Math.min(Math.max(0, Math.round(Number(line.startMs) || 0)), durationMs);
    const endMs = Math.min(Math.max(startMs, Math.round(Number(line.endMs) || 0)), durationMs);
    out.push({ startMs, endMs, text });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

export type ChunkInput = {
  meeting: Meeting;
  owner: User;
  track: MeetingTrack;
  chunk: number;
  startMs: number;
  durationMs: number;
  /** What the desktop app heard in this piece, on the computer: no audio comes here. */
  heard?: HeardLine[];
  /** The piece's audio, from an app that can't hear it itself; only a server with speech-to-text takes it. */
  audio?: ArrayBuffer;
  mime?: string;
  /** The recorder measured no sound in this chunk: nothing to hear (saves work, avoids phantom lines). */
  silent?: boolean;
};

export async function addChunk(db: Db, input: ChunkInput): Promise<{ ok: true; segments: MeetingSegment[]; duplicate?: boolean; warning?: string } | MeetingFailure> {
  const { meeting, owner, track, chunk } = input;
  const audio = input.heard ? null : (input.audio ?? new ArrayBuffer(0));
  if (meeting.status !== "recording") return { ok: false, status: 409, code: "not_recording", error: "This meeting isn't recording anymore." };
  if (!Number.isInteger(chunk) || chunk < 0 || chunk > 5000) return { ok: false, status: 422, error: "Bad chunk number" };
  if (input.startMs < 0 || input.startMs > MAX_MEETING_MS) return { ok: false, status: 422, code: "too_long", error: "Meetings can be up to 4 hours." };
  if (input.durationMs < 1 || input.durationMs > CHUNK_MAX_MS) return { ok: false, status: 422, error: "Chunks must be under 5 minutes" };
  if (audio && audio.byteLength > CHUNK_MAX_BYTES) return { ok: false, status: 413, error: "Audio chunk too large" };
  // Audio to hear needs speech-to-text here; without it nothing is made up (the app hears it itself).
  const toHear = Boolean(audio && !input.silent && audio.byteLength >= 800);
  if (toHear && !transcriptionAvailable()) {
    return { ok: false, status: 503, code: "unavailable", error: "This server doesn't turn recordings into text: the desktop app hears meetings on your computer." };
  }

  // Retries are free: a chunk that was already transcribed returns what we have.
  const existing = await db
    .select()
    .from(schema.meetingSegments)
    .where(and(eq(schema.meetingSegments.meetingId, meeting.id), eq(schema.meetingSegments.track, track), eq(schema.meetingSegments.chunk, chunk)));
  if (existing.length) return { ok: true, segments: existing.filter((s) => s.text), duplicate: true };

  // Audio heard here costs speech-to-text; lines heard on the computer are free.
  if (toHear && !(await hasCredit(db, owner.id))) return { ok: false, status: 402, code: "no_credit", error: outOfCreditMessage({ canAdd: creditOpen }) };

  let segments: { startMs: number; endMs: number; text: string }[] = [];
  let warning: string | undefined;
  let provider: string | undefined;
  /** Audio that was heard (on the computer, or by speech-to-text here), for the meeting's minutes. */
  let heardMs = 0;
  /** What hearing it here cost (speech-to-text); hearing it on the computer costs nothing. */
  let sttMicros = 0;
  if (input.heard) {
    segments = cleanHeard(input.heard, input.durationMs);
    provider = HEARD_ON_DEVICE;
    // Lines count as heard even in a piece marked silent: there was speech in it after all.
    heardMs = segments.length || !input.silent ? input.durationMs : 0;
  } else if (audio && toHear) {
    const recent = await db
      .select({ text: schema.meetingSegments.text })
      .from(schema.meetingSegments)
      .where(and(eq(schema.meetingSegments.meetingId, meeting.id), ne(schema.meetingSegments.text, "")))
      .orderBy(desc(schema.meetingSegments.createdAt))
      .limit(4);
    try {
      const result = await transcribe({
        audio,
        mime: input.mime ?? "audio/webm",
        durationMs: input.durationMs,
        prompt: recent.reverse().map((r) => r.text).join(" ") || undefined,
        track,
        chunk,
      });
      segments = result.segments;
      provider = `${result.provider}/${result.model}`;
      sttMicros = result.costMicros;
      // The provider's own measure wins when the recorder said much less (it can't shrink what's billed).
      heardMs = result.audioMs && result.audioMs > input.durationMs + 1000 ? result.audioMs : input.durationMs;
    } catch (err) {
      if (err instanceof TranscriptionError && err.retryable) return { ok: false, status: 503, code: "retry", error: "Speech-to-text is busy. The recorder will retry this chunk." };
      // Unreadable audio won't get better on retry: mark it so the recorder moves on.
      warning = err instanceof Error ? truncate(err.message, 200) : "Couldn't transcribe this part.";
    }
  }

  const speaker = track === "mic" ? ((meeting.meta as { inPerson?: boolean } | null)?.inPerson ? "Room" : "You") : "Others";
  const rows = segments.length
    ? segments.map((s, i) => ({
        id: sortableId("seg"),
        meetingId: meeting.id,
        track,
        chunk,
        idx: i,
        startMs: input.startMs + Math.min(s.startMs, input.durationMs),
        endMs: input.startMs + Math.min(Math.max(s.endMs, s.startMs), input.durationMs),
        speaker,
        text: s.text,
      }))
    : [{ id: sortableId("seg"), meetingId: meeting.id, track, chunk, idx: -1, startMs: input.startMs, endMs: input.startMs + input.durationMs, speaker, text: "" }];
  const inserted = await db.insert(schema.meetingSegments).values(rows).onConflictDoNothing().returning();
  // A concurrent retry of the same chunk already counted it.
  if (!inserted.length) {
    heardMs = 0;
    sttMicros = 0;
  }

  // Meeting length follows wall-clock time, whichever track gets there first.
  // The timeline comes from the recorder, so it's also held to the audio each track really had
  // transcribed (a track never overlaps itself): restarting the timeline can't hide minutes.
  const reach = Math.ceil((input.startMs + input.durationMs) / 1000);
  const heardSoFar = sql`coalesce((meetings.meta->'heardMs'->>${track}::text)::bigint, 0) + ${heardMs}::bigint`;
  let meta = provider ? sql`meetings.meta || jsonb_build_object('transcribedBy', ${provider}::text)` : sql`meetings.meta`;
  // Real audio means it's recording again; a tiny silent "still here" ping from a paused recorder doesn't.
  if (!(input.silent && input.durationMs < 1000)) meta = sql`(${meta}) - 'pausedAt'`;
  if (heardMs) meta = sql`jsonb_set(${meta}, '{heardMs}', coalesce(meetings.meta->'heardMs', '{}'::jsonb) || jsonb_build_object(${track}::text, ${heardSoFar}))`;
  const bumped = await db.execute(sql`
    with prev as (select duration_sec from meetings where id = ${meeting.id} for update)
    update meetings set duration_sec = greatest(meetings.duration_sec, ${reach}::int, ceil((${heardSoFar}) / 1000.0)::int), updated_at = now(), meta = ${meta}
    from prev where meetings.id = ${meeting.id}
    returning prev.duration_sec as before, meetings.duration_sec as after`);
  const row = (bumped as unknown as { rows?: { before: number; after: number }[] }).rows?.[0] ?? (bumped as unknown as { before: number; after: number }[])[0];
  const added = row ? Number(row.after) - Number(row.before) : 0;
  if (added > 0 || sttMicros > 0) await recordUsage(db, owner.id, { meetingSeconds: Math.max(0, added), costMicros: sttMicros });
  return { ok: true, segments: inserted.filter((s) => s.text), warning };
}

// Meeting meta is changed with SQL merges, never from a copy read earlier: uploads update it
// concurrently (pause state, what was transcribed), and a stale copy would undo that.
const metaMerge = (patch: Record<string, unknown>) => sql`${schema.meetings.meta} || ${JSON.stringify(patch)}::jsonb`;

/** Stop listening. The caller writes the notes (after the response, or in the scheduler). */
export async function finishMeeting(db: Db, meeting: Meeting, opts: { reason?: "stopped" | "replaced" | "stale" | "limit" } = {}): Promise<Meeting> {
  if (meeting.status !== "recording") return meeting;
  const [updated] = await db
    .update(schema.meetings)
    .set({ status: "processing", endedAt: new Date(), updatedAt: new Date(), meta: metaMerge({ endedBy: opts.reason ?? "stopped" }) })
    .where(and(eq(schema.meetings.id, meeting.id), eq(schema.meetings.status, "recording")))
    .returning();
  return updated ?? meeting;
}

export async function renameMeeting(db: Db, meeting: Meeting, title: string): Promise<Meeting> {
  const [updated] = await db
    .update(schema.meetings)
    .set({ title: title.trim().slice(0, 120), meta: metaMerge({ renamed: true }), updatedAt: new Date() })
    .where(eq(schema.meetings.id, meeting.id))
    .returning();
  return updated;
}

export async function setActionItemDone(db: Db, meeting: Meeting, index: number, done: boolean): Promise<Meeting> {
  const items = [...(meeting.actionItems ?? [])];
  if (!items[index]) return meeting;
  items[index] = { ...items[index], done };
  const [updated] = await db.update(schema.meetings).set({ actionItems: items, updatedAt: new Date() }).where(eq(schema.meetings.id, meeting.id)).returning();
  return updated;
}

export async function markNoticeCopied(db: Db, meeting: Meeting): Promise<Meeting> {
  const notice = JSON.stringify({ noticeCopied: true, noticeCopiedAt: new Date().toISOString() });
  const meta = schema.meetings.meta;
  const [updated] = await db
    .update(schema.meetings)
    .set({ meta: sql`jsonb_set(${meta}, '{consent}', coalesce(${meta}->'consent', '{}'::jsonb) || ${notice}::jsonb)`, updatedAt: new Date() })
    .where(eq(schema.meetings.id, meeting.id))
    .returning();
  return updated ?? meeting;
}

/** Throw away the transcript, keep the notes. */
export async function deleteTranscript(db: Db, bot: Bot, meeting: Meeting, by: "owner" | "retention" = "owner"): Promise<Meeting> {
  await db.delete(schema.meetingSegments).where(eq(schema.meetingSegments.meetingId, meeting.id));
  const [updated] = await db
    .update(schema.meetings)
    .set({ meta: metaMerge({ transcriptDeletedAt: new Date().toISOString(), transcriptDeletedBy: by }), updatedAt: new Date() })
    .where(eq(schema.meetings.id, meeting.id))
    .returning();
  if (by === "owner") await receipt(db, bot, "meeting", "ok", `Deleted the transcript of “${truncate(meeting.title, 80)}” (kept the notes)`, { meetingId: meeting.id });
  return updated ?? meeting;
}

/** Retention: transcripts older than each bot's setting (90 days unless changed) are deleted; notes stay. */
export async function expireTranscripts(db: Db, now = new Date()) {
  // Each bot's own cutoff is applied in SQL, so meetings kept forever (or longer) can't
  // fill the batch and stop shorter-lived transcripts from ever being deleted.
  const days = sql`${schema.bots.limits}->'transcriptDays'`;
  const rows = await db
    .select({ meeting: schema.meetings, limits: schema.bots.limits })
    .from(schema.meetings)
    .innerJoin(schema.bots, eq(schema.bots.id, schema.meetings.botId))
    .where(
      and(
        inArray(schema.meetings.status, ["ready", "failed"]),
        lt(schema.meetings.startedAt, new Date(now.getTime() - 86400_000)),
        sql`(${schema.meetings.meta}->>'transcriptDeletedAt') is null`,
        // null = keep forever; unset (or not a number) = the default.
        sql`coalesce(jsonb_typeof(${days}), '') <> 'null'`,
        sql`${schema.meetings.startedAt} < ${now.toISOString()}::timestamptz - (coalesce(case when jsonb_typeof(${days}) = 'number' then (${days})::text::float8 end, ${DEFAULT_TRANSCRIPT_DAYS}) * interval '1 day')`,
      ),
    )
    .orderBy(asc(schema.meetings.startedAt))
    .limit(200);
  let expired = 0;
  for (const { meeting, limits } of rows) {
    const days = limits?.transcriptDays === null ? null : (limits?.transcriptDays ?? DEFAULT_TRANSCRIPT_DAYS);
    if (days === null || meeting.startedAt.getTime() > now.getTime() - days * 86400_000) continue;
    await db.delete(schema.meetingSegments).where(eq(schema.meetingSegments.meetingId, meeting.id));
    await db
      .update(schema.meetings)
      .set({ meta: metaMerge({ transcriptDeletedAt: now.toISOString(), transcriptDeletedBy: "retention" }) })
      .where(eq(schema.meetings.id, meeting.id));
    expired++;
  }
  return expired;
}

export async function deleteMeeting(db: Db, bot: Bot, meeting: Meeting) {
  await db.delete(schema.meetings).where(eq(schema.meetings.id, meeting.id));
  await receipt(db, bot, "meeting", "ok", `Deleted the notes and transcript for “${truncate(meeting.title, 80)}”`, { meetingId: meeting.id });
}

/** Search what was said across this bot's meetings. */
export async function searchSegments(db: Db, botId: string, query: string, limit = 12) {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[%_\\]/g, ""))
    .filter((w) => w.length > 1)
    .slice(0, 5);
  if (!words.length) return [];
  const meetingIds = db.select({ id: schema.meetings.id }).from(schema.meetings).where(eq(schema.meetings.botId, botId));
  return db
    .select({
      meetingId: schema.meetingSegments.meetingId,
      title: schema.meetings.title,
      startedAt: schema.meetings.startedAt,
      startMs: schema.meetingSegments.startMs,
      track: schema.meetingSegments.track,
      speaker: schema.meetingSegments.speaker,
      text: schema.meetingSegments.text,
    })
    .from(schema.meetingSegments)
    .innerJoin(schema.meetings, eq(schema.meetings.id, schema.meetingSegments.meetingId))
    .where(and(inArray(schema.meetingSegments.meetingId, meetingIds), ...words.map((w) => ilike(schema.meetingSegments.text, `%${w}%`))))
    .orderBy(desc(schema.meetings.startedAt), asc(schema.meetingSegments.startMs))
    .limit(limit);
}

/** Recordings whose recorder disappeared: stop them so the notes still get written. A paused one is left alone (up to the 4-hour cap). */
export async function staleRecordings(db: Db, now = new Date()): Promise<Meeting[]> {
  // Paused ones are filtered in SQL (not after the LIMIT), so many paused recordings can't
  // hide an abandoned one. pausedAt is written by toISOString, so it compares as text.
  const pausedCutoff = new Date(now.getTime() - MAX_MEETING_MS).toISOString();
  const rows = await db
    .select()
    .from(schema.meetings)
    .where(
      and(
        eq(schema.meetings.status, "recording"),
        lt(schema.meetings.updatedAt, new Date(now.getTime() - STALE_RECORDING_MS)),
        or(sql`${schema.meetings.meta}->>'pausedAt' is null`, sql`${schema.meetings.meta}->>'pausedAt' < ${pausedCutoff}`),
      ),
    )
    .orderBy(asc(schema.meetings.updatedAt))
    .limit(20);
  return rows.filter((m) => {
    const pausedAt = (m.meta as { pausedAt?: string } | null)?.pausedAt;
    return !pausedAt || now.getTime() - Date.parse(pausedAt) > MAX_MEETING_MS;
  });
}

/**
 * The desktop app is still hearing this meeting on the computer (NVIDIA Parakeet was still
 * downloading when the call started, or it's catching up): it isn't abandoned, so it isn't
 * wrapped up before the rest of what was said arrives.
 */
export async function keepHearing(db: Db, meeting: Meeting): Promise<Meeting> {
  if (meeting.status !== "recording") return meeting;
  const [updated] = await db
    .update(schema.meetings)
    .set({ meta: metaMerge({ hearingAt: new Date().toISOString() }), updatedAt: new Date() })
    .where(and(eq(schema.meetings.id, meeting.id), eq(schema.meetings.status, "recording")))
    .returning();
  return updated ?? meeting;
}

/** The owner paused (or resumed) the recording; a paused meeting isn't wrapped up as abandoned. */
export async function setPaused(db: Db, meeting: Meeting, paused: boolean): Promise<Meeting> {
  if (meeting.status !== "recording") return meeting;
  const [updated] = await db
    .update(schema.meetings)
    .set({ meta: paused ? metaMerge({ pausedAt: new Date().toISOString() }) : sql`${schema.meetings.meta} - 'pausedAt'`, updatedAt: new Date() })
    .where(and(eq(schema.meetings.id, meeting.id), eq(schema.meetings.status, "recording")))
    .returning();
  return updated ?? meeting;
}
