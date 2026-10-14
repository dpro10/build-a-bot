import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { requireUser, isAnonymous } from "@/lib/auth/session";
import { listBots, pendingApprovalCount } from "@/lib/data";
import { AppShell, type ShellBot } from "@/components/app/AppShell";
import { getPlan } from "@/lib/billing/plans";
import { demoMode } from "@/lib/env";
import { TRUST, isTrustLevel } from "@/lib/trust";
import type { AvatarId, ColorwayId } from "@/lib/avatars";

export const metadata: Metadata = { title: "Your bots", robots: { index: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/app");
  const db = await getDb();
  const [bots, pendingTotal] = await Promise.all([listBots(db, user.id), pendingApprovalCount(db, user.id)]);
  const shellBots: ShellBot[] = bots.map(({ bot, pendingApprovals, lastMessage }) => ({
    id: bot.id,
    name: bot.name,
    avatar: bot.avatar as AvatarId,
    color: bot.color as ColorwayId,
    status: bot.status,
    pending: pendingApprovals,
    subtitle: lastMessage ? lastMessage.text.replace(/\s+/g, " ").slice(0, 60) : TRUST[isTrustLevel(bot.trust) ? bot.trust : "ask"].name,
  }));
  return (
    <AppShell bots={shellBots} pendingTotal={pendingTotal} planName={getPlan(user.plan).name} demo={demoMode} anonymous={isAnonymous(user)}>
      {children}
    </AppShell>
  );
}
