"use client";
/**
 * The bot, assembling itself as the owner makes choices. Sticky on desktop;
 * a compact strip on phones.
 */
import * as React from "react";
import { Brain, MessageCircle, Puzzle, ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { BrandTile } from "@/components/brand/icons";
import { channelIcon } from "@/components/catalog/channel-icon";
import { ALWAYS_ON } from "@/components/catalog/connector-meta";
import { AVATARS, COLORWAYS, type AvatarMood, type ColorwayId } from "@/lib/avatars";
import { CHANNEL_BY_KIND } from "@/lib/channels/catalog";
import { getConnector, type ConnectorDef } from "@/lib/connectors";
import { INCLUDED_MODELS, PROVIDER_BY_ID, SUBSCRIPTIONS } from "@/lib/models/catalog";
import { TRUST } from "@/lib/trust";
import { cn } from "@/lib/utils";
import { countedApps, type BuilderState, type StepId } from "./state";

/** A wash of the colorway that reads well in both themes: a little of its color mixed into the card. */
export function colorwayTint(color: ColorwayId, percent = 18): string {
  return `color-mix(in oklab, ${COLORWAYS[color].base} ${percent}%, var(--card))`;
}

export function brainSummary(s: BuilderState): { title: string; sub: string } {
  const b = s.brain;
  if (b.kind === "included") {
    const m = INCLUDED_MODELS.find((x) => x.id === b.model);
    return { title: m?.label ?? "Open model", sub: `Included · ${m?.maker ?? "open weights"}` };
  }
  if (b.kind === "subscription") {
    const sub = SUBSCRIPTIONS.find((x) => x.id === b.subscription);
    return { title: `Your ${sub?.name ?? "subscription"}`, sub: `${sub?.plans ?? ""} plan · via your computer` };
  }
  const p = PROVIDER_BY_ID[b.provider];
  const m = p?.models.find((x) => x.id === b.model);
  return { title: m?.label ?? (b.model || "Your model"), sub: `Your ${p?.name ?? "provider"} key` };
}

/** `appLimit`: apps one bot connects (fair use; left out in demo mode, which connects them all). */
export function speech(step: StepId, s: BuilderState, appLimit?: number): string {
  const a = AVATARS[s.avatar];
  const name = s.name.trim();
  switch (step) {
    case "face":
      return `${a.character} the ${a.species}. ${a.tagline}`;
    case "name":
      return name ? `Hi! I'm ${name}.` : "What should I be called?";
    case "brain":
      return s.brain.kind === "subscription" ? "I'll think with your own plan, on your computer." : s.brain.kind === "byok" ? "Your key, your model. Nice." : "Which brain should I think with?";
    case "apps": {
      // The apps that will really be connected, counted like the fair-use limit counts them (built-in tools aren't apps).
      const n = Math.min(countedApps(s.connectors, s.customMcp), appLimit ?? Infinity);
      if (n) return `${n} app${n === 1 ? "" : "s"}! I'll put ${n === 1 ? "it" : "them"} to work.`;
      return s.connectors.some((c) => !ALWAYS_ON.has(c)) ? "Tools packed! Which apps do you use?" : "Which apps can I help with?";
    }
    case "trust":
      return {
        look: "I'll look, never touch.",
        ask: "I'll ask before I do anything.",
        trusted: "I'll handle the small stuff and ask about the big stuff.",
        full: "I've got this. Anything sketchy still comes to you.",
      }[s.trust];
    case "channels":
      return s.channels.length ? "Can't wait to hear from you." : "Where should we talk?";
    case "review":
      return `Ready when you are${s.ownerName.trim() ? `, ${s.ownerName.trim()}` : ""}!`;
  }
}

export function moodFor(step: StepId, s: BuilderState, typing: boolean): AvatarMood {
  if (typing) return "happy";
  switch (step) {
    case "brain":
      return "thinking";
    case "apps":
      return s.connectors.length ? "working" : "idle";
    case "trust":
      return s.trust === "full" ? "happy" : s.trust === "look" ? "thinking" : "idle";
    case "channels":
    case "review":
      return "happy";
    default:
      return "idle";
  }
}

function appDefs(s: BuilderState): ConnectorDef[] {
  return s.connectors
    .filter((id) => !ALWAYS_ON.has(id))
    .map((id) => getConnector(id))
    .filter((d): d is ConnectorDef => Boolean(d));
}

export function BotPreview({ state: s, step, stepIndex, typing, appLimit }: { state: BuilderState; step: StepId; stepIndex: number; typing: boolean; appLimit?: number }) {
  const a = AVATARS[s.avatar];
  const color = COLORWAYS[s.color];
  const apps = appDefs(s);
  const brain = brainSummary(s);
  const trust = TRUST[s.trust];
  const channels = ["web", ...s.channels].map((k) => CHANNEL_BY_KIND[k as keyof typeof CHANNEL_BY_KIND]).filter(Boolean);
  const reached = (id: StepId) => stepIndex >= ["face", "name", "brain", "apps", "trust", "channels", "review"].indexOf(id);
  const said = speech(step, s, appLimit);

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-lift">
      <div className="relative flex flex-col items-center px-6 pt-6 pb-5" style={{ background: `radial-gradient(120% 90% at 50% 0%, ${colorwayTint(s.color, 22)} 0%, transparent 70%)` }}>
        <div className="pointer-events-none absolute inset-0 opacity-50 dark:opacity-20" style={{ background: `radial-gradient(60% 50% at 50% 35%, ${color.light}55 0%, transparent 70%)` }} aria-hidden />
        <div key={`${step}-${said}`} className="relative z-10 mb-1 max-w-[260px] animate-pop rounded-2xl rounded-bl-md bg-card px-3.5 py-2 text-center text-sm font-medium shadow-soft ring-1 ring-border">
          {said}
        </div>
        <div className="relative z-10">
          <Avatar avatar={s.avatar} color={s.color} size={168} mood={moodFor(step, s, typing)} />
        </div>
        <div className="relative z-10 mt-1 text-center">
          <div className={cn("font-display text-2xl font-bold leading-tight", !s.name.trim() && "text-muted-foreground/80")}>{s.name.trim() || "Your bot"}</div>
          <div className="mt-1.5 flex flex-wrap justify-center gap-1">
            {a.traits.map((t) => (
              <span
                key={t}
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                // Half the colorway, half the text color: readable in both themes, even for Midnight.
                style={{ background: `${color.base}1f`, color: `color-mix(in oklab, ${color.deep} 55%, var(--foreground))` }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
      <dl className="divide-y divide-border border-t border-border text-sm">
        <PreviewRow icon={<Brain className="size-4" />} label="Brain" pending={!reached("brain")}>
          <span className="block truncate font-semibold">{brain.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{brain.sub}</span>
        </PreviewRow>
        <PreviewRow icon={<Puzzle className="size-4" />} label="Apps" pending={!reached("apps")}>
          {apps.length || s.customMcp.length ? (
            <span className="flex items-center">
              <span className="flex -space-x-1.5">
                {apps.slice(0, 7).map((d) => (
                  <BrandTile key={d.id} icon={d.icon} size={24} className="ring-2 ring-card" />
                ))}
                {s.customMcp.slice(0, 2).map((m) => (
                  <BrandTile key={m.url} icon={{ lucide: "Plug", color: "64748B" }} size={24} className="ring-2 ring-card" />
                ))}
              </span>
              {apps.length + s.customMcp.length > 7 ? <span className="ml-2 text-xs font-semibold text-muted-foreground">+{apps.length + s.customMcp.length - 7}</span> : null}
            </span>
          ) : (
            <span className="text-muted-foreground">Built-ins only</span>
          )}
        </PreviewRow>
        <PreviewRow icon={<ShieldCheck className="size-4" />} label="Trust" pending={!reached("trust")}>
          <span className="font-semibold">
            {trust.emoji} {trust.name}
          </span>
        </PreviewRow>
        <PreviewRow icon={<MessageCircle className="size-4" />} label="Talk" pending={!reached("channels")}>
          <span className="flex flex-wrap gap-1">
            {channels.map((c) => (
              <BrandTile key={c.kind} icon={channelIcon(c)} size={24} label={c.name} />
            ))}
          </span>
        </PreviewRow>
      </dl>
    </div>
  );
}

function PreviewRow({ icon, label, pending, children }: { icon: React.ReactNode; label: string; pending: boolean; children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-5 py-2.5">
      <dt className="flex w-16 shrink-0 items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {icon}
        {label}
      </dt>
      <dd className="min-w-0 flex-1">
        {pending ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground">Coming up</span>
        ) : (
          <span className="block animate-fade-up">{children}</span>
        )}
      </dd>
    </div>
  );
}

/** Compact version for phones: avatar + name + what's set so far. */
export function BotPreviewStrip({ state: s, step, typing, appLimit }: { state: BuilderState; step: StepId; typing: boolean; appLimit?: number }) {
  const said = speech(step, s, appLimit);
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2 shadow-soft">
      <Avatar avatar={s.avatar} color={s.color} size={52} mood={moodFor(step, s, typing)} />
      <div className="min-w-0 flex-1">
        <div className={cn("truncate font-display text-lg font-bold leading-tight", !s.name.trim() && "text-muted-foreground")}>{s.name.trim() || "Your bot"}</div>
        <div key={said} className="animate-fade-up truncate text-xs text-muted-foreground">
          {said}
        </div>
      </div>
    </div>
  );
}
