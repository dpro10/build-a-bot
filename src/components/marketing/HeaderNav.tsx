"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MARKETING_NAV } from "@/lib/site";
import { cn } from "@/lib/utils";

/** Desktop nav links, with the current page marked. */
export function HeaderNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex">
      {MARKETING_NAV.map((item) => {
        const active = !item.href.includes("#") && (pathname === item.href || pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
