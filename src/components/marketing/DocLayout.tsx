import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Container } from "./ui";
import { TocSpy } from "./TocSpy";

export type TocEntry = { id: string; title: string };

/** Long-form page: sticky table of contents on desktop, a collapsible one on phones. */
export function DocLayout({ toc, children, className }: { toc: TocEntry[]; children: React.ReactNode; className?: string }) {
  return (
    <Container className={cn("grid gap-8 pt-10 pb-20 sm:pt-12 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-14 lg:pb-28", className)}>
      <aside className="hidden lg:block">
        <nav aria-label="On this page" className="sticky top-24">
          <div className="text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">On this page</div>
          <TocSpy ids={toc.map((t) => t.id)}>
            <ol className="mt-3 flex flex-col gap-0.5 border-l border-border">
              {toc.map((t) => (
                <li key={t.id}>
                  <a
                    href={`#${t.id}`}
                    data-toc={t.id}
                    className="-ml-px block border-l-2 border-transparent py-1.5 pl-4 text-sm text-muted-foreground transition hover:border-border hover:text-foreground data-[active=true]:border-primary data-[active=true]:font-semibold data-[active=true]:text-foreground"
                  >
                    {t.title}
                  </a>
                </li>
              ))}
            </ol>
          </TocSpy>
        </nav>
      </aside>
      <div className="min-w-0">
        <details className="group mb-10 rounded-2xl border border-border bg-card shadow-soft lg:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            On this page
            <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" aria-hidden="true" />
          </summary>
          <ol className="flex flex-col border-t border-border px-2 py-2">
            {toc.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`} className="block rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                  {t.title}
                </a>
              </li>
            ))}
          </ol>
        </details>
        {children}
      </div>
    </Container>
  );
}

export function DocSection({
  id,
  title,
  icon,
  children,
  className,
}: {
  id: string;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className={cn("scroll-mt-24 border-t border-border py-10 first-of-type:border-t-0 first-of-type:pt-0", className)}>
      <div className="flex items-center gap-3">
        {icon ? (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary [&_svg]:size-5" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <h2 id={`${id}-h`} className="font-display text-2xl leading-tight font-bold tracking-tight sm:text-[1.7rem]">
          {title}
        </h2>
      </div>
      <div className="mk-prose mt-4 max-w-[68ch] text-[16px]">{children}</div>
    </section>
  );
}
