import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The views inside one of a bot's tabs (Apps & channels, Settings), as links: each one is its own
 * page view (`?tab=`), so a deep link or a reload opens the same one. Styled like TabsList.
 */
export function SubTabs({ label, active, items }: { label: string; active: string; items: { id: string; label: string; href: string }[] }) {
  return (
    <nav aria-label={label} className="no-scrollbar inline-flex max-w-full gap-1 self-start overflow-x-auto rounded-full bg-muted p-1">
      {items.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          scroll={false}
          aria-current={t.id === active ? "page" : undefined}
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-semibold whitespace-nowrap text-muted-foreground transition hover:text-foreground",
            t.id === active && "bg-card text-foreground shadow-soft",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
