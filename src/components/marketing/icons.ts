/**
 * Icon specs for <BrandTile /> on the public pages. Server-only in practice: it
 * reads the generated brand-icon map, which is too big to ship to the browser.
 * Client islands receive pre-rendered tiles as props instead.
 */
import type { IconSpec } from "@/components/brand/icons";
import { BRAND_ICONS } from "@/lib/icons.generated";
import type { ChannelDef } from "@/lib/channels/catalog";

/** A channel's tile: its brand glyph when we ship one, else its Lucide icon or a letter. */
export function channelIcon(def: ChannelDef): IconSpec {
  const color = def.color.replace("#", "");
  if (def.brand) return BRAND_ICONS[def.icon] ? { simpleIcon: def.icon, color } : { letter: def.name.charAt(0), color };
  return { lucide: def.icon, color };
}

/** Brand glyph when available, else a letter tile in the given color. */
export function brandOrLetter(slug: string | undefined, letter: string, color: string): IconSpec {
  return slug && BRAND_ICONS[slug] ? { simpleIcon: slug, color } : { letter, color };
}
