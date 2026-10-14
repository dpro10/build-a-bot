import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getOwnedBot, listSchedules } from "@/lib/data";
import { ownerChannels } from "@/lib/channels/outbound";
import { CHANNEL_BY_KIND, type ChannelKind } from "@/lib/channels/catalog";
import { getPlan } from "@/lib/billing/plans";
import { RoutinesView } from "@/components/bot/routines/RoutinesView";
import type { ScheduleView } from "@/components/bot/routines/schedule";
import { safeTimeZone, timeZoneLongName } from "@/components/bot/activity/time";

export const metadata: Metadata = { title: "Routines" };

function channelLabel(kind: string) {
  if (kind === "voice") return "Phone call";
  return CHANNEL_BY_KIND[kind as ChannelKind]?.name ?? kind;
}

export default async function RoutinesPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const user = await requireUser(`/app/bots/${botId}/routines`);
  const db = await getDb();
  const bot = await getOwnedBot(db, user.id, botId);
  if (!bot) notFound();

  const [rows, verified] = await Promise.all([listSchedules(db, botId), ownerChannels(db, botId)]);
  const plan = getPlan(user.plan);
  const timezone = safeTimeZone(user.timezone);

  // Same pick the scheduler makes for "auto" (src/lib/channels/outbound.ts → messageOwner).
  const usual = verified.find((c) => c.kind !== "voice");
  const usualIsChat = !usual || usual.kind === "web";
  const deliverOptions = [
    { value: "auto", label: `Your usual place (${usualIsChat ? "this chat" : channelLabel(usual!.kind)})`, short: "Your usual place" },
    { value: "web", label: "Just this chat", short: "This chat" },
    ...verified.filter((c) => c.kind !== "web").map((c) => ({ value: c.kind, label: channelLabel(c.kind), short: channelLabel(c.kind) })),
  ];
  for (const r of rows) {
    if (!deliverOptions.some((o) => o.value === r.deliverOn))
      deliverOptions.push({ value: r.deliverOn, label: `${channelLabel(r.deliverOn)} (not set up)`, short: `${channelLabel(r.deliverOn)} (not set up)` });
  }
  const others = verified
    .filter((c) => c.kind !== "web" && c.kind !== usual?.kind)
    .sort((a, b) => Number(a.kind === "voice") - Number(b.kind === "voice"))
    .map((c) => channelLabel(c.kind));
  const autoHint = usualIsChat
    ? others.length
      ? `Right here in your chat. Pick ${others.slice(0, 2).join(" or ")} to get it there instead.`
      : "Right here in your chat. Set up texts, email or Telegram in Channels to get it there."
    : `${channelLabel(usual!.kind)}, plus a copy in your chat.`;

  const schedules: ScheduleView[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind === "reminder" ? "reminder" : "routine",
    title: r.title,
    prompt: r.prompt,
    schedule: r.schedule,
    timezone: r.timezone,
    deliverOn: r.deliverOn,
    active: r.active,
    nextRunAt: r.nextRunAt?.toISOString() ?? null,
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
    runCount: r.runCount,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <RoutinesView
          botId={botId}
          botName={bot.name}
          timezone={timezone}
          tzName={timeZoneLongName(timezone)}
          serverNow={new Date().toISOString()}
          initial={schedules}
          plan={{ id: plan.id, name: plan.name, limit: plan.limits.routines }}
          deliverOptions={deliverOptions}
          autoHint={autoHint}
        />
      </div>
    </div>
  );
}
