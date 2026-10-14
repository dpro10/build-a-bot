/**
 * Brand + UI icons for connectors, channels and model providers.
 * Brand glyphs come from simple-icons (generated subset); generic ones from Lucide.
 */
import * as React from "react";
import {
  AlarmClock,
  Brain,
  Calculator,
  CloudSun,
  Globe,
  ImagePlus,
  Inbox,
  Mail,
  MessageCircle,
  MessageSquareText,
  MousePointerClick,
  Newspaper,
  NotebookPen,
  Phone,
  Plug,
  Search,
  Users,
  Hash,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { BRAND_ICONS } from "@/lib/icons.generated";
import { cn } from "@/lib/utils";

const LUCIDE: Record<string, LucideIcon> = {
  AlarmClock,
  Brain,
  Calculator,
  CloudSun,
  Globe,
  ImagePlus,
  Inbox,
  Mail,
  MessageCircle,
  MessageSquareText,
  MousePointerClick,
  Newspaper,
  NotebookPen,
  Phone,
  Plug,
  Search,
  Users,
  Hash,
  Sparkles,
};

export type IconSpec = { simpleIcon?: string; lucide?: string; letter?: string; color?: string };

/** Perceived brightness of a hex color (0-255) to pick a readable glyph color. */
function luminance(hex: string) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * A rounded tile with the brand glyph. `variant="tile"` = colored background + white
 * glyph (catalog cards); `variant="plain"` = glyph in brand color (inline).
 */
export function BrandTile({
  icon,
  size = 40,
  variant = "tile",
  className,
  label,
}: {
  icon: IconSpec;
  size?: number;
  variant?: "tile" | "plain" | "soft";
  className?: string;
  label?: string;
}) {
  const brand = icon.simpleIcon ? BRAND_ICONS[icon.simpleIcon] : undefined;
  const hex = `#${(icon.color ?? brand?.hex ?? "64748B").replace("#", "")}`;
  const glyphSize = Math.round(size * 0.52);
  const tooDark = luminance(hex) < 40;
  const tileBg = tooDark ? "#1f1d29" : hex;
  const fg = luminance(tileBg) > 186 ? "#16151c" : "#ffffff";
  const Lucide = icon.lucide ? LUCIDE[icon.lucide] : undefined;

  const glyph = brand ? (
    <svg viewBox="0 0 24 24" width={glyphSize} height={glyphSize} fill="currentColor" aria-hidden="true">
      <path d={brand.path} />
    </svg>
  ) : Lucide ? (
    <Lucide width={glyphSize} height={glyphSize} strokeWidth={2.2} aria-hidden="true" />
  ) : (
    <span className="font-display font-bold leading-none" style={{ fontSize: Math.round(size * (icon.letter && icon.letter.length > 1 ? 0.34 : 0.44)) }}>
      {icon.letter ?? "?"}
    </span>
  );

  if (variant === "plain") {
    return (
      <span className={cn("inline-flex items-center justify-center", className)} style={{ color: tooDark ? "currentColor" : hex, width: size, height: size }} aria-label={label}>
        {glyph}
      </span>
    );
  }
  if (variant === "soft") {
    return (
      <span
        className={cn("inline-flex shrink-0 items-center justify-center rounded-[28%]", className)}
        style={{ width: size, height: size, color: tooDark ? "var(--foreground)" : hex, background: `color-mix(in oklab, ${hex} 14%, transparent)` }}
        aria-label={label}
        role={label ? "img" : undefined}
      >
        {glyph}
      </span>
    );
  }
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-[28%] shadow-[inset_0_-2px_0_rgb(0_0_0/0.12)]", className)}
      style={{ width: size, height: size, background: tileBg, color: fg }}
      aria-label={label}
      role={label ? "img" : undefined}
    >
      {glyph}
    </span>
  );
}
