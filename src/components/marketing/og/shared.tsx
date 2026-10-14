/**
 * Pieces shared by the Open Graph images (next/og ImageResponse, which can't run
 * hooks, so nothing here uses <Logo> or <Avatar> directly).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

type OgFont = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };

let fonts: Promise<OgFont[] | undefined> | null = null;

/**
 * Bricolage Grotesque for the OG images, read once per server instance. Paths are
 * literal process.cwd() joins so Next's file tracing ships the files. If they can't
 * be read, undefined makes ImageResponse fall back to its built-in font.
 */
export function ogFonts(): Promise<OgFont[] | undefined> {
  fonts ??= Promise.all([
    readFile(join(process.cwd(), "src/components/marketing/og/BricolageGrotesque-Bold.ttf")),
    readFile(join(process.cwd(), "src/components/marketing/og/BricolageGrotesque-Regular.ttf")),
  ])
    .then(([bold, regular]): OgFont[] => [
      { name: "Bricolage", data: bold, weight: 700, style: "normal" },
      { name: "Bricolage", data: regular, weight: 400, style: "normal" },
    ])
    .catch(() => undefined);
  return fonts;
}

/** The logo mark, drawn directly from the brand geometry in components/brand/Logo.tsx. */
export function OgLogoMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs>
        <linearGradient id="og-logo" x1="8" y1="12" x2="40" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9C83FF" />
          <stop offset="0.5" stopColor="#7C5CFF" />
          <stop offset="1" stopColor="#5136D9" />
        </linearGradient>
      </defs>
      <path d="M24 13V8" stroke="#7C5CFF" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M24 0.8Q24.9 3.7 27.8 4.6Q24.9 5.5 24 8.4Q23.1 5.5 20.2 4.6Q23.1 3.7 24 0.8Z" fill="#FFC93D" />
      <path d="M18 13H30A13 13 0 0 1 43 26V31A13 13 0 0 1 30 44H8.5A3.5 3.5 0 0 1 5 40.5V26A13 13 0 0 1 18 13Z" fill="url(#og-logo)" />
      <path d="M10 27C10 23.2 12.4 20 16 19.2" fill="none" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="18.5" cy="27.5" rx="3.1" ry="4" fill="#FFFFFF" />
      <ellipse cx="29.5" cy="27.5" rx="3.1" ry="4" fill="#FFFFFF" />
      <path d="M20.6 34.6C22.5 36.4 25.5 36.4 27.4 34.6" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export const OG_INK = "#16151C";
export const OG_MUTED = "#6A6677";
