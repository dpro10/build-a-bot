"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, CircleCheck, CreditCard, Info, PartyPopper, X, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import { api, type ApiError } from "@/lib/client/api";
import { MAX_YEARLY_SAVING, PLANS, PLAN_ORDER, type PlanId } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import { PlanWaitlist } from "@/components/marketing/pricing/PlanWaitlist";

/** stripe = real checkout; demo = instant switch (no Stripe, demo mode); off = neither (paid plans are coming soon). */
export type BillingMode = "stripe" | "demo" | "off";

async function openPortal() {
  const { url } = await api<{ url: string }>("/api/billing/portal", { method: "POST" });
  window.location.assign(url);
}

export function ManageBillingButton({ className }: { className?: string }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      variant="outline"
      className={className}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await openPortal();
        } catch (err) {
          toast.error((err as Error).message);
          setBusy(false);
        }
      }}
    >
      {!busy ? <CreditCard /> : null} Manage billing
    </Button>
  );
}

export function PlanPicker({
  current,
  mode,
  anonymous,
  hasSubscription,
  email,
}: {
  current: PlanId;
  mode: BillingMode;
  anonymous: boolean;
  hasSubscription: boolean;
  /** Their confirmed email, so joining a waitlist ("off" mode) takes one tap. */
  email: string | null;
}) {
  const router = useRouter();
  const [period, setPeriod] = React.useState<"monthly" | "yearly">("monthly");
  const [busy, setBusy] = React.useState<PlanId | null>(null);
  const yearly = period === "yearly";

  const run = async (target: PlanId, fn: () => Promise<void>) => {
    setBusy(target);
    try {
      await fn();
    } catch (err) {
      const e = err as ApiError;
      if (e.data?.needsEmail) {
        toast.error("Save your account with your email first.", {
          action: { label: "Add email", onClick: () => router.push("/login?next=/app/billing") },
        });
      } else {
        toast.error(e.message || "Couldn't change your plan. Try again.");
      }
      setBusy(null);
    }
  };

  const demoSwitch = (target: PlanId) =>
    run(target, async () => {
      await api("/api/billing/demo", { body: { plan: target } });
      toast.success(target === "free" ? "You're on Free now." : `You're on ${PLANS[target].name} now. Enjoy!`, {
        description: "Demo mode: switched instantly, nothing was charged.",
      });
      router.refresh();
      setBusy(null);
    });

  const checkout = (target: PlanId) =>
    run(target, async () => {
      const { url } = await api<{ url: string }>("/api/billing/checkout", { body: { plan: target, interval: period } });
      window.location.assign(url);
    });

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          aria-label="Billing period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: "monthly", label: "Monthly" },
            {
              value: "yearly",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  Yearly <span className="rounded-full bg-success-soft px-1.5 py-px text-[11px] font-bold text-success">Save up to {MAX_YEARLY_SAVING}%</span>
                </span>
              ),
            },
          ]}
        />
        {mode === "demo" ? (
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-warning">
            <Zap className="size-3.5" aria-hidden /> Demo mode: switching is instant and nothing is charged.
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {PLAN_ORDER.map((id) => {
          const plan = PLANS[id];
          const isCurrent = id === current;
          const popular = id === "plus";
          const up = PLAN_ORDER.indexOf(id) > PLAN_ORDER.indexOf(current);
          const price = yearly ? plan.priceYearly : plan.priceMonthly;
          const paid = plan.priceMonthly > 0;
          // No Stripe outside demo mode: paid plans can't be bought yet.
          const soon = mode === "off" && paid && !isCurrent;

          let button: React.ReactNode;
          if (isCurrent) {
            button = (
              <Button variant="outline" className="w-full" disabled>
                <CircleCheck /> Your current plan
              </Button>
            );
          } else if (mode === "demo") {
            button = (
              <Button variant={up ? "primary" : "outline"} className="w-full" loading={busy === id} disabled={busy !== null} onClick={() => demoSwitch(id)}>
                {busy !== id ? <Zap /> : null} Switch to {plan.name}
              </Button>
            );
          } else if (mode === "stripe" && (hasSubscription || id === "free")) {
            button = (
              <Button variant={up ? "primary" : "outline"} className="w-full" loading={busy === id} disabled={busy !== null} onClick={() => run(id, openPortal)}>
                {id === "free" ? "Downgrade in billing portal" : `Switch to ${plan.name}`}
              </Button>
            );
          } else if (mode === "stripe" && anonymous) {
            button = (
              <Button asChild variant={popular ? "primary" : "secondary"} className="w-full">
                <Link href="/login?next=/app/billing">Add your email to upgrade</Link>
              </Button>
            );
          } else if (mode === "stripe") {
            button = (
              <Button variant={popular ? "primary" : "secondary"} className="w-full" loading={busy === id} disabled={busy !== null} onClick={() => checkout(id)}>
                Upgrade to {plan.name}
              </Button>
            );
          } else if (soon && id !== "free") {
            button = <PlanWaitlist plan={id} email={email} size="md" />;
          } else {
            // Nothing to switch to without payments (a paid plan given by hand stays until we change it).
            button = null;
          }

          return (
            <div
              key={id}
              className={cn(
                "relative flex flex-col rounded-3xl border bg-card p-5 shadow-soft sm:p-6",
                popular ? "border-primary/50 ring-4 ring-primary/10" : "border-border",
                isCurrent && !popular && "border-success/50",
              )}
            >
              {popular && !soon ? (
                <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground shadow-glow">Most popular</span>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-xl font-bold">{plan.name}</h3>
                {isCurrent ? (
                  <Badge tone="success">
                    <Check /> Your plan
                  </Badge>
                ) : soon ? (
                  <Badge tone="neutral">Coming soon</Badge>
                ) : null}
              </div>
              <p className="mt-1 min-h-10 text-sm text-muted-foreground">{plan.tagline}</p>
              <div className="mt-4 flex items-end gap-1.5">
                <span className="font-display text-4xl font-bold tabular-nums">${price}</span>
                <span className="pb-1.5 text-sm text-muted-foreground">{paid ? "/ month" : "forever"}</span>
                {yearly && paid ? <span className="pb-1.5 text-sm text-muted-foreground line-through decoration-1">${plan.priceMonthly}</span> : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {!paid ? "No card needed." : yearly ? `Billed yearly: $${plan.priceYearly * 12} a year.` : "Billed monthly. Cancel anytime."}
              </p>
              <ul className="mt-5 flex flex-1 flex-col gap-2.5 text-sm">
                {plan.highlights.map((h) => (
                  <li key={h} className="flex gap-2.5">
                    <Check className={cn("mt-0.5 size-4 shrink-0", popular ? "text-primary" : "text-success")} aria-hidden />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
              {button ? <div className="mt-6">{button}</div> : null}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Prices in US dollars. * Messages on your own API key have a fair-use limit (
        {PLAN_ORDER.map((id) => PLANS[id].limits.byoMessages.toLocaleString("en-US")).join(" / ")} a month); subscription brains on the Bridge don&apos;t count at all.
      </p>
    </div>
  );
}

/** After Stripe Checkout: ?checkout=success|cancel (also Stripe's own ?success=1 / ?canceled=1). */
export function CheckoutNotice({ status, planName }: { status: "success" | "cancel" | null; planName: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [shown, setShown] = React.useState(status);

  React.useEffect(() => {
    if (!status) return;
    // Clean the URL so a reload doesn't show this again.
    router.replace(pathname, { scroll: false });
    if (status !== "success") return;
    // The plan flips when Stripe's webhook lands; check back shortly.
    const timers = [2500, 7000].map((ms) => setTimeout(() => router.refresh(), ms));
    return () => timers.forEach(clearTimeout);
  }, [status, router, pathname]);

  if (!shown) return null;
  const success = shown === "success";
  return (
    <div
      role="status"
      className={cn(
        "mb-6 flex animate-fade-up items-start gap-3 rounded-3xl border p-4 sm:p-5",
        success ? "border-success/40 bg-success-soft" : "border-border bg-muted/60",
      )}
    >
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-2xl", success ? "bg-success text-success-foreground" : "bg-card text-muted-foreground")}>
        {success ? <PartyPopper className="size-5" aria-hidden /> : <Info className="size-5" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{success ? "You're all set — thank you!" : "Checkout canceled"}</div>
        <p className="text-sm text-foreground/80">
          {success
            ? "Your new plan turns on as soon as the payment is confirmed. It usually takes a few seconds to show here."
            : `No charge was made. You're still on ${planName}.`}
        </p>
      </div>
      <button type="button" onClick={() => setShown(null)} className="rounded-full p-1.5 text-muted-foreground transition hover:bg-card hover:text-foreground" aria-label="Dismiss">
        <X className="size-4" />
      </button>
    </div>
  );
}
