import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getUser, requireUser } from "@/lib/auth/session";
import { getOwnedBot } from "@/lib/data";
import { ownerName } from "@/lib/agent/prompt";
import { DEFAULT_TRANSCRIPT_DAYS, getMeeting, getSegments, meetingView, segmentView } from "@/lib/meetings";
import { safeTimeZone } from "@/components/bot/activity/time";
import { MeetingDetail } from "@/components/meetings/MeetingDetail";
import type { AvatarId, ColorwayId } from "@/lib/avatars";

type Params = { params: Promise<{ botId: string; meetingId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { botId, meetingId } = await params;
  const user = await getUser();
  if (!user) return { title: "Meeting" };
  const db = await getDb();
  const bot = await getOwnedBot(db, user.id, botId);
  const m = bot ? await getMeeting(db, botId, meetingId) : null;
  return { title: m ? m.title : "Meeting" };
}

export default async function MeetingPage({ params }: Params) {
  const { botId, meetingId } = await params;
  const user = await requireUser(`/app/bots/${botId}/meetings/${meetingId}`);
  const db = await getDb();
  const bot = await getOwnedBot(db, user.id, botId);
  if (!bot) notFound();
  const meeting = await getMeeting(db, botId, meetingId);
  if (!meeting) notFound();
  const segments = await getSegments(db, meeting.id);

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 pt-5 pb-16 sm:px-6">
        <MeetingDetail
          botId={botId}
          bot={{ name: bot.name, avatar: bot.avatar as AvatarId, color: bot.color as ColorwayId }}
          initialMeeting={meetingView(meeting)}
          initialSegments={segments.map(segmentView)}
          ownerName={ownerName(user)}
          timezone={safeTimeZone(user.timezone)}
          serverNow={new Date().toISOString()}
          transcriptDays={bot.limits?.transcriptDays === null ? null : (bot.limits?.transcriptDays ?? DEFAULT_TRANSCRIPT_DAYS)}
        />
      </div>
    </div>
  );
}
