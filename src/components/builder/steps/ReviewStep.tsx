"use client";
import * as React from "react";
import Link from "next/link";
import { Bot, Brain, Check, Clock, MessageCircle, Puzzle, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { BrandTile } from "@/components/brand/icons";
import { channelIcon } from "@/components/catalog/channel-icon";
import { ALWAYS_ON, countsTowardLimit } from "@/components/catalog/connector-meta";
import { Textarea } from "@/components/ui/input";
import { AVATARS, COLORWAYS } from "@/lib/avatars";
import { PLANS, planAllowsChannel, type PlanId } from "@/lib/billing/plans";
import { CHANNEL_BY_KIND } from "@/lib/channels/catalog";
import { getConnector, type ConnectorDef } from "@/lib/connectors";
import { INCLUDED_MODELS } from "@/lib/models/catalog";
import { TRUST } from "@/lib/trust";
import { cn } from "@/lib/utils";
import { brainSummary } from "../BotPreview";
import type { BuilderState, StepId } from "../state";
import { StepHeading } from "./StepHeading";

/** What the server will adjust because of the owner's plan (it does the same checks). */
export function planAdjustments(s: BuilderState, plan: PlanId, demo: boolean): string[] {
  if (demo) return [];
  const p = PLANS[plan];
  const out: string[] = [];
  if (s.trust === "full" && !p.trust.includes("full")) out.push("Full faith is part of Plus — it starts as a Trusted helper.");
  if (s.brain.kind === "included") {
    const brain = s.brain;
    const m = INCLUDED_MODELS.find((x) => x.id === brain.model);
    if (m && !p.includedModels.includes(m.tier)) out.push(`${m.label} is part of ${m.tier === "smart" ? "Pro" : "Plus"} — it starts on ${INCLUDED_MODELS.find((x) => x.default)!.label}.`);
  }
  for (const kind of s.channels) {
    const def = CHANNEL_BY_KIND[kind];
    if (def && def.availability === "available" && !planAllowsChannel(p, kind)) out.push(`${def.name} is part of ${def.minPlan === "pro" ? "Pro" : "Plus"} — it'll be ready to switch on when you upgrade.`);
  }
  const apps = s.connectors.map((id) => getConnector(id)).filter((d): d is ConnectorDef => Boolean(d) && countsTowardLimit(d!)).length + s.customMcp.length;
  if (apps > p.limits.connectors) out.push(`${p.name} connects ${p.limits.connectors} apps per bot — the first ${p.limits.connectors} are added now.`);
  return out;
}

export function ReviewStep({
  state: s,
  onInstructions,
  onAge,
  goTo,
  plan,
  demo,
  timezone,
  atBotLimit,
}: {
  state: BuilderState;
  onInstructions: (v: string) => void;
  onAge: (v: boolean) => void;
  goTo: (step: StepId) => void;
  plan: PlanId;
  demo: boolean;
  timezone: string;
  atBotLimit: boolean;
}) {
  const name = s.name.trim() || "Your bot";
  const a = AVATARS[s.avatar];
  const apps = s.connectors.filter((id) => !ALWAYS_ON.has(id)).map((id) => getConnector(id)).filter((d): d is ConnectorDef => Boolean(d));
  const brain = brainSummary(s);
  const trust = TRUST[s.trust];
  const channels = ["web", ...s.channels].map((k) => CHANNEL_BY_KIND[k as keyof typeof CHANNEL_BY_KIND]).filter(Boolean);
  const adjustments = planAdjustments(s, plan, demo);

  return (
    <div className="flex flex-col gap-6">
      <StepHeading title={`Ready to meet ${name}?`} subtitle="Check everything over. You can change any of it later from the dashboard." />

      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        <div className="flex items-center gap-4 p-4 sm:p-5" style={{ background: `linear-gradient(90deg, ${COLORWAYS[s.color].tint}, transparent)` }}>
          <Avatar avatar={s.avatar} color={s.color} size={84} mood="happy" />
          <div className="min-w-0">
            <div className="font-display text-2xl font-bold">{name}</div>
            <div className="text-sm text-muted-foreground">
              {a.character} the {a.species} · {COLORWAYS[s.color].name}
              {s.ownerName.trim() ? ` · calls you ${s.ownerName.trim()}` : ""}
            </div>
          </div>
          <button type="button" onClick={() => goTo("face")} className="ml-auto self-start text-sm font-semibold text-primary hover:underline">
            Change
          </button>
        </div>
        <dl className="divide-y divide-border border-t border-border">
          <Row icon={<Brain className="size-4" />} label="Brain" onEdit={() => goTo("brain")}>
            <span className="font-semibold">{brain.title}</span> <span className="text-muted-foreground">· {brain.sub}</span>
          </Row>
          <Row icon={<Puzzle className="size-4" />} label="Apps" onEdit={() => goTo("apps")}>
            {apps.length || s.customMcp.length ? (
              <span className="flex flex-wrap items-center gap-1.5">
                {apps.map((d) => (
                  <span key={d.id} className="inline-flex items-center gap-1.5 rounded-full bg-muted py-0.5 pr-2.5 pl-0.5 text-xs font-semibold">
                    <BrandTile icon={d.icon} size={20} /> {d.name}
                  </span>
                ))}
                {s.customMcp.map((m) => (
                  <span key={m.url} className="inline-flex items-center gap-1.5 rounded-full bg-muted py-0.5 pr-2.5 pl-0.5 text-xs font-semibold">
                    <BrandTile icon={{ lucide: "Plug", color: "64748B" }} size={20} /> {m.name || new URL(m.url).host}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-muted-foreground">Built-in tools only (memory, reminders, weather, math)</span>
            )}
          </Row>
          <Row icon={<ShieldCheck className="size-4" />} label="Trust" onEdit={() => goTo("trust")}>
            <span className="font-semibold">
              {trust.emoji} {trust.name}
            </span>{" "}
            <span className="text-muted-foreground">· {trust.short}</span>
          </Row>
          <Row icon={<MessageCircle className="size-4" />} label="Talk" onEdit={() => goTo("channels")}>
            <span className="flex flex-wrap gap-1.5">
              {channels.map((c) => (
                <span key={c.kind} className="inline-flex items-center gap-1.5 rounded-full bg-muted py-0.5 pr-2.5 pl-0.5 text-xs font-semibold">
                  <BrandTile icon={channelIcon(c)} size={20} />
                  {c.name}
                  {c.availability === "waitlist" ? <span className="font-normal text-muted-foreground">(waitlist)</span> : null}
                </span>
              ))}
            </span>
          </Row>
          <Row icon={<Clock className="size-4" />} label="Time" onEdit={null}>
            <span className="text-muted-foreground">{timezone.replace(/_/g, " ")} (from your device)</span>
          </Row>
        </dl>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="instructions" className="font-display text-lg font-semibold">
          Anything {name} should know? <span className="text-sm font-normal text-muted-foreground">Optional</span>
        </label>
        <Textarea
          id="instructions"
          value={s.instructions}
          maxLength={4000}
          onChange={(e) => onInstructions(e.target.value)}
          placeholder={`e.g. Keep replies short. My manager is Sam — flag anything from him. I'm vegetarian. Never book anything before 9am.`}
          className="min-h-28"
        />
      </div>

      {adjustments.length ? (
        <div className="rounded-3xl border border-accent/60 bg-accent/15 p-4 text-sm">
          <div className="mb-1.5 flex items-center gap-2 font-semibold">
            <Sparkles className="size-4" /> On the {PLANS[plan].name} plan
          </div>
          <ul className="flex flex-col gap-1 text-foreground/80">
            {adjustments.map((x) => (
              <li key={x}>• {x}</li>
            ))}
          </ul>
          <Link href="/pricing" target="_blank" className="mt-2 inline-block font-semibold text-primary hover:underline">
            See plans
          </Link>
        </div>
      ) : null}

      {atBotLimit ? (
        <div className="rounded-3xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          Your {PLANS[plan].name} plan includes {PLANS[plan].limits.bots} bot{PLANS[plan].limits.bots === 1 ? "" : "s"}, and you&apos;ve made {PLANS[plan].limits.bots === 1 ? "it" : "them all"}.{" "}
          <Link href="/app/billing" className="font-semibold underline">
            Upgrade to make another
          </Link>
          .
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-3xl border border-border bg-background-2/60 p-4 sm:p-5">
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={s.ageConfirmed} onChange={(e) => onAge(e.target.checked)} className="peer sr-only" />
          <span
            className={cn(
              "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border-2 transition peer-focus-visible:ring-4 peer-focus-visible:ring-primary/25",
              s.ageConfirmed ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card",
            )}
            aria-hidden
          >
            {s.ageConfirmed ? <Check className="size-4" strokeWidth={3} /> : null}
          </span>
          <span className="text-sm">
            <span className="font-semibold">I&apos;m 18 or older</span> and I agree to the{" "}
            <Link href="/legal/terms" target="_blank" className="text-primary underline-offset-2 hover:underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/legal/privacy" target="_blank" className="text-primary underline-offset-2 hover:underline">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        <p className="flex items-start gap-3 text-sm text-muted-foreground">
          <Bot className="mt-0.5 size-5 shrink-0 text-primary" />
          <span>
            {name} will always say it&apos;s an AI assistant — it never pretends to be a person, and messages it sends to other people say they&apos;re from your AI assistant.
          </span>
        </p>
        <p className="flex items-start gap-3 text-sm text-muted-foreground">
          <UserRound className="mt-0.5 size-5 shrink-0 text-primary" />
          <span>You&apos;re in charge: STOP pauses it instantly from any channel, and every action it takes gets a receipt.</span>
        </p>
      </div>
    </div>
  );
}

function Row({ icon, label, children, onEdit }: { icon: React.ReactNode; label: string; children: React.ReactNode; onEdit: (() => void) | null }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 sm:px-5">
      <dt className="flex w-20 shrink-0 items-center gap-1.5 pt-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {icon}
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-sm">{children}</dd>
      {onEdit ? (
        <button type="button" onClick={onEdit} className="text-sm font-semibold text-primary hover:underline">
          Change
        </button>
      ) : null}
    </div>
  );
}
