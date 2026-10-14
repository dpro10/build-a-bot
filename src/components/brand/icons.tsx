/**
 * Brand + UI icons for connectors, channels and model providers.
 * Brand glyphs come from simple-icons (generated subset); generic ones from Lucide.
 */
import * as React from "react";
import {
  AlarmClock,
  AudioLines,
  Brain,
  Calculator,
  CloudSun,
  Globe,
  Hexagon,
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
  Video,
  type LucideIcon,
} from "lucide-react";
import { BRAND_ICONS } from "@/lib/icons.generated";
import { cn } from "@/lib/utils";

const LUCIDE: Record<string, LucideIcon> = {
  AlarmClock,
  AudioLines,
  Brain,
  Calculator,
  CloudSun,
  Globe,
  // A plain mark for brands simple-icons doesn't ship a logo for (OpenAI, ChatGPT).
  Hexagon,
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
  Video,
};

export type IconSpec = { simpleIcon?: string; lucide?: string; letter?: string; color?: string };

/** Perceived brightness of a hex color (0-255) to pick a readable glyph color. */
/** WCAG relative luminance (0–1). */
function relLum(hex: string) {
  const h = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/**
 * Mid-tone brand colors (e.g. #4D6BFE) can't carry white or dark text at 4.5:1, so
 * the tile is darkened just enough for white text to pass. Logos still read as the brand.
 */
function legibleTile(hex: string) {
  const best = (bg: string) => Math.max(1.05 / (relLum(bg) + 0.05), (relLum(bg) + 0.05) / (relLum("#16151c") + 0.05));
  if (best(hex) >= 4.5) return hex;
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.replace("#", "").slice(i, i + 2), 16));
  let out = hex;
  for (let i = 0; i < 12 && 1.05 / (relLum(out) + 0.05) < 4.5; i++) {
    [r, g, b] = [r, g, b].map((c) => Math.round(c * 0.92));
    out = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }
  return out;
}

/** White or ink, whichever reads better on this background (WCAG contrast). */
function readableOn(bg: string) {
  const l = relLum(bg);
  const onWhite = 1.05 / (l + 0.05);
  const onInk = (l + 0.05) / (relLum("#16151c") + 0.05);
  return onWhite >= onInk ? "#ffffff" : "#16151c";
}

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
  const tileBg = tooDark ? "#1f1d29" : legibleTile(hex);
  const fg = readableOn(tileBg);
  const Lucide = icon.lucide ? LUCIDE[icon.lucide] : undefined;

  const glyph = brand ? (
    <svg viewBox="0 0 24 24" width={glyphSize} height={glyphSize} fill="currentColor" aria-hidden="true">
      <path d={brand.path} />
    </svg>
  ) : Lucide ? (
    <Lucide width={glyphSize} height={glyphSize} strokeWidth={2.2} aria-hidden="true" />
  ) : (
    <span className="font-display font-bold leading-none" aria-hidden="true" style={{ fontSize: Math.round(size * (icon.letter && icon.letter.length > 1 ? 0.34 : 0.44)) }}>
      {icon.letter ?? "?"}
    </span>
  );

  // Very dark brand colors (Slack's aubergine, X's black) vanish on dark surfaces when used as
  // the glyph color, so plain/soft glyphs fall back to the text color below this brightness.
  // Letter stand-ins are text, so they need full text contrast: use the text color.
  const isLetter = !brand && !Lucide;
  const glyphOnSurface = isLetter || luminance(hex) < 70 ? "var(--foreground)" : hex;

  if (variant === "plain") {
    return (
      <span className={cn("inline-flex items-center justify-center", className)} style={{ color: glyphOnSurface, width: size, height: size }} aria-label={label}>
        {glyph}
      </span>
    );
  }
  if (variant === "soft") {
    return (
      <span
        className={cn("inline-flex shrink-0 items-center justify-center rounded-[28%]", className)}
        style={{ width: size, height: size, color: glyphOnSurface, background: `color-mix(in oklab, ${luminance(hex) < 70 ? "var(--foreground)" : hex} 12%, transparent)` }}
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
