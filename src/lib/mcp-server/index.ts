/**
 * Our MCP server: a bot's tools, served over Streamable HTTP to any MCP client the owner points
 * at it (Settings → Use my bot's tools elsewhere).
 *
 * Dual-era and stateless (docs/research/mcp-and-brains-2026-10-14.md §1):
 *  - legacy clients (2025-xx): initialize → notifications/initialized → requests, no session id
 *  - modern clients (2026-07-28): server/discover + per-request _meta, no handshake
 * Every tools/call goes through the same policy engine, approvals and receipts as chat.
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema, type Db } from "@/lib/db";
import type { Bot, User } from "@/lib/db/schema";
import { appUrl, demoMode } from "@/lib/env";
import { sha256 } from "@/lib/crypto";
import { buildToolset } from "@/lib/tools/registry";
import { toolJsonSchema, type ToolContext } from "@/lib/tools/types";
import { executeToolCall, newRunState } from "@/lib/agent/run";

export const SUPPORTED_LEGACY = ["2025-11-25", "2025-06-18", "2025-03-26"];
export const MODERN = "2026-07-28";
const SERVER_INFO = { name: "build-a-bot", title: "Build-a-bot tools", version: "1.0.0" };
const INSTRUCTIONS =
  "These are the bot owner's tools. The server enforces the owner's trust settings: some calls return pending_approval (the owner was asked) or blocked. Never retry a blocked call; tell the owner instead.";

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

type Auth = { bot: Bot; owner: User };

function rpcResult(id: Rpc["id"], result: unknown, status = 200) {
  return Response.json({ jsonrpc: "2.0", id, result }, { status });
}

function rpcError(id: Rpc["id"], code: number, message: string, status = 200, data?: unknown) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } }, { status });
}

function unauthorized(message = "Invalid or expired token") {
  return new Response(JSON.stringify({ error: "invalid_token", error_description: message }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": `Bearer error="invalid_token", error_description="${message}"` },
  });
}

async function authenticate(db: Db, req: Request, botId: string): Promise<Auth | Response> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return unauthorized("Missing bearer token");

  // A long-lived per-bot token the owner created (Settings → Use my bot's tools elsewhere).
  const [bot] = await db.select().from(schema.bots).where(eq(schema.bots.id, botId)).limit(1);
  if (!bot?.mcpTokenHash || bot.mcpTokenHash !== sha256(token)) return unauthorized();
  const [owner] = await db.select().from(schema.users).where(eq(schema.users.id, bot.ownerId)).limit(1);
  if (!owner) return unauthorized();
  return { bot, owner };
}

export async function handleMcpRequest(req: Request, botId: string): Promise<Response> {
  // Browsers must not drive this endpoint from other sites.
  const origin = req.headers.get("origin");
  // Browsers send "null" (or worse) from sandboxed pages: an origin that isn't this site's is refused.
  const host = (() => {
    try {
      return new URL(origin ?? "").host;
    } catch {
      return null;
    }
  })();
  if (origin && host !== new URL(appUrl()).host) return new Response("Forbidden origin", { status: 403 });

  let body: Rpc;
  try {
    body = (await req.json()) as Rpc;
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  if (Array.isArray(body)) return rpcError(null, -32600, "Batching is not supported", 400);
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") return rpcError(null, -32600, "Invalid request", 400);

  const db = await getDb();
  const auth = await authenticate(db, req, botId);
  if (auth instanceof Response) return auth;

  const headerVersion = req.headers.get("mcp-protocol-version");
  const metaVersion = (body.params?._meta as Record<string, unknown> | undefined)?.["io.modelcontextprotocol/protocolVersion"] as string | undefined;
  const modern = headerVersion === MODERN || metaVersion === MODERN;
  if (modern && headerVersion && metaVersion && headerVersion !== metaVersion) {
    return rpcError(body.id, -32020, "MCP-Protocol-Version header does not match _meta", 400);
  }

  // Notifications get 202 with no body.
  if (body.id === undefined || body.id === null) return new Response(null, { status: 202 });

  const complete = (result: Record<string, unknown>) => (modern ? { resultType: "complete", ...result } : result);

  switch (body.method) {
    case "initialize": {
      const asked = String(body.params?.protocolVersion ?? "");
      const protocolVersion = SUPPORTED_LEGACY.includes(asked) ? asked : SUPPORTED_LEGACY[0];
      return rpcResult(body.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "server/discover":
      return rpcResult(body.id, {
        resultType: "complete",
        supportedVersions: [MODERN, ...SUPPORTED_LEGACY],
        capabilities: { tools: {} },
        _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO },
        instructions: INSTRUCTIONS,
        ttlMs: 300000,
        cacheScope: "private",
      });
    case "ping":
      return rpcResult(body.id, {});
    case "tools/list": {
      const ctx = toolContext(db, auth);
      const toolset = await buildToolset(ctx);
      const tools = toolset.tools.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description.slice(0, 2000),
        inputSchema: toolJsonSchema(t),
        annotations: {
          title: t.title,
          readOnlyHint: t.effect === "read",
          destructiveHint: t.effect === "delete",
          openWorldHint: t.effect !== "read" || Boolean(t.taints),
        },
        _meta: { "anthropic/alwaysLoad": true },
      }));
      return rpcResult(body.id, complete({ tools, ...(modern ? { ttlMs: 60000, cacheScope: "private" } : {}) }));
    }
    case "tools/call": {
      const name = String(body.params?.name ?? "");
      const args = (body.params?.arguments ?? {}) as Record<string, unknown>;
      const ctx = toolContext(db, auth);
      const toolset = await buildToolset(ctx);
      if (!toolset.byName.has(name)) return rpcError(body.id, -32602, `Unknown tool: ${name}`, modern ? 404 : 200);
      // Another AI app is outside our view of what it read: every call counts as tainted.
      const state = newRunState(true);
      const out = await executeToolCall(
        { id: `mcp_${Date.now().toString(36)}`, name, args, argsText: JSON.stringify(args) },
        toolset,
        ctx,
        state,
        () => {},
        "mcp",
      );
      let isError = Boolean(out.isError);
      try {
        const parsed = JSON.parse(out.content) as { status?: string };
        if (parsed.status === "blocked") isError = true;
      } catch {
        /* plain text result */
      }
      return rpcResult(body.id, complete({ content: [{ type: "text", text: out.content }], isError }));
    }
    default:
      return rpcError(body.id, -32601, `Method not found: ${body.method}`, modern ? 404 : 200);
  }
}

function toolContext(db: Db, auth: Auth): ToolContext {
  return {
    db,
    bot: auth.bot,
    owner: auth.owner,
    conversationId: null,
    channelKind: "mcp",
    demo: demoMode,
    now: new Date(),
  };
}
