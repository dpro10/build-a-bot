/**
 * View models and pure helpers for the "Apps & trust" page. No browser APIs here:
 * the server page uses these to shape data, the client components to render it.
 */
import { getConnector, type ConnectorDef } from "@/lib/connectors";
import type { Capability, Effect } from "@/lib/connectors/types";
import { ALWAYS_ON, isBuiltin } from "@/components/catalog/connector-meta";
import { evaluate, type Verdict } from "@/lib/policy/engine";
import type { TrustLevel } from "@/lib/trust";

export type Permission = Verdict; // "allow" | "ask" | "deny" ("deny" shows as "Off")
export type ConnectionStatus = "connected" | "needs_auth" | "error" | "demo" | "disabled";
export type ConnectionMode = "builtin" | "mcp" | "composio" | "demo";

export type ConnectionView = {
  id: string;
  connectorId: string;
  status: ConnectionStatus;
  mode: ConnectionMode;
  error: string | null;
  permissions: Record<string, Permission>;
  /** Only the non-secret bits the UI needs (server URL, auth style, display name). */
  config: { url?: string; auth?: string; name?: string; toolkit?: string };
  hasCredential: boolean;
  createdAt: string;
};

export type LimitsView = {
  dailyActions?: number;
  spendCapUsd?: number;
  quietHours?: { start: string; end: string } | null;
};

const STATUSES: ConnectionStatus[] = ["connected", "needs_auth", "error", "demo", "disabled"];
const MODES: ConnectionMode[] = ["builtin", "mcp", "composio", "demo"];

/** Shape a connection row (from the DB or an API response) for the browser. */
export function toConnectionView(row: {
  id: string;
  connectorId: string;
  status: string;
  mode: string;
  error?: string | null;
  permissions?: unknown;
  config?: unknown;
  credentialId?: string | null;
  createdAt?: Date | string | null;
}): ConnectionView {
  const cfg = (row.config ?? {}) as Record<string, unknown>;
  const perms = (row.permissions ?? {}) as Record<string, unknown>;
  const permissions: Record<string, Permission> = {};
  for (const [k, v] of Object.entries(perms)) if (v === "allow" || v === "ask" || v === "deny") permissions[k] = v;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return {
    id: row.id,
    connectorId: row.connectorId,
    status: (STATUSES as string[]).includes(row.status) ? (row.status as ConnectionStatus) : "error",
    mode: (MODES as string[]).includes(row.mode) ? (row.mode as ConnectionMode) : "mcp",
    error: row.error ?? null,
    permissions,
    config: { url: str(cfg.url), auth: str(cfg.auth), name: str(cfg.name), toolkit: str(cfg.toolkit) },
    hasCredential: Boolean(row.credentialId),
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date(0).toISOString(),
  };
}

export function connectorFor(conn: Pick<ConnectionView, "connectorId">): ConnectorDef | undefined {
  return getConnector(conn.connectorId);
}

/** What to call it: the name the owner gave a custom server, else the catalog name. */
export function displayName(conn: ConnectionView, def: ConnectorDef | undefined): string {
  if (conn.connectorId.startsWith("custom_mcp:") && conn.config.name) return conn.config.name;
  return def?.name ?? conn.connectorId;
}

export function isCustomServer(conn: Pick<ConnectionView, "connectorId">): boolean {
  return conn.connectorId.startsWith("custom_mcp:");
}

export type ConnectPlan =
  | { kind: "oauth" }
  | { kind: "token"; label: string; url?: string }
  | { kind: "composio" };

/**
 * How this connection can be signed in for real, or null when there's no way on this
 * server (e.g. an app that only works through Composio while Composio isn't set up).
 */
export function connectPlan(conn: ConnectionView, def: ConnectorDef | undefined, composioLive: boolean): ConnectPlan | null {
  if (conn.mode === "builtin") return null;
  if (conn.mode === "composio") return { kind: "composio" };
  if (conn.config.url) {
    if (conn.config.auth === "bearer") {
      const via = def?.via.find((v) => v.kind === "mcp" && v.auth === "bearer");
      const label = via && via.kind === "mcp" ? via.tokenLabel : undefined;
      const url = via && via.kind === "mcp" ? via.tokenUrl : undefined;
      return { kind: "token", label: label ?? "Access token", url };
    }
    return { kind: "oauth" };
  }
  if (composioLive && def?.via.some((v) => v.kind === "composio")) return { kind: "composio" };
  return null;
}

