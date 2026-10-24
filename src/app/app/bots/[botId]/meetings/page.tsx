import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getOwnedBot, listBridgeDevices } from "@/lib/data";
import { creditRefusal } from "@/lib/billing/credit";
import { TYPICAL_MEETING_HOUR, formatMicros, tokensMicros } from "@/lib/billing/prices";
import { getUsage } from "@/lib/billing/usage";
import { DEVICE_ONLINE_MS } from "@/lib/bridge/devices";
import { DEFAULT_TRANSCRIPT_DAYS, listMeetings, meetingsEnabled, meetingView, notesCostCredit } from "@/lib/meetings";
import { INCLUDED_MODELS } from "@/lib/models/catalog";
import { audioStaysOnComputer } from "@/lib/transcribe";
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

  const [rows, enabled, usage, devices, credit, paid] = await Promise.all([
    listMeetings(db, botId),
    meetingsEnabled(db, botId),
    getUsage(db, user.id),
    listBridgeDevices(db, user.id),
    creditRefusal(db, user.id, { ownBrain: true }),
    notesCostCredit(db, bot),
  ]);
  const now = new Date();
  // Hearing the call is free (on the computer); the notes are one message on the bot's brain.
  const model = paid ? (INCLUDED_MODELS.find((m) => m.id === bot.brain.model) ?? INCLUDED_MODELS.find((m) => m.default)!) : null;
  const notesCost = model ? `about ${formatMicros(tokensMicros(model, TYPICAL_MEETING_HOUR))} an hour on ${model.label}` : null;
  const transcriptDays = bot.limits?.transcriptDays === null ? null : (bot.limits?.transcriptDays ?? DEFAULT_TRANSCRIPT_DAYS);

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-40 sm:px-6">
        <MeetingsView
          botId={botId}
          bot={{ name: bot.name, avatar: bot.avatar as AvatarId, color: bot.color as ColorwayId, paused: bot.status === "paused" }}
          timezone={safeTimeZone(user.timezone)}
          serverNow={now.toISOString()}
          initialMeetings={rows.map(meetingView)}
          enabled={enabled}
          minutesThisMonth={Math.floor(usage.meetingSeconds / 60)}
          notesCost={notesCost}
          needsCredit={paid && credit !== null}
          creditMessage={paid ? credit : null}
          transcriptDays={transcriptDays}
          audioStays={audioStaysOnComputer()}
          desktopDevices={devices
            .filter((d) => !d.revokedAt && d.platform?.startsWith("desktop-"))
            .map((d) => ({ id: d.id, name: d.name, online: Boolean(d.lastSeenAt && now.getTime() - d.lastSeenAt.getTime() < DEVICE_ONLINE_MS) }))}
        />
      </div>
    </div>
  );
}
