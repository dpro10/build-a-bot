/**
 * /build for an owner who already has the most bots one account can have (fair use, not a
 * plan): said up front, before step 1, with the way forward (delete one). Server-component safe.
 */
import Link from "next/link";
import { ArrowRight, Settings, X } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { FAIR_USE } from "@/lib/billing/prices";
import type { AvatarId, ColorwayId } from "@/lib/avatars";

export type LimitBot = { id: string; name: string; avatar: AvatarId; color: ColorwayId };

export function BotLimit({ bots, total }: { /** The first few, to show. */ bots: LimitBot[]; total: number }) {
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
          <h1 className="font-display text-3xl font-bold text-balance sm:text-4xl">You have {FAIR_USE.bots} bots, the most one account can have</h1>
          <p className="text-lg text-pretty text-muted-foreground">
            {only
              ? `To make a different bot, delete ${only.name} first, from its Settings.`
              : `To make another, delete one first, from its Settings.`}{" "}
            Having bots costs nothing; the limit keeps one account from tying up the servers.
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
      </main>
    </div>
  );
}
