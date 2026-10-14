import { z } from "zod";
import { apiError, json, limitOr429, parseJson, type RouteCtx } from "@/lib/api";
import { CHUNK_MS, listMeetings, meetingsEnabled, meetingView, startMeeting } from "@/lib/meetings";
import { MEETING_APP_IDS } from "@/lib/meetings/apps";
import { meetingAuth } from "@/lib/meetings/auth";
import { transcriptionAvailable } from "@/lib/transcribe";

export async function GET(req: Request, ctx: RouteCtx<{ botId: string }>) {
  const { botId } = await ctx.params;
  const a = await meetingAuth(req, botId);
  if (!a.ok) return a.res;
  const [rows, enabled] = await Promise.all([listMeetings(a.db, botId), meetingsEnabled(a.db, botId)]);
  return json({ meetings: rows.map(meetingView), enabled, available: transcriptionAvailable() });
}

export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  const { botId } = await ctx.params;
  const a = await meetingAuth(req, botId, { write: true });
  if (!a.ok) return a.res;
  const parsed = await parseJson(
    req,
    z.object({
      app: z.enum(MEETING_APP_IDS).optional(),
      title: z.string().trim().max(120).optional(),
    }),
  );
  if (!parsed.ok) return parsed.res;
  const limited = await limitOr429(a.db, `mtg-start:${botId}`, 30, 3600, "That's a lot of meetings in an hour. Try again a bit later.");
  if (limited) return limited;
  const res = await startMeeting(a.db, {
    bot: a.bot,
    owner: a.owner,
    source: a.device ? "desktop" : "browser",
    app: parsed.data.app,
    title: parsed.data.title,
    deviceId: a.device?.id ?? null,
  });
  if (!res.ok) return apiError(res.status, res.error, { code: res.code, upgrade: res.upgrade, meetingId: res.meetingId });
  return json({ meeting: meetingView(res.meeting), chunkMs: CHUNK_MS }, { status: 201 });
}
