import { z } from "zod";
import { after } from "next/server";
import { apiError, json, limitOr429, parseJson, type RouteCtx } from "@/lib/api";
import { CHUNK_MS, listMeetings, meetingsEnabled, meetingView, startMeeting } from "@/lib/meetings";
import { MEETING_APP_IDS } from "@/lib/meetings/apps";
import { meetingAuth } from "@/lib/meetings/auth";
import { writeMeetingNotes } from "@/lib/meetings/notes";

export const maxDuration = 300;

export async function GET(req: Request, ctx: RouteCtx<{ botId: string }>) {
  const { botId } = await ctx.params;
  const a = await meetingAuth(req, botId);
  if (!a.ok) return a.res;
  const [rows, enabled] = await Promise.all([listMeetings(a.db, botId), meetingsEnabled(a.db, botId)]);
  // `available`: notes can be taken (always, in the desktop app); older clients still read it.
  return json({ meetings: rows.map(meetingView), enabled, available: true });
}

/** Start taking notes: only the desktop app (it hears the call on the owner's computer). */
export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  const { botId } = await ctx.params;
  const a = await meetingAuth(req, botId, { write: true, appOnly: true });
  if (!a.ok) return a.res;
  const parsed = await parseJson(
    req,
    z.object({
      app: z.enum(MEETING_APP_IDS).optional(),
      title: z.string().trim().max(120).optional(),
      inPerson: z.boolean().optional(),
      consentNotice: z.boolean().optional(),
    }),
  );
  if (!parsed.ok) return parsed.res;
  const limited = await limitOr429(a.db, `mtg-start:${botId}`, 30, 3600, "That's a lot of meetings in an hour. Try again a bit later.");
  if (limited) return limited;
  const res = await startMeeting(a.db, {
    bot: a.bot,
    owner: a.owner,
    source: "desktop",
    app: parsed.data.app,
    title: parsed.data.title,
    deviceId: a.device?.id ?? null,
    inPerson: parsed.data.inPerson,
    consentNotice: parsed.data.consentNotice,
  });
  if (!res.ok) return apiError(res.status, res.error, { code: res.code, meetingId: res.meetingId });
  // A recording this one replaced (a crash, a quit) gets its notes now, not at the next rescue.
  if (res.replaced.length) {
    after(async () => {
      const { getDb } = await import("@/lib/db");
      const db = await getDb();
      for (const id of res.replaced) await writeMeetingNotes(db, id);
    });
  }
  return json({ meeting: meetingView(res.meeting), chunkMs: CHUNK_MS }, { status: 201 });
}
