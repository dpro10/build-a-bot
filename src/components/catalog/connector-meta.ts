/**
 * Small helpers for showing connectors: search ranking, effect summaries and
 * job-based suggestions. Shared by the builder and the dashboard.
 */
import { ALL_CONNECTORS, type ConnectorDef } from "@/lib/connectors";
import { DEFAULT_BUILTINS } from "@/lib/connectors/builtin";
import { COMPOSIO_UNMANAGED } from "@/lib/connectors/composio-auth";
import { CATEGORY_LABELS, type ConnectorCategory, type Effect } from "@/lib/connectors/types";

export const ALWAYS_ON = new Set<string>(DEFAULT_BUILTINS);

export function isBuiltin(def: ConnectorDef): boolean {
  return def.via.some((v) => v.kind === "builtin");
}

/** Can be picked today. `comingSoon`: built-ins this server can't run yet (from comingSoonBuiltins()). */
export function isAvailable(def: ConnectorDef, comingSoon?: ReadonlySet<string>): boolean {
  return def.status !== "soon" && !comingSoon?.has(def.id);
}

/** Third-party apps that count toward a plan's app limit. */
export function countsTowardLimit(def: ConnectorDef): boolean {
  return !isBuiltin(def) && isAvailable(def);
}

/** Has a way to sign in once its service is set up (an app only on Composio needs Composio's own OAuth app for it). */
export function canSignIn(def: ConnectorDef): boolean {
  return def.via.some((v) => v.kind !== "composio" || !(v.toolkit in COMPOSIO_UNMANAGED));
}

/** Apps you can actually pick today (built-ins included), rounded down for copy like "110+". */
export const AVAILABLE_APP_COUNT = ALL_CONNECTORS.filter((c) => isAvailable(c) && canSignIn(c) && !ALWAYS_ON.has(c.id)).length;
export const AVAILABLE_APP_COUNT_ROUNDED = Math.floor(AVAILABLE_APP_COUNT / 10) * 10;

export const EFFECT_LABEL: Record<Effect, string> = {
  read: "Reads",
  write: "Makes changes",
  send: "Sends",
  delete: "Deletes",
  spend: "Spends money",
  admin: "Admin",
};

/** Distinct effects a connector can have, in a stable, readable order. */
export function effectsOf(def: ConnectorDef): Effect[] {
  const order: Effect[] = ["read", "write", "send", "delete", "spend", "admin"];
  const set = new Set(def.capabilities.map((c) => c.effect));
  return order.filter((e) => set.has(e));
}

function norm(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Relevance of a connector for a query (0 = no match). */
export function matchScore(def: ConnectorDef, query: string): number {
  const q = norm(query.trim());
  if (!q) return 1;
  const name = norm(def.name);
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  if (name.split(/[\s&(),.-]+/).some((w) => w.startsWith(q))) return 70;
  if (name.includes(q)) return 60;
  if ((def.keywords ?? []).some((k) => norm(k).startsWith(q))) return 50;
  if ((def.keywords ?? []).some((k) => norm(k).includes(q))) return 40;
  if (norm(CATEGORY_LABELS[def.category]).includes(q)) return 30;
  if (norm(def.description).includes(q)) return 20;
  if (def.capabilities.some((c) => norm(c.label).includes(q))) return 10;
  return 0;
}

/** Apps that fit the chosen jobs, best first (popular before niche, available before soon). */
export function suggestedFor(jobs: string[], limit = 12, comingSoon?: ReadonlySet<string>): ConnectorDef[] {
  if (!jobs.length) return [];
  const want = new Set(jobs);
  return ALL_CONNECTORS.filter((c) => isAvailable(c, comingSoon) && !ALWAYS_ON.has(c.id) && c.id !== "custom_mcp" && (c.jobs ?? []).some((j) => want.has(j)))
    .map((c) => ({ c, score: (c.popular ? 10 : 0) + (c.jobs ?? []).filter((j) => want.has(j)).length * 3 + (isBuiltin(c) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name))
    .slice(0, limit)
    .map((x) => x.c);
}

/** Categories in display order with how many connectors each has. */
export function categoryCounts(): { id: ConnectorCategory; label: string; count: number }[] {
  const counts = new Map<ConnectorCategory, number>();
  for (const c of ALL_CONNECTORS) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
  return (Object.keys(CATEGORY_LABELS) as ConnectorCategory[])
    .filter((id) => counts.get(id))
    .map((id) => ({ id, label: CATEGORY_LABELS[id], count: counts.get(id)! }));
}

/** What a bot could do with these apps at each kind of effect, e.g. "Send email (Gmail)". */
export function capabilityExamples(defs: ConnectorDef[], effects: Effect[], max = 4): string[] {
  const out: string[] = [];
  const want = new Set(effects);
  // Round-robin across apps so one app doesn't take every slot.
  const queues = defs.map((d) => d.capabilities.filter((c) => want.has(c.effect)).map((c) => `${c.label} (${d.name})`));
  for (let i = 0; out.length < max && queues.some((q) => q.length > i); i++) {
    for (const q of queues) {
      if (q[i] && out.length < max) out.push(q[i]);
    }
  }
  return out;
}
