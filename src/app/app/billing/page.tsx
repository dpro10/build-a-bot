import type { Metadata } from "next";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { getDb } from "@/lib/db";
import { isAnonymous, requireUser } from "@/lib/auth/session";
import { PLANS, getPlan } from "@/lib/billing/plans";
import { demoMode, live } from "@/lib/env";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageContainer, PageHeader, SectionHeading } from "@/components/account/PageHeader";
import { UsageMeters } from "@/components/account/UsageMeters";
import { CheckoutNotice, ManageBillingButton, PlanPicker, type BillingMode } from "@/components/account/BillingClient";
import { periodLabels, safeTimeZone, usageNumbers } from "@/components/account/billing-shared";

export const metadata: Metadata = { title: "Plan & usage" };

const STATUS: Record<string, { label: string; tone: "success" | "primary" | "warning" | "neutral" }> = {
  active: { label: "Active", tone: "success" },
  trialing: { label: "Free trial", tone: "primary" },
  past_due: { label: "Payment due", tone: "warning" },
  canceled: { label: "Canceled", tone: "neutral" },
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string | string[]; success?: string | string[]; canceled?: string | string[] }>;
}) {
  const user = await requireUser("/app/billing");
  const db = await getDb();
  const [{ used, period }, sp] = await Promise.all([usageNumbers(db, user.id), searchParams]);
  const plan = getPlan(user.plan);
  const labels = periodLabels(period);
  const mode: BillingMode = live.stripe ? "stripe" : demoMode ? "demo" : "off";
  const status = STATUS[user.planStatus] ?? { label: user.planStatus, tone: "neutral" as const };

  const checkoutParam = first(sp.checkout);
  const checkout =
    checkoutParam === "success" || first(sp.success) === "1"
      ? "success"
      : checkoutParam === "cancel" || checkoutParam === "canceled" || first(sp.canceled) === "1"
        ? "cancel"
        : null;

  const renews =
    user.planRenewsAt && plan.id !== "free"
      ? user.planRenewsAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: safeTimeZone(user.timezone) })
      : null;
  const priceLine =
    plan.priceMonthly === 0
      ? "Free forever. No card needed."
      : `$${plan.priceMonthly} a month${renews ? ` · ${user.planStatus === "canceled" ? "ends" : "renews"} ${renews}` : ""}`;
  const canManage = mode === "stripe" && Boolean(user.stripeCustomerId || user.stripeSubscriptionId);

  const faqs: { q: string; a: React.ReactNode }[] = [
    {
      q: "What counts as a message?",
      a: "One message is one thing you send your bot (or someone you've let reach it) that it answers — however many apps, searches or steps it takes. Reminders, routines and the follow-up after you approve something don't count.",
    },
    {
      q: "Do messages on my own key or subscription count?",
      a: `Not against your included messages. Those only cover answers from the open models we run for you. On your own API key, your provider bills you and a generous fair-use limit applies (${PLANS.free.limits.byoMessages.toLocaleString("en-US")} a month on Free, ${PLANS.plus.limits.byoMessages.toLocaleString("en-US")} on Plus, ${PLANS.pro.limits.byoMessages.toLocaleString("en-US")} on Pro). Bots that think with your own Claude or ChatGPT subscription through the Bridge don't count at all.`,
    },
    {
      q: "How do phone calls and texts work?",
      a: !(live.twilio || demoMode)
        ? "They're coming soon, on Plus and Pro. Until then, talk to your bot on the web, Telegram, Discord or Slack."
        : `Calls and texts start on Plus (${PLANS.plus.limits.voiceMinutes} call minutes and ${PLANS.plus.limits.smsSegments} texts a month; Pro gets ${PLANS.pro.limits.voiceMinutes} and ${PLANS.pro.limits.smsSegments.toLocaleString("en-US")}). Call minutes add up across all your calls. Texts count in segments of about 160 characters (70 with emoji), so a long text can count as two or three.`,
    },
    {
      q: "What happens if I run out?",
      a: `No surprise charges. Your bot tells you it hit the limit and that part waits until ${labels.reset}. ${mode === "off" ? "To keep going sooner, switch" : "You can upgrade anytime, or switch"} a bot to your own key or subscription in its Settings → Brain${mode === "off" ? "." : " to keep going."}`,
    },
    {
      q: "When does my usage reset?",
      a: `On the 1st of every month (UTC). Your next reset is ${labels.reset}.`,
    },
    mode === "off"
      ? {
          q: "Can I switch plans?",
          a: "Not yet: Plus and Pro are coming soon. Join a waitlist above and we'll email you when they're ready. Your bots and their memories stay whichever plan you're on.",
        }
      : {
          q: "Can I cancel or switch plans?",
          a:
            mode === "stripe"
              ? "Anytime, from Manage billing. If you cancel, you keep your plan until the end of the period you paid for, then move to Free. Your bots and their memories stay."
              : "In this demo, switch freely with the buttons above. Nothing is charged, and your bots keep everything they know.",
        },
  ];

  return (
    <PageContainer>
      <PageHeader title="Plan & usage" description="What you're on, what you've used this month, and what each plan includes." />
      <CheckoutNotice status={checkout} planName={plan.name} />

      {user.planStatus === "past_due" ? (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-3xl border border-warning/40 bg-warning-soft p-4 sm:p-5">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <div className="flex-1 text-sm">
            <div className="font-semibold">Your last payment didn&apos;t go through</div>
            <p className="text-foreground/80">Update your card in Manage billing to keep {plan.name}.</p>
          </div>
          {canManage ? <ManageBillingButton className="shrink-0" /> : null}
        </div>
      ) : null}

      <section aria-labelledby="your-plan" className="mb-12 overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <div className="text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">Your plan</div>
            <div className="mt-1 flex flex-wrap items-center gap-2.5">
              <h2 id="your-plan" className="font-display text-3xl font-bold">
                {plan.name}
              </h2>
              <Badge tone={status.tone}>{status.label}</Badge>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{priceLine}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage ? <ManageBillingButton /> : null}
            <Button asChild variant={plan.id === "pro" ? "outline" : "soft"}>
              <a href="#plans">
                {plan.id === "pro" ? "Compare plans" : mode === "off" ? "See plans" : "See upgrades"} <ChevronDown />
              </a>
            </Button>
          </div>
        </div>
        <div className="border-t border-border bg-background-2/50 p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="font-display text-lg font-semibold">This month</h3>
            <p className="text-sm text-muted-foreground">
              {labels.month} · resets {labels.reset}
            </p>
          </div>
          <UsageMeters plan={plan} used={used} resetLabel={labels.reset} paidPlans={mode !== "off"} callsAndTexts={live.twilio || demoMode} />
        </div>
      </section>

      <section id="plans" aria-labelledby="plans-title" className="mb-12 scroll-mt-6">
        <SectionHeading
          id="plans-title"
          title="Plans"
          description={mode === "off" ? "Plus and Pro are coming soon. Your bots keep everything they know." : "Change anytime. Your bots keep everything they know."}
        />
        <PlanPicker
          current={plan.id}
          mode={mode}
          anonymous={isAnonymous(user)}
          hasSubscription={Boolean(user.stripeSubscriptionId)}
          email={isAnonymous(user) ? null : user.email}
        />
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
      </section>
    </PageContainer>
  );
}
