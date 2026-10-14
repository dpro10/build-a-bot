import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { HARD_LIMITS } from "@/lib/trust";
import { Container, Section, SectionHeader } from "../ui";
import { TrustDial } from "./TrustDial";

export function HardLimits({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-7">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">
              <Lock className="size-3.5" aria-hidden="true" /> At every level, enforced in code
            </div>
            <h3 className="mt-1.5 font-display text-2xl font-bold tracking-tight">Hard limits no setting can turn off</h3>
          </div>
          <Link href="/safety" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            How safety works <ArrowRight className="size-4" />
          </Link>
        </div>
        <ul className="mt-5 grid gap-3 md:grid-cols-2">
          {HARD_LIMITS.map((limit) => (
            <li key={limit} className="flex gap-3 rounded-2xl bg-background-2/70 p-3.5 text-[15px] leading-snug">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background" aria-hidden="true">
                <Lock className="size-3.5" />
              </span>
              <span className="pt-0.5">{limit}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function TrustSection() {
  return (
    <Section id="trust" aria-labelledby="trust-title" className="bg-background-2">
      <Container>
        <SectionHeader id="trust-title" eyebrow="Trust levels" title="You decide how much it can do.">
          From read-only to full autopilot. Turn the dial per bot, any time. The rules live in code, outside the AI, so no clever message can talk its way
          past them.
        </SectionHeader>
        <div className="mt-14">
          <TrustDial initial="full" />
        </div>
        <HardLimits className="mt-5" />
      </Container>
    </Section>
  );
}
