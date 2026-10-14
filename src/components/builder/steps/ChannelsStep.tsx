"use client";
import * as React from "react";
import { Check, Lock } from "lucide-react";
import { BrandTile } from "@/components/brand/icons";
import { channelIcon } from "@/components/catalog/channel-icon";
import { Badge } from "@/components/ui/badge";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { PLANS, planAllowsChannel, type PlanId } from "@/lib/billing/plans";
import { CHANNELS, type ChannelDef, type ChannelKind } from "@/lib/channels/catalog";
import { cn } from "@/lib/utils";
import { isEmailLike, isPhoneLike } from "../state";
import { StepHeading } from "./StepHeading";

export type LiveFlags = { twilio: boolean; email: boolean; discord: boolean; telegramManaged: boolean; slackOAuth: boolean };

export function ChannelsStep({
  botName,
  channels,
  onChannels,
  phone,
  onPhone,
  email,
  onEmail,
  plan,
  demo,
  live,
}: {
  botName: string;
  channels: ChannelKind[];
  onChannels: (c: ChannelKind[]) => void;
  phone: string;
  onPhone: (v: string) => void;
  email: string;
  onEmail: (v: string) => void;
  plan: PlanId;
  demo: boolean;
  live: LiveFlags;
}) {
  const name = botName.trim() || "your bot";
  const needsPhone = channels.includes("sms") || channels.includes("voice");
  const needsEmail = channels.includes("email");
  const [phoneTouched, setPhoneTouched] = React.useState(false);
  const [emailTouched, setEmailTouched] = React.useState(false);

  const toggle = (kind: ChannelKind) => onChannels(channels.includes(kind) ? channels.filter((c) => c !== kind) : [...channels, kind]);

  const simulated = (def: ChannelDef) => demo && def.requires && !(live as Record<string, boolean>)[def.requires];
  const planBadge = (def: ChannelDef) => (!demo && !planAllowsChannel(PLANS[plan], def.kind) && def.availability !== "soon" && def.availability !== "waitlist" ? (def.minPlan === "pro" ? "Pro" : "Plus") : null);

  const available = CHANNELS.filter((c) => c.availability === "available" || c.availability === "beta");
  const later = CHANNELS.filter((c) => c.availability === "waitlist" || c.availability === "soon");

  return (
    <div className="flex flex-col gap-6">
      <StepHeading title="How do you want to talk?" subtitle={`Pick as many as you like — ${name} keeps one memory across all of them. The web app is always on.`} />

      <div className="grid gap-2.5 sm:grid-cols-2">
        {available.map((def) => {
          const always = def.kind === "web";
          const active = always || channels.includes(def.kind);
          const badge = planBadge(def);
          return (
            <button
              key={def.kind}
              type="button"
              aria-pressed={active}
              disabled={always}
              onClick={() => toggle(def.kind)}
              className={cn(
                "relative flex items-start gap-3 rounded-3xl border bg-card p-4 text-left transition",
                active ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-foreground/25",
                always && "cursor-default",
              )}
            >
              <BrandTile icon={channelIcon(def)} size={44} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-display text-[17px] font-semibold">{def.name}</span>
                  {always ? <Badge tone="success">Always on</Badge> : null}
                  {def.kind === "telegram" ? <Badge tone="primary">Free · instant</Badge> : null}
                  {badge ? <Badge tone="accent">{badge}</Badge> : null}
                  {simulated(def) && active ? <Badge tone="warning">Simulated in demo</Badge> : null}
                </span>
                <span className="block text-sm font-medium text-foreground/80">{def.tagline}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{def.description}</span>
                {def.note && active ? <span className="mt-1 block text-xs text-muted-foreground">{def.note}</span> : null}
              </span>
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border-2", active ? "border-primary bg-primary text-primary-foreground" : "border-input")} aria-hidden>
                {active ? <Check className="size-3.5" strokeWidth={3} /> : null}
              </span>
            </button>
          );
        })}
      </div>

      {needsPhone || needsEmail ? (
        <div className="grid animate-fade-up gap-4 rounded-3xl border border-border bg-background-2/60 p-4 sm:grid-cols-2 sm:p-5">
          {needsPhone ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="owner-phone">Your mobile number</Label>
              <Input
                id="owner-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+1 512 555 0123"
                value={phone}
                onChange={(e) => onPhone(e.target.value)}
                onBlur={() => setPhoneTouched(true)}
                aria-invalid={phoneTouched && !isPhoneLike(phone)}
              />
              <FieldHint className={cn(phoneTouched && !isPhoneLike(phone) && "text-danger")}>
                {phoneTouched && !isPhoneLike(phone) ? "Include the area code." : `So ${name} knows it's you. We'll text a code to confirm. US & Canada to start.`}
              </FieldHint>
            </div>
          ) : null}
          {needsEmail ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="owner-email">Your email</Label>
              <Input
                id="owner-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => onEmail(e.target.value)}
                onBlur={() => setEmailTouched(true)}
                aria-invalid={emailTouched && !isEmailLike(email)}
              />
              <FieldHint className={cn(emailTouched && !isEmailLike(email) && "text-danger")}>
                {emailTouched && !isEmailLike(email) ? "Check the address." : `${name.charAt(0).toUpperCase() + name.slice(1)} gets its own address; mail from this one counts as you.`}
              </FieldHint>
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Coming later</h2>
        <div className="flex flex-wrap gap-2">
          {later.map((def) => {
            const waitlist = def.availability === "waitlist";
            const active = channels.includes(def.kind);
            return (
              <button
                key={def.kind}
                type="button"
                disabled={!waitlist}
                aria-pressed={waitlist ? active : undefined}
                onClick={() => waitlist && toggle(def.kind)}
                title={def.description}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border py-1.5 pr-3.5 pl-1.5 text-sm font-medium transition",
                  active ? "border-primary bg-primary-soft text-primary" : "border-border bg-card text-muted-foreground",
                  waitlist ? "hover:border-foreground/30" : "cursor-default opacity-70",
                )}
              >
                <BrandTile icon={channelIcon(def)} size={24} />
                {def.name}
                {waitlist ? (
                  <span className="text-xs">{active ? "· On the waitlist" : "· Join waitlist"}</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs">
                    <Lock className="size-3" /> Soon
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">WhatsApp doesn&apos;t allow general AI assistants in the US yet; iMessage needs Apple&apos;s business program. We&apos;ll tell you the moment they open up.</p>
      </div>
    </div>
  );
}
