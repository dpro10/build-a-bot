import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Compass, Home } from "lucide-react";
import "@/components/marketing/marketing.css";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { SiteFooter } from "@/components/marketing/SiteFooter";

// Next.js adds its own noindex tag to 404 responses.
export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <SiteHeader />
      <main id="main" className="relative flex flex-1 items-center overflow-hidden">
        <div className="aurora" aria-hidden="true" />
        <div aria-hidden="true" className="dot-grid absolute inset-0 opacity-60 [mask-image:radial-gradient(50%_50%_at_50%_45%,#000,transparent)]" />
        <div className="relative mx-auto flex w-full max-w-xl flex-col items-center px-4 py-20 text-center sm:py-28">
          <div className="relative">
            <span
              aria-hidden="true"
              className="absolute -top-2 -right-10 rounded-2xl rounded-bl-md border border-border bg-card px-3 py-1.5 font-display text-lg font-bold shadow-lift"
            >
              404?
            </span>
            <Avatar avatar="otto" size={200} mood="thinking" title="Otto the octopus, thinking" className="h-auto w-[170px] sm:w-[200px]" />
          </div>
          <p className="mt-6 text-sm font-semibold tracking-[0.12em] text-primary uppercase">Page not found</p>
          <h1 className="mt-2 font-display text-4xl leading-[1.05] font-extrabold tracking-[-0.03em] text-balance sm:text-5xl">
            Hmm, we looked with all eight arms.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            This page doesn&apos;t exist, or it moved. Let&apos;s get you somewhere useful.
          </p>
          <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Button asChild size="lg">
              <Link href="/">
                <Home /> Go home
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/build">
                Build your bot <ArrowRight />
              </Link>
            </Button>
          </div>
          <Link href="/explore" className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground">
            <Compass className="size-4" aria-hidden="true" /> Or explore recipes
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
