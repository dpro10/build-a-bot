/**
 * Layout pieces shared by the public pages. Server-component safe.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export function Container({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)} {...props} />;
}

export function Section({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn("relative scroll-mt-20 py-20 sm:py-28", className)} {...props} />;
}

export function Eyebrow({ children, icon, className }: { children: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary-soft px-3 py-1 text-xs font-bold tracking-[0.08em] text-primary uppercase [&_svg]:size-3.5",
        className,
      )}
    >
      {icon}
      {children}
    </div>
  );
}

export function SectionHeader({
  eyebrow,
  icon,
  title,
  children,
  align = "center",
  className,
  id,
}: {
  eyebrow?: string;
  icon?: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
  align?: "center" | "left";
  className?: string;
  id?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4", align === "center" ? "mx-auto max-w-3xl items-center text-center" : "max-w-2xl items-start", className)}>
      {eyebrow ? <Eyebrow icon={icon}>{eyebrow}</Eyebrow> : null}
      <h2 id={id} className="font-display text-[2.15rem] leading-[1.05] font-bold tracking-[-0.03em] text-balance sm:text-5xl">
        {title}
      </h2>
      {children ? <p className="text-lg text-pretty text-muted-foreground sm:text-xl sm:leading-relaxed">{children}</p> : null}
    </div>
  );
}

/** Small "✓ text" list. */
export function CheckList({ items, className, tone = "success" }: { items: React.ReactNode[]; className?: string; tone?: "success" | "primary" }) {
  return (
    <ul className={cn("flex flex-col gap-2.5", className)}>
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-[15px] leading-snug">
          <CheckDot tone={tone} />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function CheckDot({ tone = "success", className }: { tone?: "success" | "primary" | "muted"; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-[3px] inline-flex size-[18px] shrink-0 items-center justify-center rounded-full",
        tone === "success" && "bg-success-soft text-success",
        tone === "primary" && "bg-primary-soft text-primary",
        tone === "muted" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 8.5l3 3 6-7" />
      </svg>
    </span>
  );
}
