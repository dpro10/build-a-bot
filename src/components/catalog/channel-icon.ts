import type { ChannelDef } from "@/lib/channels/catalog";
import { BRAND_ICONS } from "@/lib/icons.generated";
import type { IconSpec } from "@/components/brand/icons";

/** Some brands asked simple-icons to remove their logos (Slack, Microsoft): fall back to a generic glyph. */
const FALLBACK_LUCIDE: Record<string, string> = { slack: "Hash", teams: "Users" };

export function channelIcon(def: ChannelDef): IconSpec {
  const color = def.color.replace("#", "");
  if (def.brand && BRAND_ICONS[def.icon]) return { simpleIcon: def.icon, color };
  if (FALLBACK_LUCIDE[def.kind]) return { lucide: FALLBACK_LUCIDE[def.kind], color };
  if (!def.brand) return { lucide: def.icon, color };
  return { letter: def.name.slice(0, 1), color };
}
