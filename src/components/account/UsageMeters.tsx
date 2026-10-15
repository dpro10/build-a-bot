/**
 * This month's usage against the plan's limits. Server-component safe.
 */
import * as React from "react";
import { AudioLines, Bot, KeyRound, MessageCircle, MessageSquareText, Phone, Search } from "lucide-react";
import { Progress } from "@/components/ui/misc";
import { PAID_PLANS_SOON, type Plan } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

export type UsageNumbers = {
  includedMessages: number;
  byoMessages: number;
  searches: number;
  voiceMinutes: number;
  smsSegments: number;
  meetingMinutes: number;
  bots: number;
};

type MeterDef = { key: keyof UsageNumbers; label: string; hint: string; locked: string; icon: React.ReactNode };

const METERS: MeterDef[] = [
  {
    key: "includedMessages",
    label: "Messages on included brains",
    hint: "Answers from the open models we run for you.",
    locked: "Included brains aren't on this plan.",
    icon: <MessageCircle className="size-4" />,
  },
  {
    key: "byoMessages",
    label: "Messages on your own key",
    hint: "Fair use. Your AI provider bills you for these.",
    locked: "Not on this plan.",
    icon: <KeyRound className="size-4" />,
  },
  {
    key: "searches",
    label: "Web searches",
    hint: "Each search your bots run on the web.",
    locked: "Web search isn't on this plan.",
    icon: <Search className="size-4" />,
  },
  {
    key: "voiceMinutes",
    label: "Call minutes",
    hint: "Phone calls with your bots, added up across the month.",
    locked: "Phone calls start on Plus.",
    icon: <Phone className="size-4" />,
  },
  {
    key: "smsSegments",
    label: "Texts",
    hint: "Counted in segments of about 160 characters.",
    locked: "Texting your bot starts on Plus.",
    icon: <MessageSquareText className="size-4" />,
  },
  {
    key: "meetingMinutes",
    label: "Meeting notes",
    hint: "Minutes of calls your bots took notes in.",
    locked: "Meeting notes aren't on this plan.",
    icon: <AudioLines className="size-4" />,
  },
  {
    key: "bots",
    label: "Bots",
    hint: "Bots you have right now.",
    locked: "",
    icon: <Bot className="size-4" />,
  },
];

const fmt = (n: number) => n.toLocaleString("en-US");

export function limitFor(plan: Plan, key: keyof UsageNumbers): number {
  return key === "bots" ? plan.limits.bots : plan.limits[key];
}

export function meterTone(used: number, limit: number): "primary" | "warning" | "danger" {
  if (limit <= 0) return "primary";
  const pct = (used / limit) * 100;
  return pct >= 100 ? "danger" : pct >= 80 ? "warning" : "primary";
}

export function UsageMeters({
  plan,
  used,
  resetLabel,
  paidPlans,
  callsAndTexts,
  className,
}: {
  plan: Plan;
  used: UsageNumbers;
  resetLabel: string;
  /** Paid plans can be bought here (otherwise they're coming soon). */
  paidPlans: boolean;
  /** Calls and texts work on this server (Twilio, or demo mode); otherwise their meters are left out. */
  callsAndTexts: boolean;
  className?: string;
}) {
  const meters = callsAndTexts ? METERS : METERS.filter((m) => m.key !== "voiceMinutes" && m.key !== "smsSegments");
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {meters.map((m) => {
        const limit = limitFor(plan, m.key);
        const value = used[m.key];
        // A full set of bots isn't "running out" — keep that one calm.
        const tone = m.key === "bots" ? "primary" : meterTone(value, limit);
        const left = Math.max(0, limit - value);
        const status =
          limit <= 0
            ? m.locked
            : m.key === "bots"
              ? value >= limit
                ? `${plan.name} includes ${fmt(limit)} bot${limit === 1 ? "" : "s"}. ${paidPlans ? "Upgrade to make more." : PAID_PLANS_SOON}`
                : `Room for ${fmt(left)} more on ${plan.name}.`
              : tone === "danger"
                ? `You've used them all. Resets ${resetLabel}.`
                : tone === "warning"
                  ? `Almost out: ${fmt(left)} left until ${resetLabel}.`
                  : m.hint;
        return (
          <div key={m.key} className="relative flex flex-col rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-xl", limit > 0 ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground")}>
                {m.icon}
              </span>
              <span className="min-w-0">{m.label}</span>
            </div>
            {limit > 0 ? (
              <div className="mt-3 flex items-baseline gap-1.5 tabular-nums" aria-hidden>
                <span className={cn("font-display text-2xl font-bold", tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-foreground")}>
                  {fmt(value)}
                </span>
                <span className="text-sm text-muted-foreground">of {fmt(limit)}</span>
              </div>
            ) : (
              <div className="mt-3 font-display text-2xl font-bold text-muted-foreground/70" aria-hidden>
                —
              </div>
            )}
            {limit > 0 ? (
              <Progress value={(value / limit) * 100} tone={tone} className="mt-3" />
            ) : (
              <div className="mt-3 h-2 rounded-full bg-muted" aria-hidden />
            )}
            <p className={cn("mt-2 text-xs", tone === "danger" ? "font-medium text-danger" : tone === "warning" ? "font-medium text-warning" : "text-muted-foreground")}>
              <span className="sr-only">
                {m.label}: {fmt(value)} of {fmt(limit)}.{" "}
              </span>
              {status}
            </p>
          </div>
        );
      })}
    </div>
  );
}
