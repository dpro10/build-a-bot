import { z } from "zod";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, json, parseJson, type RouteCtx } from "@/lib/api";
import { deleteMeeting, deleteTranscript, getMeeting, getSegments, keepHearing, markNoticeCopied, meetingView, renameMeeting, segmentView, setActionItemDone, setPaused } from "@/lib/meetings";
import { meetingAuth } from "@/lib/meetings/auth";
import { writeMeetingNotes } from "@/lib/meetings/notes";

export const maxDuration = 300;

type Ctx = RouteCtx<{ botId: string; meetingId: string }>;

/** The meeting and its transcript; `?since=<ISO time>` returns only lines added since then (live view). */
export async function GET(req: Request, ctx: Ctx) {
  const { botId, meetingId } = await ctx.params;
  const a = await meetingAuth(req, botId);
  if (!a.ok) return a.res;
  const meeting = await getMeeting(a.db, botId, meetingId);
  if (!meeting) return apiError(404, "Meeting not found");
  const sinceRaw = new URL(req.url).searchParams.get("since");
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw) : undefined;
  const segments = await getSegments(a.db, meeting.id, { since });
  return json({ meeting: meetingView(meeting), segments: segments.map(segmentView), serverTime: new Date().toISOString() });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { botId, meetingId } = await ctx.params;
  const a = await meetingAuth(req, botId, { write: true });
  if (!a.ok) return a.res;
  let meeting = await getMeeting(a.db, botId, meetingId);
  if (!meeting) return apiError(404, "Meeting not found");
  const parsed = await parseJson(
    req,
    z.object({
      title: z.string().trim().min(1).max(120).optional(),
      actionItem: z.object({ index: z.number().int().min(0).max(100), done: z.boolean() }).optional(),
      /** Write the notes again (e.g. after they failed). */
      rewrite: z.literal(true).optional(),
      /** The owner copied the heads-up for the call. */
      noticeCopied: z.literal(true).optional(),
      /** Throw away the transcript, keep the notes. */
      deleteTranscript: z.literal(true).optional(),
      /** The owner paused or resumed the recording. */
      paused: z.boolean().optional(),
      /** The desktop app is still hearing this meeting on the computer: don't wrap it up as abandoned. */
      hearing: z.literal(true).optional(),
    }),
  );
  if (!parsed.ok) return parsed.res;
  if (parsed.data.title) meeting = await renameMeeting(a.db, meeting, parsed.data.title);
  if (parsed.data.actionItem) meeting = await setActionItemDone(a.db, meeting, parsed.data.actionItem.index, parsed.data.actionItem.done);
  if (parsed.data.noticeCopied) meeting = await markNoticeCopied(a.db, meeting);
  if (typeof parsed.data.paused === "boolean") meeting = await setPaused(a.db, meeting, parsed.data.paused);
  if (parsed.data.hearing) meeting = await keepHearing(a.db, meeting);
  if (parsed.data.deleteTranscript) {
    if (meeting.status === "recording" || meeting.status === "processing") return apiError(409, "Wait until the notes are written, then delete the transcript.");
    meeting = await deleteTranscript(a.db, a.bot, meeting, "owner");
  }
  if (parsed.data.rewrite) {
    if (meeting.status === "recording" || meeting.status === "processing") return apiError(409, "The notes are already on their way.");
    if ((meeting.meta as { transcriptDeletedAt?: string } | null)?.transcriptDeletedAt) return apiError(409, "The transcript was deleted, so there's nothing to write new notes from.");
    const meta = { ...(meeting.meta ?? {}) } as Record<string, unknown>;
    delete meta.notesStartedAt;
    delete meta.notesVia;
    const [row] = await a.db
      .update(schema.meetings)
      .set({ status: "processing", error: null, meta, updatedAt: new Date() })
      .where(and(eq(schema.meetings.id, meeting.id), eq(schema.meetings.status, meeting.status)))
      .returning();
    if (row) {
      meeting = row;
      const id = row.id;
      after(async () => {
        const { getDb } = await import("@/lib/db");
        await writeMeetingNotes(await getDb(), id);
      });
    }
  }
  return json({ meeting: meetingView(meeting) });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { botId, meetingId } = await ctx.params;
  const a = await meetingAuth(req, botId, { write: true });
  if (!a.ok) return a.res;
  const meeting = await getMeeting(a.db, botId, meetingId);
  if (!meeting) return apiError(404, "Meeting not found");
  await deleteMeeting(a.db, a.bot, meeting);
  return json({ ok: true });
}
