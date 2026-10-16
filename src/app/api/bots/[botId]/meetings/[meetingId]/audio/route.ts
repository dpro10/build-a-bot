import { z } from "zod";
import { apiError, json, limitOr429, readBodyCapped, type RouteCtx } from "@/lib/api";
import { addChunk, CHUNK_MAX_BYTES, getMeeting, HEARD_MAX_LINES, segmentView } from "@/lib/meetings";
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

/** What the desktop app heard in the piece, on the computer: lines with their times in the piece. */
const heardBody = z.object({
  heard: z
    .array(
      z.object({
        startMs: z.number().finite().min(0).max(3_600_000),
        endMs: z.number().finite().min(0).max(3_600_000),
        text: z.string().max(4000),
      }),
    )
    .max(HEARD_MAX_LINES),
});

/** The most a piece's lines can take as JSON (a few minutes of talking is a few KB). */
const HEARD_MAX_BYTES = 256 * 1024;

/**
 * One piece of a call (about 20 seconds of one track) → transcript lines. Only the desktop app
 * sends these (a paired computer's token).
 *
 * Body, either:
 *  - JSON `{ heard: [{ startMs, endMs, text }] }`: what NVIDIA Parakeet heard on the owner's
 *    computer. No audio leaves it; this is how the app sends a meeting.
 *  - the raw audio (webm/ogg/wav/mp3/m4a), from an app that can't hear it itself: only a server
 *    with speech-to-text takes it (otherwise 503 "unavailable"; nothing is made up).
 * Query: track, chunk, startMs, durationMs, silent. Safe to retry: a piece that was already
 * heard returns the same lines.
 */
export async function POST(req: Request, ctx: RouteCtx<{ botId: string; meetingId: string }>) {
  const { botId, meetingId } = await ctx.params;
  const a = await meetingAuth(req, botId, { write: true, appOnly: true });
  if (!a.ok) return a.res;
  const q = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return apiError(422, "Bad chunk parameters");
  const mime = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const isText = mime === "application/json";
  if (!isText && !audioExtension(mime)) return apiError(415, "Send what was heard as JSON, or audio as webm, ogg, wav, mp3 or m4a.");
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > (isText ? HEARD_MAX_BYTES : CHUNK_MAX_BYTES)) return apiError(413, isText ? "Too much text for one piece" : "Audio chunk too large");

  const meeting = await getMeeting(a.db, botId, meetingId);
  if (!meeting) return apiError(404, "Meeting not found");
  if (a.device && meeting.deviceId && meeting.deviceId !== a.device.id) return apiError(403, "Another computer is recording this meeting.");
  const limited = await limitOr429(a.db, `mtg-chunk:${meeting.id}`, 120, 60);
  if (limited) return limited;

  const body = await readBodyCapped(req, isText ? HEARD_MAX_BYTES : CHUNK_MAX_BYTES);
  if (!body) return apiError(413, isText ? "Too much text for one piece" : "Audio chunk too large");
  let heard: z.infer<typeof heardBody>["heard"] | undefined;
  if (isText) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return apiError(400, "Bad JSON");
    }
    const h = heardBody.safeParse(parsed);
    if (!h.success) return apiError(422, "Send { heard: [{ startMs, endMs, text }] }");
    heard = h.data.heard;
  }
  const res = await addChunk(a.db, {
    meeting,
    owner: a.owner,
    track: q.data.track,
    chunk: q.data.chunk,
    startMs: q.data.startMs,
    durationMs: q.data.durationMs,
    ...(heard ? { heard } : { audio: body, mime }),
    silent: q.data.silent === "1",
  });
  if (!res.ok) return apiError(res.status, res.error, { code: res.code, upgrade: res.upgrade });
  return json({ segments: res.segments.map(segmentView), duplicate: Boolean(res.duplicate), warning: res.warning ?? null });
}
