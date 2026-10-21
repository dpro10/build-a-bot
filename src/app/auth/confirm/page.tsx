import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogIn } from "lucide-react";
import { getDb } from "@/lib/db";
import { findLoginLink } from "@/lib/auth/magic";
import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false },
  // The link's token is in this page's address: it never goes to another site. (Not "no-referrer":
  // that makes the browser send "Origin: null" with the form, and the same-origin check refuses it.)
  referrer: "same-origin",
};

/**
 * A sign-in link opened somewhere other than the browser that asked for it (`/auth/verify` sends
 * it here): nothing is used up until the person presses Sign in, so a mail scanner opening the
 * link can't spend it, and it signs in to the email's own account only.
 */
export default async function ConfirmSignInPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const raw = (await searchParams).token;
  const token = Array.isArray(raw) ? raw[0] : raw;
  const link = token ? await findLoginLink(await getDb(), token) : null;
  if (!token || !link) redirect("/login?error=expired");

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background">
      <div className="aurora" aria-hidden />
      <header className="relative z-10 flex h-16 items-center justify-between px-4 sm:px-8">
        <Link href="/" aria-label="Build-a-bot home" className="rounded-lg">
          <Logo className="text-lg" />
        </Link>
        <ThemeToggle />
      </header>
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 pt-4 pb-14">
        <div className="w-full max-w-[440px] rounded-3xl border border-border bg-card p-6 shadow-lift sm:p-8">
          <h1 className="text-center font-display text-[28px] leading-tight font-bold">Sign in to Build-a-bot</h1>
          <p className="mt-2 text-center text-[15px] text-muted-foreground">
            as <span className="font-semibold break-all text-foreground">{link.email}</span>
          </p>
          <form method="post" action="/auth/verify" className="mt-6">
            <input type="hidden" name="token" value={token} />
            <Button type="submit" size="lg" className="w-full">
              <LogIn /> Sign in
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            This link was opened somewhere other than where it was asked for, so we&apos;re checking first. Bots made before signing in stay in that
            browser: open the link there to bring them along.
          </p>
          <p className="mt-3 text-center text-sm">
            <Link href="/" className="font-medium text-primary hover:underline">
              That&apos;s not me
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
