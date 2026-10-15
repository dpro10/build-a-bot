import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq, like, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getBotSetup, getOwnedBot } from "@/lib/data";
import { CHANNELS, channelUsable, isChannelKind, type ChannelKind } from "@/lib/channels/catalog";
import { demoMode, live } from "@/lib/env";
import { botEmailAddress } from "@/lib/tools/builtin/inbox";
import { ChannelsView } from "@/components/bot/channels/ChannelsView";
import { toChannelView, type ChannelView } from "@/components/bot/channels/model";

export const metadata: Metadata = { title: "Channels" };

export default async function ChannelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ botId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { botId } = await params;
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const user = await requireUser(`/app/bots/${botId}/channels`);
  const db = await getDb();
  const bot = await getOwnedBot(db, user.id, botId);
  if (!bot) notFound();
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
      bot={{ id: bot.id, name: bot.name }}
      channels={channels.map(toChannelView).filter((c): c is ChannelView => Boolean(c))}
      planId={user.plan}
      demo={demoMode}
      plansOnSale={live.stripe || demoMode}
      ownerEmail={user.email ?? null}
      botEmail={botEmailAddress(bot)}
      availability={availability}
      joined={joined}
      slackOneClick={live.slackOAuth}
      flash={{ slackAdded: first(sp.slack) === "added", movedFrom: first(sp.moved), error: first(sp.channel_error) }}
    />
  );
}
