"use client";
import * as React from "react";
import { Check, Lock } from "lucide-react";
import { BrandTile } from "@/components/brand/icons";
import { channelIcon } from "@/components/catalog/channel-icon";
import { Badge } from "@/components/ui/badge";
import { FieldHint, Input, Label, tidyUsPhone, UsPhoneInput } from "@/components/ui/input";
import { UNIT_PRICES, formatMicros } from "@/lib/billing/prices";
import { CHANNELS, channelAvailability, type ChannelDef, type ChannelKind, type LiveFlags } from "@/lib/channels/catalog";
import { cn } from "@/lib/utils";
import { isEmailLike, isPhoneLike } from "../state";
import { StepHeading } from "./StepHeading";

export function ChannelsStep({
  botName,
  channels,
  onChannels,
  phone,
  onPhone,
  email,
  onEmail,
  demo,
  live,
  suggested = [],
}: {
  botName: string;
  channels: ChannelKind[];
  onChannels: (c: ChannelKind[]) => void;
  phone: string;
  onPhone: (v: string) => void;
  email: string;
  onEmail: (v: string) => void;
  demo: boolean;
  live: LiveFlags;
  /** What the recipe or role talks on: a hint, not picked for the owner. */
  suggested?: ChannelKind[];
}) {
  const name = botName.trim() || "your bot";
  const needsPhone = channels.includes("sms") || channels.includes("voice");
  const needsEmail = channels.includes("email");
  const [phoneTouched, setPhoneTouched] = React.useState(false);
  const [emailTouched, setEmailTouched] = React.useState(false);

  const toggle = (kind: ChannelKind) => onChannels(channels.includes(kind) ? channels.filter((c) => c !== kind) : [...channels, kind]);

  const simulated = (def: ChannelDef) => demo && def.requires && !live[def.requires];
  // Texts and calls cost money (Twilio); everything else here is free.
  const priceNote = (def: ChannelDef) =>
    def.kind === "sms"
      ? `Texts are paid from your credit, at cost: ${formatMicros(UNIT_PRICES.textIn)} for each one you send it, ${formatMicros(UNIT_PRICES.textOut)} for each reply.`
      : def.kind === "voice"
        ? `Calls are paid from your credit, at cost: ${formatMicros(UNIT_PRICES.callMinute)} a minute.`
        : null;

  // Outside demo mode, a channel whose service isn't set up here waits with the ones coming later.
  const availability = (def: ChannelDef) => channelAvailability(def, demo, live);
  const available = CHANNELS.filter((c) => availability(c) === "available" || availability(c) === "beta");
  const later = CHANNELS.filter((c) => availability(c) === "waitlist" || availability(c) === "soon");

  return (
    <div className="flex flex-col gap-6">
      <StepHeading title="How do you want to talk?" subtitle={`Pick as many as you like — ${name} keeps one memory across all of them. The web app is always on.`} />

      <div className="grid gap-2.5 sm:grid-cols-2">
        {available.map((def) => {
          const always = def.kind === "web";
          const active = always || channels.includes(def.kind);
          const price = priceNote(def);
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
                  {suggested.includes(def.kind) && !active ? <Badge tone="accent">Suggested</Badge> : null}
                  {simulated(def) && active ? <Badge tone="warning">Simulated in demo</Badge> : null}
                </span>
                <span className="block text-sm font-medium text-foreground/80">{def.tagline}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{def.description}</span>
                {def.note && active ? <span className="mt-1 block text-xs text-muted-foreground">{def.note}</span> : null}
                {price ? <span className="mt-1 block text-xs text-muted-foreground">{price}</span> : null}
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
              <UsPhoneInput
                id="owner-phone"
                value={tidyUsPhone(phone)}
                onValueChange={onPhone}
                onBlur={() => setPhoneTouched(true)}
                aria-invalid={phoneTouched && !isPhoneLike(phone)}
              />
              <FieldHint className={cn(phoneTouched && !isPhoneLike(phone) && "text-danger")}>
                {phoneTouched && !isPhoneLike(phone) ? "Your 10-digit number, area code first." : `So ${name} knows it's you. You'll get a code by call or text to confirm. US & Canada to start.`}
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
            const waitlist = availability(def) === "waitlist";
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
                    <Lock className="size-3" /> Coming soon
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
