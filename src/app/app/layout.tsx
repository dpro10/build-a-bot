import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { requireUser, isAnonymous } from "@/lib/auth/session";
import { listBots, pendingApprovalCount } from "@/lib/data";
import { AppShell, type ShellBot, type ShellCredit } from "@/components/app/AppShell";
import { plainPreview } from "@/components/app/preview";
import { getCredit } from "@/lib/billing/credit";
import { freeMessagesLeft } from "@/lib/billing/usage";
import { creditTone, formatMicros } from "@/lib/billing/prices";
import { demoMode } from "@/lib/env";
import { TRUST, isTrustLevel } from "@/lib/trust";
import type { AvatarId, ColorwayId } from "@/lib/avatars";

export const metadata: Metadata = { title: "Your bots", robots: { index: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/app");
  const db = await getDb();
  const [bots, pendingTotal, credit, freeLeft] = await Promise.all([
    listBots(db, user.id),
    pendingApprovalCount(db, user.id),
    getCredit(db, user.id),
    freeMessagesLeft(db, user),
  ]);
  // Before signing in, the free messages are what counts (the starter credit opens up with an email).
  const shellCredit: ShellCredit =
    freeLeft != null
      ? { label: `${freeLeft} free`, tone: freeLeft > 0 ? "primary" : "danger", freeLeft }
      : { label: formatMicros(Math.max(0, credit.balanceMicros)), tone: creditTone(credit.balanceMicros) };
  const shellBots: ShellBot[] = bots.map(({ bot, pendingApprovals, lastMessage }) => ({
    id: bot.id,
    name: bot.name,
    avatar: bot.avatar as AvatarId,
    color: bot.color as ColorwayId,
    status: bot.status,
    pending: pendingApprovals,
    subtitle: lastMessage ? plainPreview(lastMessage.text, 60) : TRUST[isTrustLevel(bot.trust) ? bot.trust : "ask"].name,
  }));
  return (
    <AppShell bots={shellBots} pendingTotal={pendingTotal} credit={shellCredit} demo={demoMode} anonymous={isAnonymous(user)}>
      {children}
    </AppShell>
  );
}
