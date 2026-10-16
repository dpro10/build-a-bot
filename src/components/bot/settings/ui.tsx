"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { toast } from "@/components/ui/toaster";
import { ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";

/** One settings section: a card with an icon, a title, a line of help, and (optionally) its own save bar. */
export function SettingsSection({
  id,
  icon: Icon,
  title,
  description,
  tone = "primary",
  footer,
  children,
  className,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  tone?: "primary" | "danger";
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-6", className)} data-settings-section>
      <div
        className={cn(
          "rounded-3xl border bg-card text-card-foreground shadow-soft",
          tone === "danger" ? "border-danger/30" : "border-border",
        )}
      >
        <div className="flex items-start gap-3.5 p-5 pb-4 sm:p-6 sm:pb-5">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-2xl",
              tone === "danger" ? "bg-danger-soft text-danger" : "bg-primary-soft text-primary",
            )}
          >
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 id={`${id}-title`} className="font-display text-lg leading-tight font-semibold">
              {title}
            </h3>
            {description ? <div className="mt-1 text-sm text-muted-foreground">{description}</div> : null}
          </div>
        </div>
        <div className="px-5 pb-5 sm:px-6 sm:pb-6">{children}</div>
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3.5 sm:px-6">{footer}</div> : null}
      </div>
    </section>
  );
}

export function FieldGroup({ label, hint, htmlFor, children, className }: { label: React.ReactNode; hint?: React.ReactNode; htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-sm font-semibold">
          {label}
        </label>
      ) : (
        <div className="text-sm font-semibold">{label}</div>
      )}
      {children}
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/** Toast an API error; when it's for want of credit, offer the way to add some. */
export function useApiErrorToast() {
  const router = useRouter();
  return React.useCallback(
    (err: unknown, fallback = "Couldn't save that. Try again.") => {
      const message = err instanceof Error && err.message ? err.message : fallback;
      if (err instanceof ApiError && err.code === "no_credit") {
        toast.error(message, { action: { label: "Add credit", onClick: () => router.push("/app/billing") } });
      } else toast.error(message);
    },
    [router],
  );
}

export function UnsavedDot({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="mr-auto inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span className="size-1.5 rounded-full bg-warning" aria-hidden /> Unsaved changes
    </span>
  );
}
