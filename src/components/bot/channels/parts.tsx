"use client";
import * as React from "react";
import { Check, CircleCheck, CircleDashed, Clock, FlaskConical, Hourglass, PowerOff, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ChannelStatus } from "./model";

const STATUS: Record<ChannelStatus | "simulated", { label: string; tone: "success" | "primary" | "warning" | "danger" | "neutral"; icon: React.ComponentType<{ className?: string }> }> = {
  active: { label: "Active", tone: "success", icon: CircleCheck },
  simulated: { label: "Simulated", tone: "primary", icon: FlaskConical },
  needs_setup: { label: "Needs setup", tone: "warning", icon: CircleDashed },
  pending: { label: "Almost done", tone: "warning", icon: Hourglass },
  disabled: { label: "Off", tone: "neutral", icon: PowerOff },
  error: { label: "Error", tone: "danger", icon: TriangleAlert },
  waitlist: { label: "Waitlist", tone: "neutral", icon: Clock },
};

export function ChannelStatusPill({ status, simulated }: { status: ChannelStatus; simulated?: boolean }) {
  const key = status === "active" && simulated ? "simulated" : status;
  const s = STATUS[key];
  const Icon = s.icon;
  const pill = (
    <Badge tone={s.tone} className="gap-1">
      <Icon className="size-3" aria-hidden />
      {s.label}
    </Badge>
  );
  if (key !== "simulated") return pill;
  return (
    <Tooltip content="On in demo mode: it works here, but nothing is really sent.">
      <span tabIndex={0} className="inline-flex rounded-full">
        {pill}
        <span className="sr-only"> (on in demo mode; nothing is really sent)</span>
      </span>
    </Tooltip>
  );
}

export type StepState = "done" | "current" | "upcoming";

export function Steps({ children, className }: { children: React.ReactNode; className?: string }) {
  return <ol className={cn("flex flex-col", className)}>{children}</ol>;
}

/** One numbered mini-step with a rail connecting it to the next. */
export function Step({
  n,
  state,
  title,
  hint,
  last,
  children,
}: {
  n: number;
  state: StepState;
  title: React.ReactNode;
  /** Shown under the title (always). */
  hint?: React.ReactNode;
  last?: boolean;
  /** Shown only while this step is current. */
  children?: React.ReactNode;
}) {
  return (
    <li className={cn("relative flex gap-3", !last && "pb-5")} aria-current={state === "current" ? "step" : undefined}>
      {!last ? <span className={cn("absolute top-8 bottom-1 left-[13px] w-0.5 rounded-full", state === "done" ? "bg-success/40" : "bg-border")} aria-hidden /> : null}
      <span
        className={cn(
          "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition",
          state === "done" && "bg-success text-success-foreground",
          state === "current" && "bg-primary text-primary-foreground ring-4 ring-primary/15",
          state === "upcoming" && "bg-muted text-muted-foreground",
        )}
      >
        {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : n}
        <span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (now)" : ""}</span>
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className={cn("text-sm font-semibold leading-snug", state === "upcoming" && "text-muted-foreground", state === "done" && "text-foreground/70")}>{title}</div>
        {hint ? <div className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{hint}</div> : null}
        {state === "current" && children ? <div className="mt-2.5 flex flex-col gap-2.5">{children}</div> : null}
      </div>
    </li>
  );
}

/** A quiet one-line demo-mode remark inside a card (the page has the full explanation). */
export function DemoLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
      <FlaskConical className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** Label + value line used in active channel cards. */
export function InfoRow({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4", className)}>
      <div className="w-28 shrink-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** Monospace "chip" for handles, codes and addresses. */
export function Mono({ children, className, big }: { children: React.ReactNode; className?: string; big?: boolean }) {
  return (
    <span className={cn("inline-flex max-w-full items-center truncate rounded-xl bg-muted px-2.5 py-1 font-mono text-foreground", big ? "text-base font-semibold tracking-wide" : "text-sm", className)}>
      {children}
    </span>
  );
}

/** A big, copyable one-time code. */
export function CodeDisplay({ code, label }: { code: string; label?: string }) {
  return (
    <span aria-label={label ?? `Code ${code.split("").join(" ")}`} className="inline-flex items-center gap-1 rounded-2xl bg-primary-soft px-3 py-1.5 font-mono text-lg font-bold tracking-[0.25em] text-primary">
      {code}
    </span>
  );
}

/** QR code for a link, so desktop users can open it on their phone. */
export function LinkQr({ value, size = 132, caption }: { value: string; size?: number; caption?: string }) {
  const [src, setSrc] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    import("qrcode")
      .then((mod) => {
        const QR = (mod as unknown as { default?: typeof mod }).default ?? mod;
        return QR.toDataURL(value, { margin: 1, width: size * 2, color: { dark: "#16151c", light: "#ffffff" } });
      })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value, size]);
  if (!src) return null;
  return (
    <figure className="hidden shrink-0 flex-col items-center gap-1.5 sm:flex">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} width={size} height={size} alt="QR code for the link" className="rounded-xl bg-white p-1.5 shadow-soft ring-1 ring-border" />
      {caption ? <figcaption className="text-[11px] text-muted-foreground">{caption}</figcaption> : null}
    </figure>
  );
}
