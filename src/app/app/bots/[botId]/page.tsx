import { and, eq, inArray, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getOwnedBot, listApprovals, listMessages } from "@/lib/data";
import { ensureConversation } from "@/lib/channels/outbound";
import { ChatView } from "@/components/chat/ChatView";
import { toChatMessage } from "@/components/chat/messages";
import { appKinds } from "@/lib/connectors";
import { startersFor } from "@/lib/jobs";
import { brainLabel } from "@/lib/bots/labels";
import type { AvatarId, ColorwayId } from "@/lib/avatars";
import { notFound } from "next/navigation";
import { SetupChecklist } from "@/components/app/SetupChecklist";

export default async function BotChatPage({ params, searchParams }: { params: Promise<{ botId: string }>; searchParams: Promise<{ ask?: string | string[] }> }) {
  const { botId } = await params;
  const { ask } = await searchParams;
  const user = await requireUser(`/app/bots/${botId}`);
  const db = await getDb();
  const bot = await getOwnedBot(db, user.id, botId);
  if (!bot) notFound();
  const conversation = await ensureConversation(db, botId, "web", "owner");
  const [messages, approvals, apps, known] = await Promise.all([
    listMessages(db, conversation.id, { limit: 80 }),
    listApprovals(db, user.id, { botId, limit: 100 }),
    db
      .select({ connectorId: schema.connections.connectorId })
      .from(schema.connections)
      .where(and(eq(schema.connections.botId, botId), ne(schema.connections.status, "disabled"))),
    // Up to 5 is all it takes to know whether the bot barely knows its owner.
    db.select({ source: schema.memories.source }).from(schema.memories).where(eq(schema.memories.botId, botId)).limit(5),
  ]);
  const visible = messages.filter((m) => m.role === "user" || m.role === "assistant");
  // Meeting notes in the chat show the meeting's app (and whether it was deleted since).
  const meetingIds = [
    ...new Set(
      visible.flatMap((m) => {
        const meta = (m.meta ?? {}) as { kind?: unknown; meetingId?: unknown };
        return meta.kind === "meeting_notes" && typeof meta.meetingId === "string" ? [meta.meetingId] : [];
      }),
    ),
  ];
  const meetings = meetingIds.length
    ? await db.select({ id: schema.meetings.id, app: schema.meetings.app, meta: schema.meetings.meta }).from(schema.meetings).where(and(eq(schema.meetings.botId, botId), inArray(schema.meetings.id, meetingIds)))
    : [];
  const meetingInfo = new Map(meetings.map((x) => [x.id, x]));
  const withMeeting = (meta: Record<string, unknown>) => {
    if (meta.kind !== "meeting_notes" || typeof meta.meetingId !== "string") return meta;
    const info = meetingInfo.get(meta.meetingId);
    return info
      ? { ...meta, meetingApp: info.app, meetingInPerson: (info.meta as { inPerson?: boolean } | null)?.inPerson === true }
      : { ...meta, meetingGone: true };
  };
  // Ideas about email, a calendar and the like only show once the bot has an app for them.
  const starters = startersFor(bot.jobs ?? [], appKinds(apps.map((a) => a.connectorId)), bot.role);
  if (!starters.length) starters.push("What can you do?", "Remind me to stretch in 20 minutes", "What's the weather this week?");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SetupChecklist botId={botId} />
      <ChatView
        botId={botId}
        botName={bot.name}
        avatar={bot.avatar as AvatarId}
        color={bot.color as ColorwayId}
        initialMessages={visible.map((m) => toChatMessage({ ...m, meta: withMeeting((m.meta ?? {}) as Record<string, unknown>), createdAt: m.createdAt.toISOString() }))}
        initialApprovals={approvals.map((a) => ({
          id: a.id,
          title: a.title,
          detail: a.detail,
          risk: a.risk,
          reasons: a.reasons,
          tool: a.tool,
          status: a.status,
          expiresAt: a.expiresAt.toISOString(),
          args: a.args,
        }))}
        starters={starters}
        memoryInvite={known.length < 5 && !known.some((m) => m.source === "import")}
        needsGreeting={visible.length === 0}
        brainLabel={brainLabel(bot.brain)}
        initialInput={typeof ask === "string" && ask.trim() ? ask.slice(0, 500) : undefined}
        viaBridge={bot.brain.kind === "subscription"}
      />
    </div>
  );
}
