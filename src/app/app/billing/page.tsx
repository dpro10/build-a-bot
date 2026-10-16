import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, Gift, Sparkles, TriangleAlert } from "lucide-react";
import { getDb } from "@/lib/db";
import { isAnonymous, requireUser } from "@/lib/auth/session";
import { creditHistory, getCredit } from "@/lib/billing/credit";
import { about, creditTone, formatCents, formatMicros, perMessageMicros } from "@/lib/billing/prices";
import { demoMode, live } from "@/lib/env";
import { PageContainer, PageHeader, SectionHeading } from "@/components/account/PageHeader";
import { UsageSummary } from "@/components/account/UsageSummary";
import { AddCredit, CheckoutNotice, type CreditMode } from "@/components/account/CreditClient";
import { PriceList, defaultIncludedModel } from "@/components/billing/PriceList";
import { billingFaq } from "@/components/billing/faq";
import { periodLabels, safeTimeZone, usageNumbers } from "@/components/account/billing-shared";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Credit & usage" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const KIND_LABEL: Record<string, string> = {
  topup: "Added with a card",
  demo: "Demo credit (nothing charged)",
  gift: "Credit from Build-a-bot",
  refund: "Refunded",
};

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string | string[] }> }) {
  const user = await requireUser("/app/billing");
  const db = await getDb();
  const [{ used, period }, credit, history, sp] = await Promise.all([usageNumbers(db, user.id), getCredit(db, user.id), creditHistory(db, user.id, 20), searchParams]);
  const labels = periodLabels(period);
  const tz = safeTimeZone(user.timezone);
  const mode: CreditMode = live.stripe ? "stripe" : demoMode ? "demo" : "off";
  const checkoutParam = first(sp.checkout);
  const checkout = checkoutParam === "success" ? "success" : checkoutParam === "cancel" ? "cancel" : null;
  const dflt = defaultIncludedModel();
  const balance = credit.balanceMicros;
  const tone = creditTone(balance);
  const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz });

  const faqs = billingFaq("app");

  return (
    <PageContainer>
      <PageHeader
        title="Credit & usage"
        description="No plans and no subscription. You pay for what your bots use, at cost: what each service charges us, with nothing added."
      />
      <CheckoutNotice status={checkout} />

      <section aria-labelledby="credit-title" className="mb-12 overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
        <div className="grid gap-8 p-5 sm:p-6 lg:grid-cols-[1fr_1.1fr] lg:items-start">
          <div className="min-w-0">
            <h2 id="credit-title" className="text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">
              Credit left
            </h2>
            <div
              id="credit-balance"
              className={cn(
                "mt-1 font-display text-5xl font-bold tracking-tight tabular-nums",
                tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-foreground",
              )}
            >
              {formatMicros(balance)}
            </div>
            {balance > 0 ? (
              <p className="mt-1.5 text-sm text-muted-foreground">
                About {about(balance / Math.max(1, perMessageMicros(dflt)))} messages on {dflt.label}
                {tone === "warning" ? ". Running low." : "."}
              </p>
            ) : (
              <p role="alert" className="mt-2 flex items-start gap-2 rounded-2xl bg-danger-soft px-3 py-2.5 text-sm text-danger">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  You&apos;re out of credit. Bots on included models wait until you add some, or switch one to your own AI in its Settings → Brain (that&apos;s
                  free here).
                </span>
              </p>
            )}
            <dl className="mt-5 grid grid-cols-3 gap-2">
              {[
                { k: "Starter credit", v: formatMicros(credit.starterMicros) },
                { k: "Added", v: formatMicros(credit.addedMicros) },
                { k: "Used", v: formatMicros(credit.spentMicros) },
              ].map((x) => (
                <div key={x.k} className="rounded-2xl bg-background-2/70 px-3 py-2.5">
                  <dt className="text-[11px] font-medium text-muted-foreground">{x.k}</dt>
                  <dd className="font-display text-base font-bold tabular-nums">{x.v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="min-w-0">
            <h3 className="mb-3 font-display text-lg font-semibold">Add credit</h3>
            <AddCredit mode={mode} anonymous={isAnonymous(user)} />
          </div>
        </div>
      </section>

      <section aria-labelledby="month-title" className="mb-12">
        <SectionHeading
          id="month-title"
          title={`${labels.month} so far`}
          description={
            <>
              Spent this month: <strong className="font-semibold text-foreground tabular-nums">{formatMicros(used.costMicros)}</strong>. The counts start over on{" "}
              {labels.reset}; credit carries over.
            </>
          }
        />
        <UsageSummary used={used} callsAndTexts={live.twilio || demoMode} />
      </section>

      <section aria-labelledby="history-title" className="mb-12">
        <SectionHeading id="history-title" title="Credit added" />
        <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
          {history.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-4 px-5 py-3.5 sm:px-6">
              <div className="min-w-0">
                <div className="text-sm font-medium">{KIND_LABEL[h.kind] ?? "Credit"}</div>
                <div className="text-xs text-muted-foreground">
                  {day(h.createdAt)}
                  {h.paidCents ? ` · card charged ${formatCents(h.paidCents)}` : ""}
                </div>
              </div>
              <div className={cn("shrink-0 font-display text-base font-bold tabular-nums", h.amountMicros < 0 ? "text-muted-foreground" : "text-success")}>
                {h.amountMicros < 0 ? formatMicros(h.amountMicros) : `+${formatMicros(h.amountMicros)}`}
              </div>
            </li>
          ))}
          {credit.starterMicros > 0 ? (
            <li className="flex items-center justify-between gap-4 px-5 py-3.5 sm:px-6">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary" aria-hidden>
                  <Gift className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium">Starter credit, to try everything</div>
                  <div className="text-xs text-muted-foreground">{day(user.createdAt)}</div>
                </div>
              </div>
              <div className="shrink-0 font-display text-base font-bold text-success tabular-nums">+{formatMicros(credit.starterMicros)}</div>
            </li>
          ) : null}
          {history.length === 0 && credit.starterMicros === 0 ? (
            <li className="px-5 py-4 text-sm text-muted-foreground sm:px-6">Nothing yet.</li>
          ) : null}
        </ul>
      </section>

      <section aria-labelledby="prices-title" className="mb-12">
        <SectionHeading
          id="prices-title"
          title="What things cost"
          description={
            <>
              At cost: what each service charges us, with nothing added.{" "}
              <Link href="/pricing" className="font-medium text-primary hover:underline">
                See every price
              </Link>
              .
            </>
          }
        />
        <PriceList />
      </section>

      <section aria-labelledby="faq-title">
        <SectionHeading id="faq-title" title="Good to know" />
        <div className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
          {faqs.map((f, i) => (
            <details key={f.q} className="group" open={i < 2}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-semibold transition hover:bg-muted/50 sm:px-6 [&::-webkit-details-marker]:hidden">
                {f.q}
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition group-open:rotate-180" aria-hidden />
              </summary>
              <p className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground sm:px-6">{f.a}</p>
            </details>
          ))}
        </div>
        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" aria-hidden /> Prices in US dollars.
        </p>
      </section>
    </PageContainer>
  );
}
