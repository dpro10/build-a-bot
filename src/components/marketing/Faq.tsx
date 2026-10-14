import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type FaqItem = { q: string; a: React.ReactNode };

/** Accessible accordion built on <details>/<summary>: no JavaScript needed. */
export function Faq({ items, className }: { items: FaqItem[]; className?: string }) {
  return (
    <div className={cn("divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft", className)}>
      {items.map((item) => (
        <details key={item.q} className="mk-faq group">
          <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-5 text-left font-display text-lg font-semibold transition hover:bg-muted/50 sm:px-7">
            <span>{item.q}</span>
            <span className="mk-faq-icon flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition duration-200 group-open:bg-primary-soft group-open:text-primary">
              <Plus className="size-4" aria-hidden="true" />
            </span>
          </summary>
          <div className="px-5 pb-6 text-[15px] leading-relaxed text-muted-foreground sm:px-7 [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_p+p]:mt-3">
            {item.a}
          </div>
        </details>
      ))}
    </div>
  );
}

/** FAQPage structured data for search engines (plain-text answers only). */
export function faqJsonLd(items: { q: string; text: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.text } })),
  };
}
