/**
 * Site-wide constants for the public pages (landing, pricing, safety, legal, recipes).
 *
 * The support address comes from NEXT_PUBLIC_SUPPORT_EMAIL. We never invent one:
 * without it, contact links point to the in-app Account page instead.
 */
import type { Metadata } from "next";

const supportEmail = (process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "").trim() || null;

export const SITE = {
  name: "Build-a-bot",
  domain: "build-a-bot.site",
  tagline: "Your own AI agent, in about a minute.",
  description:
    "Pick a face, name it, give it a brain and your apps, and talk to it on the web, Telegram, Discord or Slack. Calls, texts and email are coming soon. Safety rules enforced in code.",
  supportEmail,
  /** Where people manage their data, export it and reach us when no email is configured. */
  accountPath: "/app/account",
  legalUpdated: "October 16, 2026",
  legalUpdatedISO: "2026-10-16",
  year: 2026,
} as const;

export type ContactLink = { href: string; label: string; isEmail: boolean };

/** How to reach us: the support email when configured, else the Account page. */
export function contactLink(subject?: string): ContactLink {
  if (SITE.supportEmail) {
    const query = subject ? `?subject=${encodeURIComponent(subject)}` : "";
    return { href: `mailto:${SITE.supportEmail}${query}`, label: SITE.supportEmail, isEmail: true };
  }
  return { href: SITE.accountPath, label: "your Account page", isEmail: false };
}

export const MARKETING_NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/explore", label: "Explore" },
  { href: "/pricing", label: "Pricing" },
  { href: "/safety", label: "Safety" },
] as const;

/**
 * The site-wide share image (app/opengraph-image.tsx). A page that sets its own
 * `openGraph` replaces the root one wholesale, image included, so pages name it again.
 */
const SHARE_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "Build-a-bot: your own AI agent, in about a minute. Five friendly bot characters.",
};

/** Per-page metadata with matching Open Graph and X fields, including the share image. */
export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title: `${title} · ${SITE.name}`, description, url: path, siteName: SITE.name, type: "website", images: [SHARE_IMAGE] },
    twitter: { card: "summary_large_image", title: `${title} · ${SITE.name}`, description, images: [SHARE_IMAGE] },
  };
}
