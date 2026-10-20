"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CreditCard, Info, Mail, PartyPopper, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { api, type ApiError } from "@/lib/client/api";
import { CARD_FEE, DEMO_CREDIT_CAP_USD, TOP_UPS_USD, formatCents, topUpChargeCents, type TopUpUsd } from "@/lib/billing/prices";
import { cn } from "@/lib/utils";

/** stripe = pay with a card; demo = added instantly, nothing charged; off = adding credit is coming soon. */
export type CreditMode = "stripe" | "demo" | "off";

/** $5, $10 or $20 of credit. With a card, Stripe's fee is added on top, so all of it is yours to use. */
export function AddCredit({ mode, anonymous }: { mode: CreditMode; anonymous: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<TopUpUsd | null>(null);
  const needsEmail = mode === "stripe" && anonymous;

  const add = async (usd: TopUpUsd) => {
    setBusy(usd);
    try {
      if (mode === "demo") {
        await api("/api/billing/demo", { body: { usd } });
        toast.success(`Added $${usd} of credit.`, { description: "Demo mode: nothing was charged." });
        router.refresh();
        setBusy(null);
        return;
      }
      const { url } = await api<{ url: string }>("/api/billing/checkout", { body: { usd } });
      window.location.assign(url);
    } catch (err) {
      const e = err as ApiError;
      if (e.data?.needsEmail) {
        toast.error("Save your account with your email first.", {
          action: { label: "Add email", onClick: () => router.push("/login?next=/app/billing") },
        });
      } else {
        toast.error(e.message || "Couldn't add credit. Try again.");
      }
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        {TOP_UPS_USD.map((usd) => {
          const charge = topUpChargeCents(usd);
          const disabled = mode === "off" || needsEmail || (busy !== null && busy !== usd);
          return (
            <button
              key={usd}
              type="button"
              onClick={() => add(usd)}
              disabled={disabled || busy === usd}
              aria-busy={busy === usd}
              className={cn(
                "group relative flex flex-col items-center rounded-2xl border bg-card px-2 py-3.5 text-center transition sm:py-4",
                "focus-visible:ring-4 focus-visible:ring-primary/25 focus-visible:outline-none",
                disabled ? "cursor-not-allowed border-border opacity-60" : "border-border hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-soft",
                busy === usd && "border-primary ring-4 ring-primary/10",
              )}
            >
              <span className="font-display text-2xl font-bold tabular-nums sm:text-3xl">${usd}</span>
              <span className="mt-0.5 text-[11px] leading-tight text-muted-foreground sm:text-xs">
                {mode === "stripe" ? `${formatCents(charge)} with the card fee` : mode === "demo" ? "free in demo mode" : "coming soon"}
              </span>
              {busy === usd ? (
                <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-card/80" aria-hidden>
                  <span className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </span>
              ) : null}
              <span className="sr-only">{mode === "off" ? "Adding credit is coming soon." : `Add $${usd} of credit.`}</span>
            </button>
          );
        })}
      </div>
      {needsEmail ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-primary-soft px-3.5 py-2.5 text-sm text-primary">
          <span className="inline-flex items-center gap-2 font-medium">
            <Mail className="size-4 shrink-0" aria-hidden /> Add your email first, so your credit is never lost.
          </span>
          <Button asChild size="sm" variant="primary">
            <Link href="/login?next=/app/billing">Add email</Link>
          </Button>
        </div>
      ) : null}
      <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
        {mode === "demo" ? (
          <>
            <Zap className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
            Demo mode: credit is added instantly and nothing is charged (up to ${DEMO_CREDIT_CAP_USD} an account).
          </>
        ) : mode === "off" ? (
          <>
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            Adding credit is coming soon. Until then there&apos;s your starter credit, and a bot on your own AI key is free here.
          </>
        ) : (
          <>
            <CreditCard className="mt-px size-3.5 shrink-0" aria-hidden />
            Paid securely with Stripe. Its card fee ({CARD_FEE.percent}% + {CARD_FEE.fixedCents}¢) is added on top, so every dollar of credit is yours
            to use. Credit never expires.
          </>
        )}
      </p>
    </div>
  );
}

/** After Stripe Checkout: ?checkout=success|cancel. */
export function CheckoutNotice({ status }: { status: "success" | "cancel" | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const [shown, setShown] = React.useState(status);

  React.useEffect(() => {
    if (!status) return;
    // Clean the URL so a reload doesn't show this again.
    router.replace(pathname, { scroll: false });
    if (status !== "success") return;
    // The credit lands when Stripe's webhook does; check back shortly.
    const timers = [2500, 7000, 15000].map((ms) => setTimeout(() => router.refresh(), ms));
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
        <div className="font-semibold">{success ? "Thank you! Your credit is on its way." : "Checkout canceled"}</div>
        <p className="text-sm text-foreground/80">
          {success ? "It shows up here as soon as Stripe confirms the payment, usually within a few seconds." : "No charge was made."}
        </p>
      </div>
      <button type="button" onClick={() => setShown(null)} className="rounded-full p-1.5 text-muted-foreground transition hover:bg-card hover:text-foreground" aria-label="Dismiss">
        <X className="size-4" />
      </button>
    </div>
  );
}
