import Link from "next/link";
import { FilePenLine, Scale } from "lucide-react";
import { SITE } from "@/lib/site";
import { Container } from "./ui";

export function LegalHeader({ title, summary, other }: { title: string; summary: string; other: { href: string; label: string } }) {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div className="aurora opacity-60" aria-hidden="true" />
      <Container className="relative py-12 sm:py-16">
        <div className="inline-flex items-center gap-1.5 text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">
          <Scale className="size-3.5" aria-hidden="true" /> Legal
        </div>
        <h1 className="mt-3 font-display text-4xl leading-[1.05] font-extrabold tracking-[-0.03em] sm:text-6xl">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Last updated <time dateTime={SITE.legalUpdatedISO}>{SITE.legalUpdated}</time> ·{" "}
          <Link href={other.href} className="font-medium text-primary hover:underline">
            {other.label}
          </Link>
        </p>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-pretty text-muted-foreground">{summary}</p>
        <div className="mt-6 inline-flex max-w-2xl items-start gap-2.5 rounded-2xl border border-warning/40 bg-warning-soft/70 px-4 py-3 text-sm">
          <FilePenLine className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <p>
            <span className="font-semibold">Draft — to be reviewed before launch.</span>{" "}
            <span className="text-foreground/75">This is our plain-language starting point. A lawyer will review it before Build-a-bot opens to the public.</span>
          </p>
        </div>
      </Container>
    </section>
  );
}
