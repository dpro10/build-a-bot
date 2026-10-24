import * as React from "react";
import { cn } from "@/lib/utils";

/** A titled block on the bot dashboard pages (Apps & channels). */
export function Section({
  id,
  title,
  description,
  action,
  icon,
  className,
  children,
}: {
  id?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={cn("scroll-mt-24 animate-fade-up", className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary [&_svg]:size-[18px]">{icon}</span> : null}
          <div className="min-w-0">
            <h2 id={headingId} className="font-display text-xl font-bold leading-tight">
              {title}
            </h2>
            {description ? <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A soft inline note (demo mode, hints, warnings). */
export function Note({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: "neutral" | "primary" | "warning" | "danger" | "success";
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const toneClass = {
    neutral: "bg-muted/70",
    primary: "bg-primary-soft/70",
    warning: "bg-warning-soft",
    danger: "bg-danger-soft",
    success: "bg-success-soft",
  }[tone];
  const iconClass = {
    neutral: "text-muted-foreground",
    primary: "text-primary",
    warning: "text-warning",
    danger: "text-danger",
    success: "text-success",
  }[tone];
  return (
    <div className={cn("flex items-start gap-2 rounded-2xl px-3 py-2 text-[13px] leading-snug text-foreground/80", toneClass, className)}>
      {icon ? <span className={cn("mt-px shrink-0 [&_svg]:size-4", iconClass)}>{icon}</span> : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
