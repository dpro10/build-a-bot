import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getOwnedBot, listApprovals, listMessages } from "@/lib/data";
import { ensureConversation } from "@/lib/channels/outbound";
import { ChatView } from "@/components/chat/ChatView";
import { toChatMessage } from "@/components/chat/messages";
import { JOB_BY_ID } from "@/lib/jobs";
import { brainLabel } from "@/lib/bots/labels";
import type { AvatarId, ColorwayId } from "@/lib/avatars";
import { notFound } from "next/navigation";
import { SetupChecklist } from "@/components/app/SetupChecklist";

export default async function BotChatPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const user = await requireUser(`/app/bots/${botId}`);
  const db = await getDb();
  const bot = await getOwnedBot(db, user.id, botId);
  if (!bot) notFound();
  const conversation = await ensureConversation(db, botId, "web", "owner");
  const [messages, approvals] = await Promise.all([listMessages(db, conversation.id, { limit: 80 }), listApprovals(db, user.id, { botId, limit: 100 })]);
  const visible = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const starters = [...new Set((bot.jobs ?? []).flatMap((j) => JOB_BY_ID[j as keyof typeof JOB_BY_ID]?.starters ?? []))];
  if (!starters.length) starters.push("What can you do?", "Remind me to stretch in 20 minutes", "What's the weather this week?");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SetupChecklist botId={botId} />
      <ChatView
        botId={botId}
        botName={bot.name}
        avatar={bot.avatar as AvatarId}
        color={bot.color as ColorwayId}
        initialMessages={visible.map((m) => toChatMessage({ ...m, createdAt: m.createdAt.toISOString() }))}
        initialApprovals={approvals.map((a) => ({
          id: a.id,
          title: a.title,
          detail: a.detail,
          risk: a.risk,
          reasons: a.reasons,
          tool: a.tool,
          status: a.status,
          expiresAt: a.expiresAt.toISOString(),
        }))}
        starters={starters}
        needsGreeting={visible.length === 0}
        brainLabel={brainLabel(bot.brain)}
      />
    </div>
  );
}
