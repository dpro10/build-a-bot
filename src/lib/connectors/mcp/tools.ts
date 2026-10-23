/**
 * Tools from a connected remote MCP server, wrapped as policy-checked ToolSpecs.
 */
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@/lib/db";
import type { Connection } from "@/lib/db/schema";
import type { ConnectorDef } from "../types";
import { safeToolName, type AnyToolSpec, type ToolContext } from "@/lib/tools/types";
import type { Recipient } from "@/lib/policy/engine";
import { callTool, listTools, McpAuthRequired, resultText, type McpTool } from "./client";
import { classifyTool, extractEmails, pickTools } from "./effects";
import { connectionAuth } from "./oauth";

const TOOLS_TTL_MS = 60 * 60 * 1000;
const MAX_TOOLS_PER_CONNECTION = 24;

type CachedTools = { at: number; tools: McpTool[] };

export async function refreshMcpTools(conn: Connection, ctx: Pick<ToolContext, "db">): Promise<McpTool[]> {
  const auth = await connectionAuth(ctx.db, conn);
  const url = String((conn.config as { url?: string }).url ?? "");
  const tools = await listTools({ url, token: auth.token, headers: auth.headers });
  await ctx.db
    .update(schema.connections)
    .set({ config: { ...conn.config, toolsCache: { at: Date.now(), tools } satisfies CachedTools }, status: "connected", error: null, updatedAt: new Date() })
    .where(eq(schema.connections.id, conn.id));
  return tools;
}

async function recipientsFor(args: Record<string, unknown>, ctx: ToolContext, def: ConnectorDef): Promise<Recipient[]> {
  const emails = extractEmails(args);
  if (!emails.length) return [{ address: `${def.name} audience`, kind: def.id, isOwner: false, isKnownContact: false }];
  const known = await ctx.db
    .select({ address: schema.contacts.address })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.botId, ctx.bot.id), inArray(schema.contacts.address, emails)));
  const knownSet = new Set(known.map((k) => k.address));
  return emails.map((address) => ({
    address,
    kind: "email",
    isOwner: address === ctx.owner.email?.toLowerCase(),
    isKnownContact: knownSet.has(address),
  }));
}

export async function mcpToolsForConnection(conn: Connection, def: ConnectorDef, ctx: ToolContext): Promise<AnyToolSpec[]> {
  const cache = (conn.config as { toolsCache?: CachedTools }).toolsCache;
  let tools: McpTool[];
  if (cache && Date.now() - cache.at < TOOLS_TTL_MS) tools = cache.tools;
  else {
    try {
      tools = await refreshMcpTools(conn, ctx);
    } catch (err) {
      if (err instanceof McpAuthRequired) {
        await ctx.db.update(schema.connections).set({ status: "needs_auth", error: "Sign in again" }).where(eq(schema.connections.id, conn.id));
      }
      tools = cache?.tools ?? [];
    }
  }

  const prefix = safeToolName(def.id).slice(0, 20);
  const url = String((conn.config as { url?: string }).url ?? "");
  const via = def.via.find((v) => v.kind === "mcp" && v.url === url);
  const filter = via && via.kind === "mcp" && via.toolFilter ? new RegExp(via.toolFilter, "i") : null;
  if (filter) tools = tools.filter((t) => filter.test(t.name));
  const about = (tool: McpTool) => ({ name: tool.name, effect: classifyTool(tool.name, tool.annotations).effect });
  return pickTools(tools, MAX_TOOLS_PER_CONNECTION, about, ctx.bot.trust === "look").map((tool) => {
    const { effect, risk } = classifyTool(tool.name, tool.annotations);
    const name = safeToolName(`${prefix}__${tool.name}`);
    const schemaJson = tool.inputSchema && (tool.inputSchema as { type?: string }).type === "object" ? tool.inputSchema : { type: "object", properties: {} };
    const spec: AnyToolSpec = {
      name,
      title: tool.title || tool.annotations?.title || `${def.name}: ${tool.name.replace(/[_-]/g, " ")}`,
      description: `${def.name} — ${(tool.description ?? tool.name).slice(0, 1500)}`,
      input: z.record(z.string(), z.unknown()),
      jsonSchema: schemaJson,
      connectorId: def.id,
      capabilityId: def.capabilities.find((c) => c.effect === effect)?.id,
      effect,
      risk,
      sensitive: def.sensitive,
      // Whatever an app sends back can carry other people's words (an email, a comment, an invite).
      taints: true,
      recipients: effect === "send" || effect === "admin" ? (args, c) => recipientsFor(args, c, def) : undefined,
      outboundText: (args) => JSON.stringify(args).slice(0, 20000),
      summarize: (args) => `${def.name}: ${tool.title ?? tool.name.replace(/[_-]/g, " ")}${summarizeArgs(args)}`,
      async run(args, c) {
        const auth = await connectionAuth(c.db, conn);
        const url = String((conn.config as { url?: string }).url ?? "");
        try {
          const result = await callTool({ url, token: auth.token, headers: auth.headers }, tool.name, args);
          const text = resultText(result);
          return result.isError ? { ok: false, error: text || "The app reported an error." } : { ok: true, content: text || "(no output)", summary: "Done" };
        } catch (err) {
          if (err instanceof McpAuthRequired) {
            await c.db.update(schema.connections).set({ status: "needs_auth", error: "Sign in again" }).where(eq(schema.connections.id, conn.id));
            return { ok: false, error: `${def.name} needs you to sign in again, in Apps & trust.` };
          }
          return { ok: false, error: (err as Error).message.slice(0, 300) };
        }
      },
    };
    return spec;
  });
}

function summarizeArgs(args: Record<string, unknown>): string {
  const first = Object.entries(args).find(([, v]) => typeof v === "string" && v.length > 0);
  return first ? ` — “${String(first[1]).slice(0, 60)}”` : "";
}
