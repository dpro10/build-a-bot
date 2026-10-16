import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getOwnedBot, listApprovals } from "@/lib/data";
import { BotLiveProvider } from "@/components/app/live-state";
import { BotHeader } from "@/components/app/BotHeader";
import { brainLabel } from "@/lib/bots/labels";
import { computerFor } from "@/lib/bridge/jobs";
import { live } from "@/lib/env";

export default async function BotLayout({ children, params }: { children: React.ReactNode; params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const user = await requireUser(`/app/bots/${botId}`);
  const db = await getDb();
  const bot = await getOwnedBot(db, user.id, botId);
  if (!bot) notFound();
  const [pending, computer] = await Promise.all([listApprovals(db, user.id, { botId, status: "pending" }), computerFor(db, bot)]);
  return (
    <BotLiveProvider initialPaused={bot.status === "paused"} initialPending={pending.length} initialComputer={computer}>
      <div className="flex min-h-0 flex-1 flex-col">
        <BotHeader
          bot={{ id: bot.id, name: bot.name, avatar: bot.avatar, color: bot.color, trust: bot.trust, status: bot.status, role: bot.role }}
          brain={brainLabel(bot.brain)}
          callable={live.voiceServer}
        />
        {children}
      </div>
    </BotLiveProvider>
  );
}
