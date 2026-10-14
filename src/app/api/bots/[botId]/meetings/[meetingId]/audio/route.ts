import { z } from "zod";
import { apiError, json, limitOr429, type RouteCtx } from "@/lib/api";
import { addChunk, CHUNK_MAX_BYTES, getMeeting, segmentView } from "@/lib/meetings";
import { meetingAuth } from "@/lib/meetings/auth";
import { audioExtension } from "@/lib/transcribe";

export const maxDuration = 120;

const query = z.object({
  track: z.enum(["mic", "system"]),
  chunk: z.coerce.number().int().min(0).max(5000),
  startMs: z.coerce.number().int().min(0),
  durationMs: z.coerce.number().int().min(1),
  silent: z.enum(["0", "1"]).optional(),
});

/**
 * One piece of audio (about 20 seconds of one track) → transcript lines.
 * Body: the raw audio file (webm/ogg/wav/mp4). Query: track, chunk, startMs, durationMs, silent.
 * Safe to retry: a chunk that was already transcribed returns the same lines.
 */
export async function POST(req: Request, ctx: RouteCtx<{ botId: string; meetingId: string }>) {
  const { botId, meetingId } = await ctx.params;
  const a = await meetingAuth(req, botId, { write: true });
  if (!a.ok) return a.res;
  const q = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return apiError(422, "Bad chunk parameters");
  const mime = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!audioExtension(mime)) return apiError(415, "Send audio as webm, ogg, wav, mp3 or m4a.");
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > CHUNK_MAX_BYTES) return apiError(413, "Audio chunk too large");

  const meeting = await getMeeting(a.db, botId, meetingId);
  if (!meeting) return apiError(404, "Meeting not found");
  if (a.device && meeting.deviceId && meeting.deviceId !== a.device.id) return apiError(403, "Another computer is recording this meeting.");
  const limited = await limitOr429(a.db, `mtg-chunk:${meeting.id}`, 120, 60);
  if (limited) return limited;

  const audio = await req.arrayBuffer();
  if (audio.byteLength > CHUNK_MAX_BYTES) return apiError(413, "Audio chunk too large");
  const res = await addChunk(a.db, {
    meeting,
    owner: a.owner,
    track: q.data.track,
    chunk: q.data.chunk,
    startMs: q.data.startMs,
    durationMs: q.data.durationMs,
    audio,
    mime,
    silent: q.data.silent === "1",
  });
  if (!res.ok) return apiError(res.status, res.error, { code: res.code, upgrade: res.upgrade });
  return json({ segments: res.segments.map(segmentView), duplicate: Boolean(res.duplicate), warning: res.warning ?? null });
}
