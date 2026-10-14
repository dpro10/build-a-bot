"use client";
import Link from "next/link";
import { ArrowRight, Menu } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Logo } from "@/components/brand/Logo";
import { MARKETING_NAV } from "@/lib/site";

/** The phone menu: a sheet from the right with the same links as the desktop header. */
export function MobileNav({ signedIn }: { signedIn: boolean }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex size-9 items-center justify-center rounded-full text-foreground transition hover:bg-muted lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>
      </DialogTrigger>
      <DialogContent side="right" className="h-dvh max-h-dvh w-[min(380px,100vw)] gap-0 p-0">
        <div className="flex h-16 items-center border-b border-border px-5">
          <DialogTitle className="sr-only">Menu</DialogTitle>
          <DialogDescription className="sr-only">Pages on Build-a-bot</DialogDescription>
          <Logo className="text-[17px]" />
        </div>
        <nav aria-label="Mobile" className="flex flex-col p-3">
          <DialogClose asChild>
            <Link href="/" className="rounded-2xl px-4 py-3 font-display text-xl font-semibold transition hover:bg-muted">
              Home
            </Link>
          </DialogClose>
          {MARKETING_NAV.map((item) => (
            <DialogClose asChild key={item.href}>
              <Link href={item.href} className="rounded-2xl px-4 py-3 font-display text-xl font-semibold transition hover:bg-muted">
                {item.label}
              </Link>
            </DialogClose>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 border-t border-border p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {signedIn ? (
            <DialogClose asChild>
              <Button asChild size="lg">
                <Link href="/app">
                  Your bots <ArrowRight />
                </Link>
              </Button>
            </DialogClose>
          ) : (
            <>
              <DialogClose asChild>
                <Button asChild size="lg">
                  <Link href="/build">
                    Build your bot <ArrowRight />
                  </Link>
                </Button>
              </DialogClose>
              <DialogClose asChild>
                <Button asChild size="lg" variant="outline">
                  <Link href="/login">Sign in</Link>
                </Button>
              </DialogClose>
            </>
          )}
          <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
            <span>Theme</span>
            <ThemeToggle />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
