"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = { value: T; label: React.ReactNode; title?: string; disabled?: boolean };

/** A row of mutually exclusive choices (radio group semantics, arrow keys move). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    for (let step = 1; step <= options.length; step++) {
      const j = (i + dir * step + options.length) % options.length;
      if (!options[j].disabled) {
        onChange(options[j].value);
        refs.current[j]?.focus();
        break;
      }
    }
  };
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex rounded-full bg-muted p-1", className)}>
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "rounded-full font-semibold whitespace-nowrap transition",
              size === "md" ? "px-4 py-1.5 text-sm" : "px-3 py-1 text-xs",
              active ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
              o.disabled && "opacity-50",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