export const STATUS_ORDER: Record<ConnectionStatus, number> = { error: 0, needs_auth: 1, connected: 2, demo: 3, disabled: 4 };

/** Connections split for display: third-party apps, optional built-ins, always-included ones. */
export function groupConnections(connections: ConnectionView[]) {
  const apps: ConnectionView[] = [];
  const builtins: ConnectionView[] = [];
  for (const c of connections) {
    const def = connectorFor(c);
    if (def && isBuiltin(def)) {
      if (!ALWAYS_ON.has(def.id)) builtins.push(c);
    } else apps.push(c);
  }
  apps.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.createdAt.localeCompare(b.createdAt));
  return { apps, builtins };
}

/**
 * Capabilities whose tools always wait for the owner's tap at every trust level
 * (the runtime marks them `alwaysAsk`, e.g. submitting a form on a website after a preview).
 */
const ALWAYS_ASK: Record<string, string[]> = { browser: ["fill_forms"] };

export function isAlwaysAsk(def: Pick<ConnectorDef, "id">, cap: Capability): boolean {
  return Boolean((cap as Capability & { alwaysAsk?: boolean }).alwaysAsk) || (ALWAYS_ASK[def.id] ?? []).includes(cap.id);
}

type PolicyDef = Pick<ConnectorDef, "id" | "sensitive">;

function policyContext(trust: TrustLevel, def: PolicyDef, cap: Capability, spendCapUsd: number | undefined) {
  return {
    trust,
    paused: false,
    effect: cap.effect,
    risk: cap.risk,
    sensitive: def.sensitive,
    alwaysAsk: isAlwaysAsk(def, cap),
    tainted: false,
    actionsToday: 0,
    // No app tells us a price up front, so a purchase always shows as asking first.
    amountUsd: undefined,
    spendCapUsd,
    spentThisMonthUsd: 0,
  };
}

/** What the trust level alone implies for a capability (no owner rule). */
export function trustDefault(trust: TrustLevel, def: PolicyDef, cap: Capability, spendCapUsd: number | undefined): Permission {
  return evaluate(policyContext(trust, def, cap, spendCapUsd)).verdict;
}

/** What actually happens with the owner's rule applied (hard floors included). */
export function effectiveVerdict(trust: TrustLevel, def: PolicyDef, cap: Capability, spendCapUsd: number | undefined, rule: Permission | undefined): Permission {
  return evaluate({ ...policyContext(trust, def, cap, spendCapUsd), ownerRule: rule }).verdict;
}

/** Choices that can't take effect for this capability right now, with the reason. */
export function lockedChoices(trust: TrustLevel, def: PolicyDef, cap: Capability, spendCapUsd: number | undefined): Partial<Record<Permission, string>> {
  if (cap.effect === "read" && !isAlwaysAsk(def, cap)) return {};
  if (trust === "look" && cap.effect !== "read") {
    const why = "Look only: it can read but never act. Change trust above to let it do more.";
    return { allow: why, ask: why };
  }
  if (isAlwaysAsk(def, cap)) return { allow: "This always shows you a preview and waits for your tap, at every trust level." };
  if (cap.effect === "spend") {
    if (!spendCapUsd || spendCapUsd <= 0) {
      const why = "Money is off until you set a monthly spending cap.";
      return { allow: why, ask: why };
    }
    return { allow: "Every purchase asks you first: apps don't say what something costs until you see it." };
  }
  if (def.sensitive) return { allow: "This app holds money, health or identity data, so changes always ask you first." };
  return {};
}

export const PERMISSION_LABEL: Record<Permission, string> = { allow: "Allow", ask: "Ask", deny: "Off" };

export const EFFECT_ORDER: Effect[] = ["read", "write", "send", "delete", "spend", "admin"];

/** "4 on its own · 2 ask first · 1 off" */
export function permissionSummary(
  trust: TrustLevel,
  def: ConnectorDef,
  permissions: Record<string, Permission>,
  spendCapUsd: number | undefined,
): { allow: number; ask: number; deny: number; custom: number } {
  const out = { allow: 0, ask: 0, deny: 0, custom: 0 };
  for (const cap of def.capabilities) {
    const rule = permissions[cap.id];
    if (rule) out.custom++;
    out[effectiveVerdict(trust, def, cap, spendCapUsd, rule)]++;
  }
  return out;
}
