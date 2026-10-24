/**
 * Where a bot tab that moved now lives (2026-10-24, docs/DECISIONS.md): Library is Memory › Files,
 * Channels is part of Apps & channels, Activity is part of Settings. Old links (sent in Slack,
 * Discord or email, or opened by older desktop apps) redirect here with their query string.
 */
export type MovedTab = "library" | "channels" | "activity";

const NEW_HOME: Record<MovedTab, { path: string; tab: string }> = {
  library: { path: "memory", tab: "files" },
  channels: { path: "tools", tab: "channels" },
  activity: { path: "settings", tab: "activity" },
};

/** The new address for `/app/bots/{botId}/{tab}?{query}`. */
export function movedTabHref(botId: string, tab: MovedTab, query: Record<string, string | string[] | undefined>): string {
  const pairs = Object.entries(query).flatMap(([key, value]) => (Array.isArray(value) ? value : value === undefined ? [] : [value]).map((v) => [key, v] as [string, string]));
  const home = NEW_HOME[tab];
  const params = new URLSearchParams([["tab", home.tab], ...pairs.filter(([key]) => key !== "tab" && key !== "view")]);
  // Activity had its own ?tab= for Timeline or Deliveries: that's ?view= now.
  if (tab === "activity" && pairs.some(([key, v]) => key === "tab" && v === "deliveries")) params.set("view", "deliveries");
  return `/app/bots/${botId}/${home.path}?${params}`;
}
