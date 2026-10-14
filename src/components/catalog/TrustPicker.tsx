"use client";
/**
 * "How much should it do on its own?" — the four trust levels as a dial, with a
 * plain-language preview built from the apps the bot actually has.
 * The policy engine enforces all of this in code; this only explains it.
 */
import * as React from "react";
import { Check, Hand, ShieldCheck, X } from "lucide-react";
import type { ConnectorDef } from "@/lib/connectors";
import { HARD_LIMITS, TRUST, TRUST_LEVELS, type TrustLevel } from "@/lib/trust";
import { Badge } from "@/components/ui/badge";
import { isBuiltin } from "./connector-meta";
import { cn } from "@/lib/utils";

function examples(apps: ConnectorDef[], pick: (c: ConnectorDef["capabilities"][number]) => boolean, max = 3): string[] {
  // Built-in tools read better without an app name ("Send email from its address").
  const queues = apps.map((d) => d.capabilities.filter(pick).map((c) => (isBuiltin(d) ? c.label : `${c.label} in ${d.name}`)));
  const out: string[] = [];
  for (let i = 0; out.length < max && queues.some((q) => q.length > i); i++) {
    for (const q of queues) if (q[i] && out.length < max) out.push(q[i]);
  }
  return out;
}

export function trustPreview(level: TrustLevel, apps: ConnectorDef[]) {
  const t = TRUST[level];
  const reads = examples(apps, (c) => c.effect === "read", 2);
  const routine = examples(apps, (c) => (c.effect === "write" || c.effect === "send") && c.risk !== "high", 3);
  const risky = examples(apps, (c) => c.effect === "delete" || c.risk === "high" || c.effect === "admin", 3);
  const actions = examples(apps, (c) => c.effect !== "read" && c.effect !== "spend", 4);
  switch (level) {
    case "look":
      return { alone: [...t.can.slice(0, 2), ...reads], asks: [] as string[], never: t.never };
    case "ask":
      return { alone: [t.can[0], t.can[1], ...reads.slice(0, 1)], asks: actions.length ? actions.map((a) => `${a}`) : t.asks, never: t.never };
    case "trusted":
      return { alone: routine.length ? [...routine, "Reply to people you've approved"] : t.can.slice(1), asks: [...t.asks.slice(0, 2), ...risky].slice(0, 4), never: t.never };
    case "full":
      return { alone: actions.length ? [...actions, "Reach out to new people for you"] : t.can.slice(1), asks: t.asks, never: t.never };
  }
}

export function TrustPicker({
  value,
  onChange,
  apps = [],
  botName = "Your bot",
  planBadges = {},
  className,
}: {
  value: TrustLevel;
  onChange: (level: TrustLevel) => void;
  /** Apps the bot has; makes the preview concrete ("Send email in Gmail"). */
  apps?: ConnectorDef[];
  botName?: string;
  /** Levels the owner's plan doesn't include yet, e.g. { full: "Plus" }. */
  planBadges?: Partial<Record<TrustLevel, string>>;
  className?: string;
}) {
  const index = TRUST_LEVELS.indexOf(value);
  const preview = trustPreview(value, apps);
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const next = Math.min(TRUST_LEVELS.length - 1, Math.max(0, index + dir));
    onChange(TRUST_LEVELS[next]);
    refs.current[next]?.focus();
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div role="radiogroup" aria-label="How much it can do on its own" className="grid grid-cols-2 gap-2 sm:grid-cols-4" onKeyDown={onKey}>
        {TRUST_LEVELS.map((id, i) => {
          const t = TRUST[id];
          const active = id === value;
          return (
            <button
              key={id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(id)}
              className={cn(
                "relative flex flex-col items-start gap-1 rounded-2xl border bg-card p-3.5 text-left transition",
                active ? "border-primary shadow-glow ring-2 ring-primary/25" : "border-border hover:border-foreground/25",
                id === "full" && active && "bg-gradient-to-br from-primary-soft to-card",
              )}
            >
              <span className="flex w-full items-center justify-between">
                <span className="text-2xl leading-none" aria-hidden>
                  {t.emoji}
                </span>
                {planBadges[id] ? <Badge tone="accent">{planBadges[id]}</Badge> : active ? <Check className="size-4 text-primary" strokeWidth={3} /> : null}
              </span>
              <span className="mt-1 font-display text-[15px] font-semibold leading-tight">{t.name}</span>
              <span className="text-xs leading-snug text-muted-foreground">{t.short}</span>
            </button>
          );
        })}
      </div>

      {/* Autonomy meter */}
      <div className="flex items-center gap-3 px-1" aria-hidden>
        <span className="text-xs font-medium text-muted-foreground">Asks more</span>
        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sky-500 via-primary to-coral-500 transition-[width] duration-500"
            style={{ width: `${((index + 1) / TRUST_LEVELS.length) * 100}%` }}
          />
        </div>
        <span className="text-xs font-medium text-muted-foreground">Does more</span>
      </div>

      <div key={value} className="grid animate-fade-up gap-3 rounded-3xl border border-border bg-background-2/60 p-4 sm:grid-cols-3 sm:p-5">
        <PreviewColumn title={`${botName} does on its own`} icon={<Check className="size-3.5" strokeWidth={3} />} tone="success" items={preview.alone} />
        <PreviewColumn title="Asks you first" icon={<Hand className="size-3.5" />} tone="warning" items={preview.asks.length ? preview.asks : ["Nothing — it only reads and suggests"]} muted={!preview.asks.length} />
        <PreviewColumn title="Never" icon={<X className="size-3.5" strokeWidth={3} />} tone="danger" items={preview.never} />
      </div>

      <div className="rounded-3xl border border-border bg-card p-4 sm:p-5">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-success" /> Always on, at every level — enforced in code
        </div>
        <ul className="grid gap-x-6 gap-y-1.5 text-sm text-muted-foreground sm:grid-cols-2">
          {HARD_LIMITS.map((l) => (
            <li key={l} className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
              <span>{l}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PreviewColumn({ title, icon, tone, items, muted }: { title: string; icon: React.ReactNode; tone: "success" | "warning" | "danger"; items: string[]; muted?: boolean }) {
  const toneClass = { success: "bg-success-soft text-success", warning: "bg-warning-soft text-warning", danger: "bg-danger-soft text-danger" }[tone];
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className={cn("flex size-6 items-center justify-center rounded-full", toneClass)}>{icon}</span>
        {title}
      </div>
      <ul className={cn("flex flex-col gap-1.5 text-sm", muted ? "text-muted-foreground" : "text-foreground/85")}>
        {items.map((it) => (
          <li key={it} className="leading-snug">
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
