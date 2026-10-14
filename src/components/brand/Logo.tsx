/**
 * Build-a-bot brand mark: a speech-bubble face (rounded square with one sharp
 * corner as its tail) and a little antenna topped by a spark. Same language as
 * the avatars: soft gradient, bean eyes, rounded geometry. Holds up as a 16px
 * favicon (see src/app/icon.svg). Server-component safe.
 */
import type { JSX } from "react";

type LogoMarkProps = {
  /** px number or any CSS length (e.g. "1.5em"). Default 32. */
  size?: number | string;
  className?: string;
  /** Accessible name. Without it the mark is decorative (aria-hidden). */
  title?: string;
};

/** Shared geometry, 48x48 grid. */
const LOGO = {
  bubble: "M18 13H30A13 13 0 0 1 43 26V31A13 13 0 0 1 30 44H8.5A3.5 3.5 0 0 1 5 40.5V26A13 13 0 0 1 18 13Z",
  antenna: "M24 13V8",
  spark: "M24 0.8Q24.9 3.7 27.8 4.6Q24.9 5.5 24 8.4Q23.1 5.5 20.2 4.6Q23.1 3.7 24 0.8Z",
  sheen: "M10 27C10 23.2 12.4 20 16 19.2",
  smile: "M20.6 34.6C22.5 36.4 25.5 36.4 27.4 34.6",
  violet: ["#9C83FF", "#7C5CFF", "#5136D9"],
  sparkColor: "#FFC93D",
} as const;

export function LogoMark({ size = 32, className, title }: LogoMarkProps): JSX.Element {
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": true, focusable: "false" as const };
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width={size} height={size} className={className} {...a11y}>
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id="bab-logo-fill" x1="8" y1="12" x2="40" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={LOGO.violet[0]} />
          <stop offset="0.5" stopColor={LOGO.violet[1]} />
          <stop offset="1" stopColor={LOGO.violet[2]} />
        </linearGradient>
      </defs>
      <path d={LOGO.antenna} stroke={LOGO.violet[1]} strokeWidth="2.8" strokeLinecap="round" />
      <path d={LOGO.spark} fill={LOGO.sparkColor} />
      <path d={LOGO.bubble} fill="url(#bab-logo-fill)" />
      <path d={LOGO.sheen} fill="none" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="18.5" cy="27.5" rx="3.1" ry="4" fill="#FFFFFF" />
      <ellipse cx="29.5" cy="27.5" rx="3.1" ry="4" fill="#FFFFFF" />
      <path d={LOGO.smile} fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** Mark + wordmark. The wordmark uses currentColor, so set `color` (or a text class) on a parent. */
export function Logo({ className }: { className?: string }): JSX.Element {
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: "0.4em", lineHeight: 1 }}>
      <LogoMark size="1.6em" />
      <span
        style={{
          fontFamily: "var(--font-display, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif)",
          fontWeight: 700,
          letterSpacing: "-0.025em",
          color: "currentColor",
          whiteSpace: "nowrap",
        }}
      >
        Build-a-bot
      </span>
    </span>
  );
}
