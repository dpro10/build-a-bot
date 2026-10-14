import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { HeaderNav } from "./HeaderNav";
import { MobileNav } from "./MobileNav";
import { getViewer } from "./viewer";

/** Sticky, blurred header for the public pages. */
export async function SiteHeader() {
  const viewer = await getViewer();
  return (
    // Mostly opaque: the links stay readable while the dark prompt-injection band scrolls under a light header.
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-xl supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="Build-a-bot home" className="mr-2 shrink-0 rounded-xl text-foreground lg:mr-6">
          <Logo className="text-[17px]" />
        </Link>
        <HeaderNav />
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle className="hidden sm:inline-flex" />
          {viewer ? (
            <Button asChild size="sm">
              <Link href="/app">
                Your bots <ArrowRight />
              </Link>
            </Button>
          ) : (
            <>
              <Button asChild size="sm" variant="ghost" className="hidden sm:inline-flex">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/build">Build your bot</Link>
              </Button>
            </>
          )}
          <MobileNav signedIn={Boolean(viewer)} />
        </div>
      </div>
    </header>
  );
}
