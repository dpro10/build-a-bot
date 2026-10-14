/**
 * What this server can really run. A built-in on one of our own services (web search on
 * Tavily, web actions on Browser Use, meeting notes on speech-to-text) is "Coming soon"
 * while that key is missing, and so is an app nobody can sign in to here yet (one that only
 * goes through Composio, without Composio or without an OAuth app of Composio's for it).
 * Demo mode simulates them instead. Server-only (reads the env): pages pass the result to
 * the builder and Apps & trust.
 */
import { available, demoMode, live } from "@/lib/env";
import { composioCanConnect } from "./composio-auth";
import { ALL_CONNECTORS } from "./index";
import type { ConnectorDef, ConnectorVia } from "./types";

/**
 * How to sign in to a third-party app here: the catalog's first usable route, except that a
 * one-click Composio sign-in beats pasting a token.
 */
export function connectVia(def: Pick<ConnectorDef, "via">): ConnectorVia | undefined {
  const usable = def.via.filter(
    (v) => v.kind === "mcp" || v.kind === "custom_mcp" || (v.kind === "composio" && live.composio && composioCanConnect(v.toolkit)),
  );
  const first = usable[0];
  if (first?.kind === "mcp" && first.auth === "bearer") return usable.find((v) => v.kind === "composio") ?? first;
  return first;
}

/** Can a bot be given this connector here? */
export function connectorUsable(def: Pick<ConnectorDef, "status" | "requires" | "via">): boolean {
  if (def.status === "soon" || (def.requires && !available(def.requires))) return false;
  if (def.via.some((v) => v.kind === "builtin")) return true;
  return demoMode || Boolean(connectVia(def));
}

/** Connectors to show as "Coming soon" on this server (ids), beyond those the catalog marks so. */
export function comingSoonConnectors(): string[] {
  return ALL_CONNECTORS.filter((d) => d.status !== "soon" && !connectorUsable(d)).map((d) => d.id);
}
