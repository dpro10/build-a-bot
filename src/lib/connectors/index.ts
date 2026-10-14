import { BUILTIN_CONNECTORS } from "./builtin";
import { CONNECTORS } from "./catalog";
import type { ConnectorDef } from "./types";

/**
 * Connectors that share one toolkit/server only see their own slice of its tools
 * (e.g. Outlook Calendar must not get Outlook's send-mail tools).
 */
const TOOL_FILTERS: Record<string, string> = {
  outlook_calendar: "calendar|event|meeting|schedule|availability|free_?busy|attendee|room",
  microsoft_word: "doc|word|file|item|search|download|upload|share|folder",
  jira: "jira|issue|project|sprint|board|transition|worklog|filter|user|search|comment",
  confluence: "confluence|page|space|content|blog|search|comment|label|attachment",
  bitbucket: "bitbucket|repo|pull|commit|branch|pipeline|workspace",
};

function withFilters(c: ConnectorDef): ConnectorDef {
  const filter = TOOL_FILTERS[c.id];
  if (!filter) return c;
  return { ...c, via: c.via.map((v) => (v.kind === "mcp" || v.kind === "composio" ? { ...v, toolFilter: v.toolFilter ?? filter } : v)) };
}

export const ALL_CONNECTORS: ConnectorDef[] = [...BUILTIN_CONNECTORS, ...CONNECTORS.map(withFilters)];

export const CONNECTOR_BY_ID: Record<string, ConnectorDef> = Object.fromEntries(ALL_CONNECTORS.map((c) => [c.id, c]));

/** What to call a connection: the name the owner gave a custom MCP server, else the catalog's. */
export function connectionName(c: { connectorId: string; config?: unknown }): string {
  const given = (c.config as { name?: unknown } | null)?.name;
  if (c.connectorId.startsWith("custom_mcp:") && typeof given === "string" && given.trim()) return given.trim();
  return getConnector(c.connectorId)?.name ?? c.connectorId;
}

export function getConnector(id: string): ConnectorDef | undefined {
  if (CONNECTOR_BY_ID[id]) return CONNECTOR_BY_ID[id];
  if (id.startsWith("custom_mcp:")) {
    const label = id.slice("custom_mcp:".length).split("/")[0];
    return {
      id,
      name: label,
      category: "custom",
      description: "A custom MCP server you connected",
      icon: { lucide: "Plug", color: "64748B" },
      via: [{ kind: "custom_mcp" }],
      capabilities: [
        { id: "read", label: "Use its read tools", effect: "read", risk: "low" },
        { id: "write", label: "Use its action tools", effect: "write", risk: "medium" },
      ],
    };
  }
  return undefined;
}

export function isBuiltinConnector(def: ConnectorDef): boolean {
  return def.via.some((v) => v.kind === "builtin");
}

export { BUILTIN_CONNECTORS, CONNECTORS };
export type { ConnectorDef };
