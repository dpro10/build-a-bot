import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getUser, isAnonymous } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/magic";
import { listBots } from "@/lib/data";
import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LoginCard, type PeekBot } from "@/components/account/LoginCard";
import type { AvatarId, ColorwayId } from "@/lib/avatars";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Build-a-bot with a magic link. No password needed.",
  robots: { index: false },
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Where to go after signing in. Never back to the login page itself (that would loop). */
function destination(next: string | undefined): string {
  const safe = safeNext(next);
  return safe.startsWith("/login") || safe.startsWith("/auth/") ? "/app" : safe;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; error?: string | string[] }> }) {
  const sp = await searchParams;
  const next = destination(first(sp.next));
  const user = await getUser();

  // Already signed in with a verified email: nothing to do here.
  if (user && !isAnonymous(user)) redirect(next);

  // Signed in anonymously (built a bot first): this becomes "save your account".
  let bots: PeekBot[] = [];
  if (user) {
    const db = await getDb();
    bots = (await listBots(db, user.id)).map(({ bot }) => ({ name: bot.name, avatar: bot.avatar as AvatarId, color: bot.color as ColorwayId }));
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background">
      <div className="aurora" aria-hidden />
      <div className="dot-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_70%)] opacity-40" aria-hidden />
      <header className="relative z-10 flex h-16 items-center justify-between px-4 sm:px-8">
        <Link href="/" aria-label="Build-a-bot home" className="rounded-lg">
          <Logo className="text-lg" />
        </Link>
        <ThemeToggle />
      </header>
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 pt-4 pb-14">
        <LoginCard next={next} error={first(sp.error) ?? null} mode={bots.length ? "save" : "signin"} bots={bots} />
      </main>
    </div>
  );
}
