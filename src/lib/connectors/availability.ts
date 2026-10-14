/**
 * What this server can really run. A built-in on one of our own services (web search on
 * Tavily, web actions on Browser Use, meeting notes on speech-to-text) is "Coming soon"
 * while that key is missing; demo mode simulates it instead. Server-only (reads the env):
 * pages pass the result to the builder and Apps & trust.
 */
import { available } from "@/lib/env";
import { BUILTIN_CONNECTORS } from "./builtin";
import type { ConnectorDef } from "./types";

/** Can a bot be given this connector here? */
export function connectorUsable(def: Pick<ConnectorDef, "status" | "requires">): boolean {
  return def.status !== "soon" && (!def.requires || available(def.requires));
}

/** Built-ins to show as "Coming soon" on this server (ids). */
export function comingSoonBuiltins(): string[] {
  return BUILTIN_CONNECTORS.filter((d) => d.status !== "soon" && !connectorUsable(d)).map((d) => d.id);
}
