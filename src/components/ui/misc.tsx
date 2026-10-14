import * as React from "react";
import { cn } from "@/lib/utils";

export function Separator({ className }: { className?: string }) {
  return <div role="separator" className={cn("h-px w-full bg-border", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-muted", className)} />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
      {children}
    </kbd>
  );
}

export function Progress({ value, className, tone = "primary" }: { value: number; className?: string; tone?: "primary" | "warning" | "danger" | "success" }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = { primary: "bg-primary", warning: "bg-warning", danger: "bg-danger", success: "bg-success" }[tone];
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border px-6 py-12 text-center", className)}>
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <div className="font-display text-lg font-semibold">{title}</div>
      {children ? <div className="max-w-sm text-sm text-muted-foreground">{children}</div> : null}
      {action}
    </div>
  );
}

export function SectionTitle({ eyebrow, title, children, className }: { eyebrow?: string; title: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {eyebrow ? <div className="text-xs font-bold uppercase tracking-[0.14em] text-primary">{eyebrow}</div> : null}
      <h2 className="font-display text-3xl font-bold leading-[1.1] sm:text-4xl">{title}</h2>
      {children ? <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">{children}</p> : null}
    </div>
  );
}
