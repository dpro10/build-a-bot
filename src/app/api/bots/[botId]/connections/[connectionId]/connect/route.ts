import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { appUrl } from "@/lib/env";
import { connectWithToken, startMcpOAuth } from "@/lib/connectors/mcp/oauth";
import { McpAuthRequired } from "@/lib/connectors/mcp/client";
import { refreshMcpTools } from "@/lib/connectors/mcp/tools";
import { startComposioConnection } from "@/lib/connectors/composio";
import { getConnector } from "@/lib/connectors";

export const maxDuration = 60;

/** Start sign-in for a connection: MCP OAuth, a pasted token, or Composio's hosted flow. */
export async function POST(req: Request, ctx: RouteCtx<{ botId: string; connectionId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId, connectionId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ method: z.enum(["oauth", "token", "composio", "none"]), token: z.string().min(8).max(2000).optional() }));
  if (!parsed.ok) return parsed.res;
  const [connection] = await a.db.select().from(schema.connections).where(and(eq(schema.connections.id, connectionId), eq(schema.connections.botId, botId))).limit(1);
  if (!connection) return apiError(404, "Connection not found");
  const back = `/app/bots/${botId}/tools`;

  try {
    if (parsed.data.method === "token") {
      if (!parsed.data.token) return apiError(422, "Paste the token.");
      await connectWithToken(a.db, { ownerId: a.user.id, connection, token: parsed.data.token });
      const [fresh] = await a.db.select().from(schema.connections).where(eq(schema.connections.id, connectionId)).limit(1);
      const tools = await refreshMcpTools(fresh, { db: a.db }).catch(() => null);
      return json({ connected: true, tools: tools?.length ?? null });
    }
    if (parsed.data.method === "composio") {
      // A demo connection has no toolkit yet: take it from the catalog ("Connect for real").
      let target = connection;
      if (!(connection.config as { toolkit?: string }).toolkit) {
        const via = getConnector(connection.connectorId)?.via.find((v) => v.kind === "composio");
        if (!via || via.kind !== "composio") return apiError(409, "This app can't be connected that way.");
        target = { ...connection, config: { ...connection.config, toolkit: via.toolkit } };
      }
      const url = await startComposioConnection(a.db, target, `${appUrl()}/api/connectors/composio/callback?c=${connectionId}`);
      return json({ redirect: url });
    }
    const started = await startMcpOAuth(a.db, { ownerId: a.user.id, botId, connection, redirectTo: back });
    if (started.kind === "redirect") return json({ redirect: started.url });
    if (started.kind === "no_auth") {
      // Connected only once its tools really load: refreshMcpTools marks it connected.
      let tools;
      try {
        tools = await refreshMcpTools(connection, { db: a.db });
      } catch (err) {
        if (err instanceof McpAuthRequired) return apiError(409, "That server asks for a sign-in. Use an access token instead.");
        throw err;
      }
      // mode "mcp": a demo connection connected for real must stop serving sample data.
      await a.db.update(schema.connections).set({ mode: "mcp", updatedAt: new Date() }).where(eq(schema.connections.id, connectionId));
      return json({ connected: true, tools: tools.length });
    }
    return apiError(409, started.message);
  } catch (err) {
    return apiError(502, (err as Error).message.slice(0, 300));
  }
}
