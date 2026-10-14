"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { PLANS, PLAN_ORDER, type Plan, type PlanId } from "@/lib/billing/plans";
import { TRUST } from "@/lib/trust";
import { cn } from "@/lib/utils";
import { CheckDot } from "../ui";

export type Interval = "monthly" | "yearly";

const n = (x: number) => x.toLocaleString("en-US");

/** Card bullets, built from the plan's real limits so they never drift from what's enforced. */
export function planBullets(p: Plan): string[] {
  const L = p.limits;
  const out = [`${n(L.bots)} bot${L.bots === 1 ? "" : "s"}`, `${n(L.includedMessages)} messages a month on included models`];
  if (p.includedModels.includes("smart")) out.push("Our smartest open models");
  else if (p.includedModels.includes("balanced")) out.push("Bigger, smarter open models");
  out.push(L.voiceMinutes || L.smsSegments ? `${n(L.voiceMinutes)} call minutes and ${n(L.smsSegments)} texts` : "Web, email, Telegram, Discord and Slack");
  out.push(p.trust.includes("full") ? `${TRUST.full.name} mode` : `Trust levels up to ${TRUST.trusted.name}`);
  out.push(`${n(L.connectors)} apps per bot`);
  out.push(`${n(L.byoMessages)} messages a month on your own key or plan`);
  out.push(`${n(L.routines)} routines, like a morning brief`);
  out.push(`${n(L.searches)} web searches a month`);
  return out;
}

/** Whole-percent saving of yearly vs monthly billing, rounded down so it's never overstated. */
export function yearlySaving(p: Plan): number {
  if (!p.priceMonthly) return 0;
  return Math.floor(((p.priceMonthly - p.priceYearly) / p.priceMonthly) * 100);
}

const MAX_SAVING = Math.max(...PLAN_ORDER.map((id) => yearlySaving(PLANS[id])));

export function PlanCards({
  signedIn = false,
  currentPlan,
  teaser = false,
  defaultInterval = "monthly",
}: {
  signedIn?: boolean;
  currentPlan?: string;
  teaser?: boolean;
  defaultInterval?: Interval;
}) {
  const [interval, setBilling] = React.useState<Interval>(defaultInterval);
  return (
    <div className="flex flex-col items-center">
      <Segmented<Interval>
        aria-label="Billing period"
        value={interval}
        onChange={setBilling}
        options={[
          { value: "monthly", label: "Monthly" },
          {
            value: "yearly",
            label: (
              <span className="inline-flex items-center gap-1.5">
                Yearly <span className="rounded-full bg-success-soft px-1.5 py-px text-[11px] font-bold text-success">save up to {MAX_SAVING}%</span>
              </span>
            ),
          },
        ]}
      />
      <div className="mt-8 grid w-full gap-5 lg:grid-cols-3">
        {PLAN_ORDER.map((id) => (
          <PlanCard key={id} plan={PLANS[id]} interval={interval} signedIn={signedIn} current={currentPlan === id} teaser={teaser} />
        ))}
      </div>
    </div>
  );
}

function PlanCard({ plan, interval, signedIn, current, teaser }: { plan: Plan; interval: Interval; signedIn: boolean; current: boolean; teaser: boolean }) {
  const featured = plan.id === "plus";
  const paid = plan.priceMonthly > 0;
  const price = interval === "yearly" ? plan.priceYearly : plan.priceMonthly;
  const bullets = planBullets(plan);
  const shown = teaser ? bullets.slice(0, 5) : bullets;

  const cta = ctaFor(plan.id, signedIn, current);

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-3xl border bg-card p-6 shadow-soft sm:p-7",
        featured ? "border-primary/50 shadow-lift ring-4 ring-primary/10" : "border-border",
      )}
    >
      {featured ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-28 rounded-t-3xl"
          style={{ background: "linear-gradient(180deg, color-mix(in oklab, var(--primary) 12%, transparent), transparent)" }}
        />
      ) : null}
      <div className="relative flex items-center justify-between gap-2">
        <h3 className="font-display text-2xl font-bold tracking-tight">{plan.name}</h3>
        {current ? (
          <span className="rounded-full bg-success-soft px-2.5 py-1 text-xs font-bold text-success">Your plan</span>
        ) : featured ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground">
            <Sparkles className="size-3" aria-hidden="true" /> Recommended
          </span>
        ) : null}
      </div>
      <p className="relative mt-1 min-h-10 text-sm text-muted-foreground">{plan.tagline}</p>

      <div className="relative mt-5 flex items-end gap-1.5">
        <span className="font-display text-5xl leading-none font-bold tracking-tight tabular-nums">${price}</span>
        <span className="pb-1 text-sm text-muted-foreground">{paid ? "/ month" : "forever"}</span>
      </div>
      <p className="relative mt-2 min-h-5 text-xs text-muted-foreground">
        {paid
          ? interval === "yearly"
            ? `Billed $${plan.priceYearly * 12} a year. You save $${(plan.priceMonthly - plan.priceYearly) * 12}.`
            : `Or $${plan.priceYearly}/month billed yearly.`
          : "No card needed."}
      </p>

      <Button asChild size="lg" variant={featured ? "primary" : "outline"} className="relative mt-5 w-full">
        <Link href={cta.href}>
          {cta.label} <ArrowRight />
        </Link>
      </Button>

      <ul className="relative mt-6 flex flex-col gap-2.5 border-t border-border pt-6">
        {shown.map((b) => (
          <li key={b} className="flex gap-2.5 text-[15px] leading-snug">
            <CheckDot tone={featured ? "primary" : "success"} />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ctaFor(id: PlanId, signedIn: boolean, current: boolean): { href: string; label: string } {
  if (id === "free") return signedIn ? { href: "/app", label: current ? "Go to your bots" : "Your bots" } : { href: "/build", label: "Start free" };
  const name = PLANS[id].name;
  if (!signedIn) return { href: "/build", label: `Start with ${name}` };
  return current ? { href: "/app/billing", label: "Manage plan" } : { href: "/app/billing", label: `Upgrade to ${name}` };
}
