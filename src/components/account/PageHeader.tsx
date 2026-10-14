import * as React from "react";
import { cn } from "@/lib/utils";

/** Page frame for the account-level pages (same width and rhythm as "Your bots"). */
export function PageContainer({ children, className, narrow }: { children: React.ReactNode; className?: string; narrow?: boolean }) {
  return <div className={cn("mx-auto w-full px-4 pt-6 pb-16 sm:px-8 sm:pt-8", narrow ? "max-w-3xl" : "max-w-5xl", className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-bold">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A section heading inside a page. */
export function SectionHeading({ title, description, actions, id }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="font-display text-xl font-semibold">
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}
