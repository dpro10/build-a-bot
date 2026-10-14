import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getOwnedBot, listBridgeDevices } from "@/lib/data";
import { getPlan } from "@/lib/billing/plans";
import { getUsage } from "@/lib/billing/usage";
import { DEVICE_ONLINE_MS } from "@/lib/bridge/jobs";
import { ownerName } from "@/lib/agent/prompt";
import { DEFAULT_TRANSCRIPT_DAYS, desktopApp, listMeetings, meetingsEnabled, meetingView } from "@/lib/meetings";
import { transcriptionAvailable } from "@/lib/transcribe";
import { paidPlansOpen } from "@/lib/env";
import { safeTimeZone } from "@/components/bot/activity/time";
import { MeetingsView } from "@/components/meetings/MeetingsView";
import type { AvatarId, ColorwayId } from "@/lib/avatars";

export const metadata: Metadata = { title: "Meetings" };

export default async function MeetingsPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const user = await requireUser(`/app/bots/${botId}/meetings`);
  const db = await getDb();
  const bot = await getOwnedBot(db, user.id, botId);
  if (!bot) notFound();

  const [rows, enabled, usage, devices] = await Promise.all([listMeetings(db, botId), meetingsEnabled(db, botId), getUsage(db, user.id), listBridgeDevices(db, user.id)]);
  const plan = getPlan(user.plan);
  const now = new Date();
  // Usage counts per calendar month (UTC).
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const resetsOn = nextMonth.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const transcriptDays = bot.limits?.transcriptDays === null ? null : (bot.limits?.transcriptDays ?? DEFAULT_TRANSCRIPT_DAYS);

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-40 sm:px-6">
        <MeetingsView
          botId={botId}
          bot={{ name: bot.name, avatar: bot.avatar as AvatarId, color: bot.color as ColorwayId, paused: bot.status === "paused" }}
          ownerId={user.id}
          ownerName={ownerName(user)}
          timezone={safeTimeZone(user.timezone)}
          serverNow={now.toISOString()}
          initialMeetings={rows.map(meetingView)}
          enabled={enabled}
          available={transcriptionAvailable()}
          plan={{ id: plan.id, name: plan.name, minutes: plan.limits.meetingMinutes }}
          paidPlans={paidPlansOpen}
          desktopApp={desktopApp()}
          minutesUsed={Math.floor(usage.meetingSeconds / 60)}
          resetsOn={resetsOn}
          transcriptDays={transcriptDays}
          desktopDevices={devices
            .filter((d) => !d.revokedAt && d.platform?.startsWith("desktop-"))
            .map((d) => ({ id: d.id, name: d.name, online: Boolean(d.lastSeenAt && now.getTime() - d.lastSeenAt.getTime() < DEVICE_ONLINE_MS) }))}
        />
      </div>
    </div>
  );
}
