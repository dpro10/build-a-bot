import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq, like, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getBotSetup, getOwnedBot } from "@/lib/data";
import { CHANNELS, channelUsable, isChannelKind, type ChannelKind } from "@/lib/channels/catalog";
import { comingSoonConnectors } from "@/lib/connectors/availability";
import { demoMode, live } from "@/lib/env";
import { isTrustLevel } from "@/lib/trust";
import { botEmailAddress } from "@/lib/tools/builtin/inbox";
import { SubTabs } from "@/components/app/SubTabs";
import { AppsTrustView } from "@/components/bot/tools/AppsTrustView";
import { toConnectionView } from "@/components/bot/tools/model";
import { ChannelsView } from "@/components/bot/channels/ChannelsView";
import { toChannelView, type ChannelView } from "@/components/bot/channels/model";

export const metadata: Metadata = { title: "Apps & channels" };

/** Apps & channels: what the bot can use and how much it does alone (?tab=apps), and where you talk (?tab=channels). */
export default async function AppsChannelsPage({
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
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const tab = first(sp.tab) === "channels" ? "channels" : "apps";
  const base = `/app/bots/${botId}/tools`;

  const intro = (
    <header className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Apps & channels</h1>
        <p className="max-w-2xl text-muted-foreground">
          What {bot.name} can use, how much it does on its own, and where you two talk. Every action follows these rules and gets a receipt.
        </p>
      </div>
      <SubTabs
        label="Apps & channels"
        active={tab}
        items={[
          { id: "apps", label: "Apps & trust", href: base },
          { id: "channels", label: "Channels", href: `${base}?tab=channels` },
        ]}
      />
    </header>
  );

  if (tab === "channels") {
    const [{ channels }, waitlisted] = await Promise.all([
      getBotSetup(db, botId),
      db
        .select({ feature: schema.waitlist.feature })
        .from(schema.waitlist)
        .where(
          and(
            user.email ? or(eq(schema.waitlist.userId, user.id), eq(schema.waitlist.email, user.email.toLowerCase())) : eq(schema.waitlist.userId, user.id),
            like(schema.waitlist.feature, "channel:%"),
          ),
        ),
    ]);
    // Usable on this server: the integration is configured, or simulated in demo mode.
    const availability: Partial<Record<ChannelKind, boolean>> = {};
    for (const def of CHANNELS) availability[def.kind] = channelUsable(def, demoMode, live);
    const joined = waitlisted.map((w) => w.feature.replace(/^channel:/, "")).filter(isChannelKind);

    return (
      <ChannelsView
        intro={intro}
        bot={{ id: bot.id, name: bot.name }}
        channels={channels.map(toChannelView).filter((c): c is ChannelView => Boolean(c))}
        demo={demoMode}
        ownerEmail={user.email ?? null}
        botEmail={botEmailAddress(bot)}
        availability={availability}
        joined={joined}
        slackOneClick={live.slackOAuth}
        flash={{ slackAdded: first(sp.slack) === "added", movedFrom: first(sp.moved), error: first(sp.channel_error) }}
      />
    );
  }

  const { connections } = await getBotSetup(db, botId);
  const errorParam = first(sp.connect_error) ?? first(sp.error);
  return (
    <AppsTrustView
      intro={intro}
      bot={{
        id: bot.id,
        name: bot.name,
        trust: isTrustLevel(bot.trust) ? bot.trust : "ask",
        jobs: bot.jobs ?? [],
        limits: bot.limits ?? {},
      }}
      connections={connections.map(toConnectionView)}
      composioLive={live.composio}
      comingSoon={comingSoonConnectors()}
      timezone={user.timezone || "UTC"}
      flash={{ connected: first(sp.connected) === "1", error: errorParam ? errorParam.slice(0, 300) : null }}
    />
  );
}
