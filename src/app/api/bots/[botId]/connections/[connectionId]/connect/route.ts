import { z } from "zod";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { appUrl, isProduction, live } from "@/lib/env";
import { connectWithToken, startMcpOAuth, type StartResult } from "@/lib/connectors/mcp/oauth";
import { McpAuthRequired } from "@/lib/connectors/mcp/client";
import { refreshMcpTools } from "@/lib/connectors/mcp/tools";
import { COMPOSIO_PENDING_COOKIE, startComposioConnection } from "@/lib/connectors/composio";
import { composioCanConnect } from "@/lib/connectors/composio-auth";
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
  const def = getConnector(connection.connectorId);
  // The catalog's Composio toolkit for this app (a demo connection has none stored yet).
  const via = def?.via.find((v) => v.kind === "composio");
  const toolkit = (connection.config as { toolkit?: string }).toolkit ?? (via?.kind === "composio" ? via.toolkit : undefined);

  const startComposio = async (slug: string) => {
    if (!composioCanConnect(slug)) return apiError(409, `${def?.name ?? "This app"} is coming soon.`);
    const url = await startComposioConnection(a.db, { ...connection, config: { ...connection.config, toolkit: slug } }, `${appUrl()}/api/connectors/composio/callback?c=${connectionId}`);
    // Composio's callback identity check (connectors/composio/verify) reads this to know whose sign-in it is.
    (await cookies()).set(COMPOSIO_PENDING_COOKIE, connectionId, { httpOnly: true, secure: isProduction, sameSite: "lax", path: "/api/connectors/composio", maxAge: 15 * 60 });
    return json({ redirect: url });
  };

  try {
    if (parsed.data.method === "token") {
      if (!parsed.data.token) return apiError(422, "Paste the token.");
      await connectWithToken(a.db, { ownerId: a.user.id, connection, token: parsed.data.token });
      const [fresh] = await a.db.select().from(schema.connections).where(eq(schema.connections.id, connectionId)).limit(1);
      const tools = await refreshMcpTools(fresh, { db: a.db }).catch(() => null);
      return json({ connected: true, tools: tools?.length ?? null });
    }
    if (parsed.data.method === "composio") {
      if (!toolkit) return apiError(409, "This app can't be connected that way.");
      return await startComposio(toolkit);
    }
    const started: StartResult = await startMcpOAuth(a.db, { ownerId: a.user.id, botId, connection, redirectTo: back }).catch((err: Error) => ({
      kind: "error" as const,
      message: err.message.slice(0, 300),
    }));
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
    // Its own sign-in didn't work out (some only let in apps they've approved): Composio's, if it has one.
    if (live.composio && toolkit && composioCanConnect(toolkit)) return await startComposio(toolkit);
    return apiError(409, started.message);
  } catch (err) {
    return apiError(502, (err as Error).message.slice(0, 300));
  }
}
