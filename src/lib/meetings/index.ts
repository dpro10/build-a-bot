/**
 * Meeting notes: the bot listens to a meeting only after the owner says yes
 * (in the desktop app's pop-up or the browser recorder), transcribes it in
 * ~30-second chunks as it goes, then writes notes when it ends.
 *
 *   start → audio chunks (mic = the owner, system = everyone else) → live transcript
 *   → finish → notes by the bot's own brain (src/lib/meetings/notes.ts) → sent to the owner
 *
 * Audio is transcribed in memory and thrown away; only the text is kept, and the
 * owner can delete any meeting.
 */
import { and, asc, desc, eq, gt, ilike, inArray, lt, ne, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Bot, Meeting, MeetingSegment, User } from "@/lib/db/schema";
import { checkLimit, recordUsage } from "@/lib/billing/usage";
import { demoMode } from "@/lib/env";
import type { PlanId } from "@/lib/billing/plans";
import { receipt } from "@/lib/agent/run";
import { transcribe, transcriptionAvailable, TranscriptionError } from "@/lib/transcribe";
import { newId, sortableId, truncate } from "@/lib/utils";
import { defaultMeetingTitle, isMeetingApp, meetingAppName, type MeetingAppId } from "./apps";

export const MEETINGS_CONNECTOR = "meetings";
/** How long each uploaded piece of audio is. Shorter in demo mode so the scripted transcript shows up quickly. */
export const CHUNK_MS = demoMode ? 6_000 : 20_000;
export const CHUNK_MAX_BYTES = 8 * 1024 * 1024;
export const CHUNK_MAX_MS = 5 * 60_000;
export const MAX_MEETING_MS = 4 * 3600_000;
/** No audio for this long: the recorder is gone (closed laptop, crashed app), so wrap the meeting up. */
export const STALE_RECORDING_MS = 20 * 60_000;

export type MeetingTrack = "mic" | "system";
export const TRACKS: MeetingTrack[] = ["mic", "system"];

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

export type MeetingFailure = { ok: false; status: number; error: string; code?: string; upgrade?: PlanId; meetingId?: string };

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
    source: "browser" | "desktop";
    app?: string;
    title?: string;
    deviceId?: string | null;
    /** One microphone in a room (no call audio). */
    inPerson?: boolean;
    /** The owner copied the heads-up for the call before starting. */
    consentNotice?: boolean;
  },
): Promise<{ ok: true; meeting: Meeting } | MeetingFailure> {
  const { bot, owner } = input;
  if (bot.status === "paused") return { ok: false, status: 409, code: "paused", error: `${bot.name} is paused. Resume it to take notes.` };
  if (!transcriptionAvailable()) return { ok: false, status: 503, code: "unavailable", error: "Meeting notes aren't set up on this server yet." };
  if (!(await meetingsEnabled(db, bot.id))) {
    return { ok: false, status: 409, code: "meetings_off", error: `Turn on Meeting notes for ${bot.name} first.` };
  }
  const limit = await checkLimit(db, owner, "meetingMinutes");
  if (!limit.ok) return { ok: false, status: 402, code: "limit", error: `${limit.message} Upgrade for more meeting notes.`, upgrade: limit.plan.id === "free" ? "plus" : "pro" };

  // One recording per bot at a time. A leftover from the same recorder (crash, closed tab) is wrapped up instead.
  const active = await db
    .select()
    .from(schema.meetings)
    .where(and(eq(schema.meetings.botId, bot.id), eq(schema.meetings.status, "recording")));
  for (const m of active) {
    const stale = Date.now() - m.updatedAt.getTime() > STALE_RECORDING_MS;
    const sameRecorder = m.source === input.source && (m.deviceId ?? null) === (input.deviceId ?? null);
    if (stale || sameRecorder) await finishMeeting(db, m, { reason: "replaced" });
    else return { ok: false, status: 409, code: "already_recording", meetingId: m.id, error: `${bot.name} is already taking notes in another meeting.` };
  }

  const app: MeetingAppId = isMeetingApp(input.app) ? input.app : input.source === "browser" ? "browser" : "other";
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
  return { ok: true, meeting };
}

export type ChunkInput = {
  meeting: Meeting;
  owner: User;
  track: MeetingTrack;
  chunk: number;
  startMs: number;
  durationMs: number;
  audio: ArrayBuffer;
  mime: string;
  /** The recorder measured no sound in this chunk: skip speech-to-text (saves money, avoids phantom lines). */
  silent?: boolean;
};

