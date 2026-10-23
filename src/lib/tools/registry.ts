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
import { connectorUsable } from "@/lib/connectors/availability";
import { demoToolsFor } from "@/lib/connectors/demo-tools";
import { demoMode } from "@/lib/env";
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
  // Sample data only while this server is in demo mode: out of it, the app needs a real sign-in.
  if (conn.status === "demo" || conn.mode === "demo") return demoMode ? demoToolsFor(def) : [];
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

/** Splits `room` between lists of these lengths as evenly as they can use it (one that needs less leaves the rest to the others). */
export function shareRoom(lengths: number[], room: number): number[] {
  const take = lengths.map(() => 0);
  let left = Math.max(0, room);
  let open = lengths.map((_, i) => i).filter((i) => lengths[i] > 0);
  while (left > 0 && open.length) {
    const each = Math.max(1, Math.floor(left / open.length));
    for (const i of open) {
      const add = Math.min(each, lengths[i] - take[i], left);
      take[i] += add;
      left -= add;
    }
    open = open.filter((i) => take[i] < lengths[i]);
  }
  return take;
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

  // Always on where this server can run them (web search needs Tavily), plus the built-ins the owner added.
  const enabledBuiltins = new Set<string>(
    DEFAULT_BUILTINS.filter((id) => {
      const def = getConnector(id);
      return def ? connectorUsable(def) : false;
    }),
  );
  for (const c of connections) {
    const def = getConnector(c.connectorId);
    // A built-in whose service isn't set up here ("Coming soon") gives the model no tools to promise with.
    if (def && isBuiltinConnector(def) && c.status !== "disabled" && connectorUsable(def)) enabledBuiltins.add(def.id);
  }

  // Look only: drop tools that act on the world (owner-only helpers stay).
  const allowed = (list: AnyToolSpec[]) => (trust === "look" ? list.filter((t) => t.effect === "read" || t.ownerOnly) : list);
  const builtins = allowed([...enabledBuiltins].flatMap((id) => BUILTIN_TOOLS[id] ?? []));

  const apps: Toolset["apps"] = [];
  const appTools: AnyToolSpec[][] = [];
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
      appTools.push(allowed(connTools));
      apps.push({
        id: def.id,
        name: `${def.name}${conn.status === "demo" || conn.mode === "demo" ? " (demo data)" : ""}`,
        summary: describeAccess(def.capabilities, trust, def.sensitive),
      });
    }
  }

  // Apps share the room the built-ins leave, so a second app isn't cut to a handful of tools. Each
  // app's list comes best first (pickTools), so its share is the start of it.
  const shares = shareRoom(appTools.map((list) => list.length), MAX_TOOLS - builtins.length);
  const tools = [...builtins, ...appTools.flatMap((list, i) => list.slice(0, shares[i]))];

  // De-duplicate names and cap the count (built-ins first, then connections in order).
  const seen = new Set<string>();
  const filtered = tools.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true))).slice(0, MAX_TOOLS);

  return { tools: filtered, byName: new Map(filtered.map((t) => [t.name, t])), apps, connections };
}
