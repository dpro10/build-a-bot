import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, EyeOff, KeyRound, OctagonX, Receipt } from "lucide-react";
import { getDb } from "@/lib/db";
import { isAnonymous, requireUser } from "@/lib/auth/session";
import { getCredit } from "@/lib/billing/credit";
import { FAIR_USE, creditTone, formatMicros } from "@/lib/billing/prices";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer, PageHeader } from "@/components/account/PageHeader";
import { DataActions, PhonePinForm, ProfileForm } from "@/components/account/AccountForms";
import { pinLocked } from "@/lib/calls/pin";
import { periodLabels, safeTimeZone, usageNumbers } from "@/components/account/billing-shared";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await requireUser("/app/account");
  const db = await getDb();
  const [{ used, period }, credit] = await Promise.all([usageNumbers(db, user.id), getCredit(db, user.id)]);
  const anonymous = isAnonymous(user);
  const labels = periodLabels(period);
  const since = user.createdAt.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: safeTimeZone(user.timezone) });
  const tone = creditTone(credit.balanceMicros);
  // Credit they added and haven't used (not the starter credit): deleting the account gives it up.
  const paidLeft = Math.min(credit.addedMicros, Math.max(0, credit.balanceMicros));

  return (
    <PageContainer narrow>
      <PageHeader title="Account" description={`Your profile, your credit and your data. Here since ${since}.`} />

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
              <CardTitle>Credit</CardTitle>
              <CardDescription>No plans: you pay for what your bots use, at cost.</CardDescription>
            </div>
            <Badge tone={tone} className="shrink-0 px-3 py-1 text-sm tabular-nums">
              {formatMicros(credit.balanceMicros)} left
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-border p-4">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-muted-foreground">Spent in {labels.month}</span>
                  <span className="font-semibold tabular-nums">{formatMicros(used.costMicros)}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {used.includedMessages.toLocaleString("en-US")} message{used.includedMessages === 1 ? "" : "s"} on included models,{" "}
                  {used.searches.toLocaleString("en-US")} web lookup{used.searches === 1 ? "" : "s"}.
                </p>
              </div>
              <div className="rounded-2xl border border-border p-4">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-muted-foreground">Bots</span>
                  <span className="tabular-nums">
                    <span className="font-semibold">{used.bots}</span>
                    <span className="text-muted-foreground"> / {FAIR_USE.bots}</span>
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {used.bots >= FAIR_USE.bots ? "That's the most you can have. Delete one to make another." : "Having a bot costs nothing; what it does is paid from credit."}
                </p>
              </div>
            </div>
            <Link href="/app/billing" className="group mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
              Credit &amp; usage <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Phone PIN</CardTitle>
            <CardDescription>
              When you call your bot, it knows it&apos;s you if your carrier vouches for your number. When it can&apos;t, it asks for this PIN before
              it shares anything or does anything for you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PhonePinForm initialSet={Boolean(user.phonePinHash)} locked={pinLocked(user)} />
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
            <DataActions anonymous={anonymous} botCount={used.bots} creditLeft={paidLeft > 0 ? formatMicros(paidLeft) : null} />
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
