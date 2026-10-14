import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Native <select>, styled like Input. Native keeps it accessible and mobile-friendly. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { size?: "md" | "sm" }>(
  ({ className, children, size = "md", ...props }, ref) => (
    <span className={cn("relative inline-flex w-full", className)}>
      <select
        ref={ref}
        className={cn(
          "w-full appearance-none rounded-2xl border border-input bg-card pr-10 pl-4 text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15 disabled:opacity-60",
          size === "md" ? "h-12 text-base" : "h-9 rounded-xl pl-3 text-sm",
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </span>
  ),
);
Select.displayName = "Select";