export async function addChunk(db: Db, input: ChunkInput): Promise<{ ok: true; segments: MeetingSegment[]; duplicate?: boolean; warning?: string } | MeetingFailure> {
  const { meeting, owner, track, chunk } = input;
  if (meeting.status !== "recording") return { ok: false, status: 409, code: "not_recording", error: "This meeting isn't recording anymore." };
  if (!Number.isInteger(chunk) || chunk < 0 || chunk > 5000) return { ok: false, status: 422, error: "Bad chunk number" };
  if (input.startMs < 0 || input.startMs > MAX_MEETING_MS) return { ok: false, status: 422, code: "too_long", error: "Meetings can be up to 4 hours." };
  if (input.durationMs < 1 || input.durationMs > CHUNK_MAX_MS) return { ok: false, status: 422, error: "Chunks must be under 5 minutes" };
  if (input.audio.byteLength > CHUNK_MAX_BYTES) return { ok: false, status: 413, error: "Audio chunk too large" };

  // Retries are free: a chunk that was already transcribed returns what we have.
  const existing = await db
    .select()
    .from(schema.meetingSegments)
    .where(and(eq(schema.meetingSegments.meetingId, meeting.id), eq(schema.meetingSegments.track, track), eq(schema.meetingSegments.chunk, chunk)));
  if (existing.length) return { ok: true, segments: existing.filter((s) => s.text), duplicate: true };

  const limit = await checkLimit(db, owner, "meetingMinutes");
  if (!limit.ok) return { ok: false, status: 402, code: "limit", error: limit.message, upgrade: limit.plan.id === "free" ? "plus" : "pro" };

  let segments: { startMs: number; endMs: number; text: string }[] = [];
  let warning: string | undefined;
  let provider: string | undefined;
  if (!input.silent && input.audio.byteLength >= 800) {
    const recent = await db
      .select({ text: schema.meetingSegments.text })
      .from(schema.meetingSegments)
      .where(and(eq(schema.meetingSegments.meetingId, meeting.id), ne(schema.meetingSegments.text, "")))
      .orderBy(desc(schema.meetingSegments.createdAt))
      .limit(4);
    try {
      const result = await transcribe({
        audio: input.audio,
        mime: input.mime,
        durationMs: input.durationMs,
        prompt: recent.reverse().map((r) => r.text).join(" ") || undefined,
        track,
        chunk,
      });
      segments = result.segments;
      provider = `${result.provider}/${result.model}`;
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

  // Meeting length (and the plan's meeting minutes) follows wall-clock time, whichever track gets there first.
  const reach = Math.ceil((input.startMs + input.durationMs) / 1000);
  const bumped = await db.execute(sql`
    with prev as (select duration_sec from meetings where id = ${meeting.id} for update)
    update meetings set duration_sec = greatest(meetings.duration_sec, ${reach}), updated_at = now(),
      meta = case when ${provider ?? null}::text is null then meetings.meta else meetings.meta || jsonb_build_object('transcribedBy', ${provider ?? null}::text) end
    from prev where meetings.id = ${meeting.id}
    returning prev.duration_sec as before, meetings.duration_sec as after`);
  const row = (bumped as unknown as { rows?: { before: number; after: number }[] }).rows?.[0] ?? (bumped as unknown as { before: number; after: number }[])[0];
  const added = row ? Number(row.after) - Number(row.before) : 0;
  if (added > 0) await recordUsage(db, owner.id, { meetingSeconds: added });
  return { ok: true, segments: inserted.filter((s) => s.text), warning };
}

/** Stop listening. The caller writes the notes (after the response, or in the scheduler). */
export async function finishMeeting(db: Db, meeting: Meeting, opts: { reason?: "stopped" | "replaced" | "stale" | "limit" } = {}): Promise<Meeting> {
  if (meeting.status !== "recording") return meeting;
  const [updated] = await db
    .update(schema.meetings)
    .set({ status: "processing", endedAt: new Date(), updatedAt: new Date(), meta: { ...(meeting.meta ?? {}), endedBy: opts.reason ?? "stopped" } })
    .where(and(eq(schema.meetings.id, meeting.id), eq(schema.meetings.status, "recording")))
    .returning();
  return updated ?? meeting;
}

export async function renameMeeting(db: Db, meeting: Meeting, title: string): Promise<Meeting> {
  const [updated] = await db
    .update(schema.meetings)
    .set({ title: title.trim().slice(0, 120), meta: { ...(meeting.meta ?? {}), renamed: true }, updatedAt: new Date() })
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
  const meta = (meeting.meta ?? {}) as Record<string, unknown>;
  const consent = { ...((meta.consent as Record<string, unknown>) ?? {}), noticeCopied: true, noticeCopiedAt: new Date().toISOString() };
  const [updated] = await db.update(schema.meetings).set({ meta: { ...meta, consent }, updatedAt: new Date() }).where(eq(schema.meetings.id, meeting.id)).returning();
  return updated ?? meeting;
}

/** Throw away the transcript, keep the notes. */
export async function deleteTranscript(db: Db, bot: Bot, meeting: Meeting, by: "owner" | "retention" = "owner"): Promise<Meeting> {
  await db.delete(schema.meetingSegments).where(eq(schema.meetingSegments.meetingId, meeting.id));
  const [updated] = await db
    .update(schema.meetings)
    .set({ meta: { ...(meeting.meta ?? {}), transcriptDeletedAt: new Date().toISOString(), transcriptDeletedBy: by }, updatedAt: new Date() })
    .where(eq(schema.meetings.id, meeting.id))
    .returning();
  if (by === "owner") await receipt(db, bot, "meeting", "ok", `Deleted the transcript of “${truncate(meeting.title, 80)}” (kept the notes)`, { meetingId: meeting.id });
  return updated ?? meeting;
}

/** Retention: transcripts older than each bot's setting (90 days unless changed) are deleted; notes stay. */
export async function expireTranscripts(db: Db, now = new Date()) {
  const rows = await db
    .select({ meeting: schema.meetings, limits: schema.bots.limits })
    .from(schema.meetings)
    .innerJoin(schema.bots, eq(schema.bots.id, schema.meetings.botId))
    .where(
      and(
        inArray(schema.meetings.status, ["ready", "failed"]),
        lt(schema.meetings.startedAt, new Date(now.getTime() - 86400_000)),
        sql`(${schema.meetings.meta}->>'transcriptDeletedAt') is null`,
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
      .set({ meta: { ...(meeting.meta ?? {}), transcriptDeletedAt: now.toISOString(), transcriptDeletedBy: "retention" } })
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

/** Recordings whose recorder disappeared: stop them so the notes still get written. */
export async function staleRecordings(db: Db, now = new Date()): Promise<Meeting[]> {
  return db
    .select()
    .from(schema.meetings)
    .where(and(eq(schema.meetings.status, "recording"), lt(schema.meetings.updatedAt, new Date(now.getTime() - STALE_RECORDING_MS))))
    .limit(20);
}
