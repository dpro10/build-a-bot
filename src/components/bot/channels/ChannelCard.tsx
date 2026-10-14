"use client";
import * as React from "react";
import Link from "next/link";
import { Ellipsis, MessageCircle, PhoneCall, Power, PowerOff, Rocket, Send, TriangleAlert } from "lucide-react";
import { BrandTile } from "@/components/brand/icons";
import { channelIcon } from "@/components/catalog/channel-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/components/ui/dropdown";
import { toast } from "@/components/ui/toaster";
import { comingSoonNote } from "@/lib/channels/catalog";
import { cn } from "@/lib/utils";
import type { ChannelCtx } from "./context";
import { DiscordActive, DiscordSetup } from "./DiscordSetup";
import { EmailSetup } from "./EmailSetup";
import { channelDef, type ChannelView } from "./model";
import { ChannelStatusPill } from "./parts";
import { PhoneSetup } from "./PhoneSetup";
import { SlackActive, SlackSetup } from "./SlackSetup";
import { TelegramActive, TelegramSetup } from "./TelegramSetup";
import { WAITLIST_WHY, WaitlistJoin } from "./WaitlistJoin";

const WHERE: Record<string, string> = {
  telegram: "Telegram",
  sms: "your texts",
  voice: "your phone",
  email: "your inbox",
  slack: "Slack",
  discord: "Discord",
};

const UPGRADE_PITCH: Record<string, string> = {
  sms: "Text it from any phone, no app needed. Plus includes 300 texts a month.",
  voice: "Call it and talk out loud, or let it call you with your morning brief. Plus includes 60 minutes a month.",
};

