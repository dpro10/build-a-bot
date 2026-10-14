/**
 * Builds the toolset a bot gets for one run: built-ins + its connections
 * (demo, remote MCP, Composio), filtered by trust level, plus a plain-language
 * summary of each connected app for the system prompt.
 */
import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import type { Connection } from "@/lib/db/schema";
import { DEFAULT_BUILTINS } from "@/lib/connectors/builtin";
import { getConnector, isBuiltinConnector } from "@/lib/connectors";
import { demoToolsFor } from "@/lib/connectors/demo-tools";
import { evaluate } from "@/lib/policy/engine";
import { isTrustLevel, type TrustLevel } from "@/lib/trust";
import { BUILTIN_TOOLS } from "./builtin";
import type { AnyToolSpec, ToolContext } from "./types";

export type Toolset = {
  tools: AnyToolSpec[];
  byName: Map<string, AnyToolSpec>;
  apps: { id: string; name: string; summary: string }[];
  connections: Connection[];
};

/** Hard cap so prompts stay small and models choose well. */
export const MAX_TOOLS = 48;

async function connectionTools(conn: Connection, ctx: ToolContext): Promise<AnyToolSpec[]> {
  const def = getConnector(conn.connectorId);
  if (!def) return [];
  if (conn.status === "demo" || conn.mode === "demo") return demoToolsFor(def);
  if (conn.status !== "connected") return [];
  if (conn.mode === "mcp") {
    const { mcpToolsForConnection } = await import("@/lib/connectors/mcp/tools");
    return mcpToolsForConnection(conn, def, ctx);
  }
  if (conn.mode === "composio") {
    const { composioToolsForConnection } = await import("@/lib/connectors/composio");
    return composioToolsForConnection(conn, def, ctx);
  }
  return [];
}

function describeAccess(capabilities: { label: string; effect: string; risk: string }[], trust: TrustLevel, sensitive?: boolean) {
  return capabilities
    .map((cap) => {
      const d = evaluate({
        trust,
        paused: false,
        effect: cap.effect as never,
        risk: cap.risk as never,
        sensitive,
        tainted: false,
        actionsToday: 0,
      });
      const tag = d.verdict === "allow" ? "" : d.verdict === "ask" ? " (asks owner first)" : " (not allowed)";
      return `${cap.label.toLowerCase()}${tag}`;
    })
    .join(", ");
}

export async function buildToolset(ctx: ToolContext): Promise<Toolset> {
  const trust: TrustLevel = isTrustLevel(ctx.bot.trust) ? ctx.bot.trust : "ask";
  const connections = await ctx.db.select().from(schema.connections).where(eq(schema.connections.botId, ctx.bot.id));

  const enabledBuiltins = new Set<string>(DEFAULT_BUILTINS);
  for (const c of connections) {
    const def = getConnector(c.connectorId);
    if (def && isBuiltinConnector(def) && c.status !== "disabled") enabledBuiltins.add(def.id);
  }

  const tools: AnyToolSpec[] = [];
  for (const id of enabledBuiltins) tools.push(...(BUILTIN_TOOLS[id] ?? []));

  const apps: Toolset["apps"] = [];
  for (const conn of connections) {
    const def = getConnector(conn.connectorId);
    if (!def || isBuiltinConnector(def) || conn.status === "disabled") continue;
    let connTools: AnyToolSpec[] = [];
    try {
      connTools = await connectionTools(conn, ctx);
    } catch {
      connTools = [];
    }
    if (connTools.length) {
      tools.push(...connTools);
      apps.push({
        id: def.id,
        name: `${def.name}${conn.status === "demo" || conn.mode === "demo" ? " (demo data)" : ""}`,
        summary: describeAccess(def.capabilities, trust, def.sensitive),
      });
    }
  }

  // Look only: drop tools that act on the world (owner-only helpers stay).
  let filtered = trust === "look" ? tools.filter((t) => t.effect === "read" || t.ownerOnly) : tools;

  // De-duplicate names and cap the count (built-ins first, then connections in order).
  const seen = new Set<string>();
  filtered = filtered.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true))).slice(0, MAX_TOOLS);

  return { tools: filtered, byName: new Map(filtered.map((t) => [t.name, t])), apps, connections };
}
