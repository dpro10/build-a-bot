import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getBotSetup, getOwnedBot } from "@/lib/data";
import { getPlan, planAllowsTrust } from "@/lib/billing/plans";
import { comingSoonBuiltins } from "@/lib/connectors/availability";
import { demoMode, live, paidPlansOpen } from "@/lib/env";
import { isTrustLevel, type TrustLevel } from "@/lib/trust";
import { AppsTrustView } from "@/components/bot/tools/AppsTrustView";
import { toConnectionView } from "@/components/bot/tools/model";

export const metadata: Metadata = { title: "Apps & trust" };

export default async function ToolsPage({
  params,
  searchParams,
}: {
  params: Promise<{ botId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { botId } = await params;
  const user = await requireUser(`/app/bots/${botId}/tools`);
  const db = await getDb();
  const bot = await getOwnedBot(db, user.id, botId);
  if (!bot) notFound();
  const { connections } = await getBotSetup(db, botId);
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

  const plan = getPlan(user.plan);
  const planBadges: Partial<Record<TrustLevel, string>> = !demoMode && !planAllowsTrust(plan, "full") ? { full: "Plus" } : {};
  const errorParam = first(sp.connect_error) ?? first(sp.error);

  return (
    <AppsTrustView
      bot={{
        id: bot.id,
        name: bot.name,
        trust: isTrustLevel(bot.trust) ? bot.trust : "ask",
        jobs: bot.jobs ?? [],
        limits: bot.limits ?? {},
      }}
      connections={connections.map(toConnectionView)}
      planBadges={planBadges}
      paidPlans={paidPlansOpen}
      composioLive={live.composio}
      comingSoon={comingSoonBuiltins()}
      timezone={user.timezone || "UTC"}
      flash={{ connected: first(sp.connected) === "1", error: errorParam ? errorParam.slice(0, 300) : null }}
    />
  );
}
