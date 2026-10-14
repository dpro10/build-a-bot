/**
 * /build for an owner whose plan has no room for another bot, while paid plans can't be
 * bought yet: said up front, before step 1, with the two real ways forward (delete one,
 * or wait for paid plans). Server-component safe.
 */
import Link from "next/link";
import { ArrowRight, Settings, X } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { PlanWaitlist } from "@/components/marketing/pricing/PlanWaitlist";
import { PLANS, type Plan } from "@/lib/billing/plans";
import type { AvatarId, ColorwayId } from "@/lib/avatars";

export type LimitBot = { id: string; name: string; avatar: AvatarId; color: ColorwayId };

export function BotLimit({ plan, bots, total, email }: { plan: Plan; /** The first few, to show. */ bots: LimitBot[]; total: number; email: string | null }) {
  const limit = plan.limits.bots;
  const only = total === 1 ? bots[0] : null;
  return (
    <div className="relative min-h-dvh bg-background">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[420px] overflow-hidden" aria-hidden>
        <div className="aurora opacity-70" />
      </div>

      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="shrink-0" aria-label="Home">
            <Logo className="text-lg" />
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <ThemeToggle />
            <Button asChild variant="ghost" size="icon-sm" aria-label="Exit the builder">
              <Link href="/app">
                <X />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto flex max-w-xl flex-col items-center gap-6 px-4 pt-14 pb-24 text-center sm:px-6 sm:pt-20">
        <div className="flex -space-x-6">
          {bots.slice(0, 3).map((b) => (
            <Avatar key={b.id} avatar={b.avatar} color={b.color} size={only ? 120 : 96} mood="happy" title={b.name} />
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-bold text-balance sm:text-4xl">
            {plan.name} includes {limit} bot{limit === 1 ? "" : "s"}
          </h1>
          <p className="text-lg text-pretty text-muted-foreground">
            {only
              ? `You've already made ${only.name}. To make a different bot, delete ${only.name} first, from its Settings.`
              : `You've made ${total} bots. To make another, delete one first, from its Settings.`}{" "}
            Or wait for paid plans: they&apos;re coming soon.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild size="lg">
            <Link href={only ? `/app/bots/${only.id}` : "/app?all=1"}>
              {only ? `Back to ${only.name}` : "Your bots"} <ArrowRight />
            </Link>
          </Button>
          {only ? (
            <Button asChild size="lg" variant="outline">
              <Link href={`/app/bots/${only.id}/settings#danger`}>
                <Settings /> Delete it in Settings
              </Link>
            </Button>
          ) : null}
        </div>
        <div className="mt-2 flex w-full max-w-sm flex-col gap-3 rounded-3xl border border-border bg-card p-4 text-left shadow-soft">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Plus</span> will have {PLANS.plus.limits.bots} bots and{" "}
            <span className="font-semibold text-foreground">Pro</span> {PLANS.pro.limits.bots}. Want an email when they&apos;re ready?
          </p>
          <PlanWaitlist plan="plus" email={email} size="md" />
        </div>
      </main>
    </div>
  );
}
