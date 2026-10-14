import { after } from "next/server";
import { apiError, json, type RouteCtx } from "@/lib/api";
import { finishMeeting, getMeeting, meetingView } from "@/lib/meetings";
import { meetingAuth } from "@/lib/meetings/auth";
import { writeMeetingNotes } from "@/lib/meetings/notes";
import { receipt } from "@/lib/agent/run";
import { formatDuration } from "@/lib/meetings";

export const maxDuration = 300;

/** Stop listening; the bot writes the notes right after this returns. */
export async function POST(req: Request, ctx: RouteCtx<{ botId: string; meetingId: string }>) {
  const { botId, meetingId } = await ctx.params;
  const a = await meetingAuth(req, botId, { write: true });
  if (!a.ok) return a.res;
  const meeting = await getMeeting(a.db, botId, meetingId);
  if (!meeting) return apiError(404, "Meeting not found");
  if (meeting.status !== "recording") return json({ meeting: meetingView(meeting) });
  const done = await finishMeeting(a.db, meeting, { reason: "stopped" });
  await receipt(a.db, a.bot, "meeting", "ok", `Stopped listening after ${formatDuration(done.durationSec)}`, { meetingId: done.id });
  after(async () => {
    const { getDb } = await import("@/lib/db");
    await writeMeetingNotes(await getDb(), done.id);
  });
  return json({ meeting: meetingView(done) });
}
