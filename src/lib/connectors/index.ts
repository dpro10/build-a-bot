import { BUILTIN_CONNECTORS } from "./builtin";
import { CONNECTORS } from "./catalog";
import type { ConnectorDef } from "./types";

export const ALL_CONNECTORS: ConnectorDef[] = [...BUILTIN_CONNECTORS, ...CONNECTORS];

export const CONNECTOR_BY_ID: Record<string, ConnectorDef> = Object.fromEntries(ALL_CONNECTORS.map((c) => [c.id, c]));

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
