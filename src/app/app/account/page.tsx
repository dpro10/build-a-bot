import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, EyeOff, KeyRound, OctagonX, Receipt } from "lucide-react";
import { getDb } from "@/lib/db";
import { isAnonymous, requireUser } from "@/lib/auth/session";
import { getPlan } from "@/lib/billing/plans";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/misc";
import { PageContainer, PageHeader } from "@/components/account/PageHeader";
import { DataActions, ProfileForm } from "@/components/account/AccountForms";
import { meterTone } from "@/components/account/UsageMeters";
import { periodLabels, safeTimeZone, usageNumbers } from "@/components/account/billing-shared";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await requireUser("/app/account");
  const db = await getDb();
  const { used, period } = await usageNumbers(db, user.id);
  const plan = getPlan(user.plan);
  const anonymous = isAnonymous(user);
  const labels = periodLabels(period);
  const since = user.createdAt.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: safeTimeZone(user.timezone) });
  const included = plan.limits.includedMessages;

  return (
    <PageContainer narrow>
      <PageHeader title="Account" description={`Your profile, your plan and your data. Here since ${since}.`} />

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>How your bots know you.</CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm initialName={user.name ?? ""} email={user.email} verified={Boolean(user.emailVerifiedAt)} initialTimezone={safeTimeZone(user.timezone)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <CardTitle>Plan</CardTitle>
              <CardDescription>
                {plan.priceMonthly ? `$${plan.priceMonthly} a month.` : "Free forever."} {plan.tagline}
              </CardDescription>
            </div>
            <Badge tone="primary" className="shrink-0 px-3 py-1 text-sm">
              {plan.name}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-border p-4">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-muted-foreground">Included messages</span>
                  <span className="tabular-nums">
                    <span className="font-semibold">{used.includedMessages.toLocaleString("en-US")}</span>
                    <span className="text-muted-foreground"> / {included.toLocaleString("en-US")}</span>
                  </span>
                </div>
                <Progress value={included ? (used.includedMessages / included) * 100 : 0} tone={meterTone(used.includedMessages, included)} className="mt-2.5" />
                <p className="mt-2 text-xs text-muted-foreground">Resets {labels.reset}.</p>
              </div>
              <div className="rounded-2xl border border-border p-4">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-muted-foreground">Bots</span>
                  <span className="tabular-nums">
                    <span className="font-semibold">{used.bots}</span>
                    <span className="text-muted-foreground"> / {plan.limits.bots}</span>
                  </span>
                </div>
                <Progress value={(used.bots / plan.limits.bots) * 100} tone="primary" className="mt-2.5" />
                <p className="mt-2 text-xs text-muted-foreground">{used.bots >= plan.limits.bots ? `${plan.name} includes ${plan.limits.bots}. Upgrade to make more.` : `Room for ${plan.limits.bots - used.bots} more.`}</p>
              </div>
            </div>
            <Link href="/app/billing" className="group mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
              See plan &amp; usage <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your privacy</CardTitle>
            <CardDescription>The short version of how we handle your stuff.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-4 sm:grid-cols-2">
              <Assurance icon={<KeyRound className="size-4" />} title="Keys stay secret">
                API keys and app logins are encrypted at rest and never shown again — you&apos;ll only ever see a hint like •••• abcd.
              </Assurance>
              <Assurance icon={<EyeOff className="size-4" />} title="Not for training">
                Your chats, memories and files aren&apos;t used to train AI models.
              </Assurance>
              <Assurance icon={<Receipt className="size-4" />} title="A receipt for everything">
                Every action a bot takes is logged in its Activity tab, with what it did and what it cost.
              </Assurance>
              <Assurance icon={<OctagonX className="size-4" />} title="You can always stop it">
                STOP pauses a bot instantly, and you can download or delete everything right here.
              </Assurance>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your data</CardTitle>
            <CardDescription>Take it with you, sign out, or leave for good.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataActions anonymous={anonymous} botCount={used.bots} paid={plan.id !== "free" && Boolean(user.stripeSubscriptionId)} />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}

function Assurance({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary" aria-hidden>
        {icon}
      </span>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}