export function ChannelCard({
  channel,
  ctx,
  planBadge,
  available,
  highlighted,
  joined,
  onJoin,
}: {
  channel: ChannelView;
  ctx: ChannelCtx;
  /** "Plus" / "Pro" when the owner's plan doesn't include this channel. */
  planBadge: string | null;
  /** The integration behind it is set up on this server (or simulated in demo mode). */
  available: boolean;
  highlighted: boolean;
  joined: boolean;
  onJoin: (email?: string) => Promise<boolean>;
}) {
  const def = channelDef(channel.kind);
  const [busy, setBusy] = React.useState<string | null>(null);
  const isWeb = channel.kind === "web";
  const waitlist = channel.status === "waitlist" || def.availability === "waitlist" || def.availability === "soon";
  // Its service isn't set up on this server: that comes before any plan question.
  const soon = !isWeb && !waitlist && !available;
  const locked = Boolean(planBadge) && !soon;
  const active = channel.status === "active";
  const off = channel.status === "disabled";
  const status = isWeb ? "active" : channel.status;

  const act = async (action: "test" | "call_me" | "disable" | "enable") => {
    setBusy(action);
    const data = await ctx.run(channel.kind, action);
    if (data && (action === "disable" || action === "enable")) await ctx.refresh();
    setBusy(null);
    if (!data) return;
    const simulated = data.status === "simulated";
    if (action === "test") {
      toast.success(simulated ? `Test ${channel.kind === "voice" ? "call" : "message"} simulated. Nothing is really sent in demo mode; you can see it in Activity.` : `Sent! Check ${WHERE[channel.kind] ?? def.name}.`);
    } else if (action === "call_me") {
      toast.success(simulated ? "Call simulated. Nothing is really dialed in demo mode; you can see it in Activity." : `${ctx.botName} is calling you now.`);
    } else if (action === "disable") {
      toast.success(`${def.name} is off. ${ctx.botName} won't use it until you turn it back on.`);
    } else {
      toast.success(data.status === "active" ? `${def.name} is back on.` : `${def.name} is on. Finish setting it up below.`);
    }
  };

  let body: React.ReactNode;
  if (isWeb) {
    body = null;
  } else if (waitlist) {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-foreground/80">{WAITLIST_WHY[channel.kind] ?? `${def.name} is coming soon.`}</p>
        {def.availability === "soon" ? null : (
          <div className="flex">
            <WaitlistJoin name={def.name} joined={joined} ownerEmail={ctx.ownerEmail} onJoin={onJoin} />
          </div>
        )}
      </div>
    );
  } else if (soon) {
    body = <p className="text-sm text-muted-foreground">{comingSoonNote(def)} Nothing to set up until then.</p>;
  } else if (locked) {
    body = (
      <div className="flex flex-col gap-3 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary-soft to-card p-4 sm:flex-row sm:items-center">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Rocket className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{ctx.plansOnSale ? `${def.name} ${def.plural ? "are" : "is"} part of ${planBadge}` : `Part of ${planBadge}. Paid plans are coming soon.`}</div>
          <p className="text-sm text-muted-foreground">{UPGRADE_PITCH[channel.kind] ?? def.description}</p>
        </div>
        {ctx.plansOnSale ? (
          <Button asChild size="sm" className="w-fit shrink-0">
            <Link href="/app/billing">See {planBadge}</Link>
          </Button>
        ) : null}
      </div>
    );
  } else if (off) {
    body = <p className="text-sm text-muted-foreground">Turned off. {ctx.botName} won&apos;t message you or answer on {def.name} until you turn it back on.</p>;
  } else if (channel.kind === "telegram") {
    body = active ? <TelegramActive channel={channel} ctx={ctx} /> : <TelegramSetup channel={channel} ctx={ctx} />;
  } else if (channel.kind === "sms" || channel.kind === "voice") {
    body = <PhoneSetup channel={channel} ctx={ctx} />;
  } else if (channel.kind === "email") {
    body = <EmailSetup channel={channel} ctx={ctx} />;
  } else if (channel.kind === "slack") {
    body = active ? <SlackActive channel={channel} ctx={ctx} /> : <SlackSetup channel={channel} ctx={ctx} />;
  } else if (channel.kind === "discord") {
    body = active ? <DiscordActive channel={channel} ctx={ctx} /> : <DiscordSetup channel={channel} ctx={ctx} />;
  } else {
    body = <p className="text-sm text-muted-foreground">{def.description}</p>;
  }

  const canToggle = !isWeb && !waitlist && !soon && !locked;
  const footer =
    canToggle && active ? (
      <>
        {channel.kind === "voice" ? (
          <Button size="sm" variant="soft" onClick={() => void act("call_me")} loading={busy === "call_me"}>
            <PhoneCall /> Call me now
          </Button>
        ) : (
          <Button size="sm" variant="soft" onClick={() => void act("test")} loading={busy === "test"}>
            <Send /> Send a test message
          </Button>
        )}
        <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" onClick={() => void act("disable")} loading={busy === "disable"}>
          <PowerOff /> Turn off
        </Button>
      </>
    ) : canToggle && off ? (
      <Button size="sm" variant="outline" onClick={() => void act("enable")} loading={busy === "enable"}>
        <Power /> Turn on
      </Button>
    ) : null;

  return (
    <article
      id={channel.kind}
      aria-labelledby={`${channel.kind}-name`}
      className={cn(
        "scroll-mt-28 overflow-hidden rounded-3xl border bg-card shadow-soft transition-[box-shadow,border-color] duration-500",
        highlighted ? "border-primary ring-4 ring-primary/20" : "border-border",
      )}
    >
      <header className="flex items-start gap-3 p-4 sm:px-5">
        <BrandTile icon={channelIcon(def)} size={44} className={cn((off || waitlist || soon) && "opacity-60 grayscale")} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 id={`${channel.kind}-name`} className="font-display text-[17px] font-semibold leading-tight">
              {def.name}
            </h3>
            {soon ? <Badge>Coming soon</Badge> : locked ? <Badge tone="accent">{planBadge}</Badge> : <ChannelStatusPill status={status} simulated={channel.simulated} />}
          </div>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {isWeb ? "Always on. Chat here in your browser, or add it to your phone's home screen for an app-like feel." : def.tagline}
          </p>
          {channel.status === "error" && channel.error ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-danger">
              <TriangleAlert className="mt-px size-3.5 shrink-0" /> {channel.error}
            </p>
          ) : null}
        </div>
        {isWeb ? (
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href={`/app/bots/${ctx.botId}`}>
              <MessageCircle /> <span className="hidden sm:inline">Open chat</span>
              <span className="sm:hidden">Chat</span>
            </Link>
          </Button>
        ) : null}
        {canToggle && !active && !off ? (
          <Dropdown>
            <DropdownTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More for ${def.name}`} className="text-muted-foreground">
                <Ellipsis />
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              <DropdownItem onSelect={() => void act("disable")}>
                <PowerOff /> Turn off
              </DropdownItem>
            </DropdownContent>
          </Dropdown>
        ) : null}
      </header>
      {body ? <div className="border-t border-border px-4 py-4 sm:px-5">{body}</div> : null}
      {footer ? <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-background-2/50 px-4 py-2.5 sm:px-5">{footer}</footer> : null}
    </article>
  );
}
