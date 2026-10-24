import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { receipt } from "@/lib/agent/run";
import { getConnector } from "@/lib/connectors";
import { revokeComposioConnection } from "@/lib/connectors/composio";

type Ctx = RouteCtx<{ botId: string; connectionId: string }>;

async function load(ctx: Ctx) {
  const { botId, connectionId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a;
  const [connection] = await a.db.select().from(schema.connections).where(and(eq(schema.connections.id, connectionId), eq(schema.connections.botId, botId))).limit(1);
  if (!connection) return { ok: false as const, res: apiError(404, "Connection not found") };
  return { ...a, connection };
}

/** Owner rules per capability ("allow" / "ask" / "deny"), or pause one app. */
export async function PATCH(req: Request, ctx: Ctx) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const l = await load(ctx);
  if (!l.ok) return l.res;
  const parsed = await parseJson(
    req,
    z.object({ permissions: z.record(z.string(), z.enum(["allow", "ask", "deny"])).optional(), enabled: z.boolean().optional() }),
  );
  if (!parsed.ok) return parsed.res;
  const updates: Partial<typeof schema.connections.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.permissions) updates.permissions = parsed.data.permissions;
  if (parsed.data.enabled !== undefined) {
    updates.status = parsed.data.enabled ? (l.connection.mode === "demo" ? "demo" : l.connection.credentialId || l.connection.mode === "builtin" ? "connected" : "needs_auth") : "disabled";
  }
  const [connection] = await l.db.update(schema.connections).set(updates).where(eq(schema.connections.id, l.connection.id)).returning();
  const name = getConnector(connection.connectorId)?.name ?? connection.connectorId;
  await receipt(l.db, l.bot, "system", "ok", `${name}: ${parsed.data.permissions ? "permissions changed" : parsed.data.enabled ? "turned on" : "turned off"}`, {
    connectorId: connection.connectorId,
    ...(parsed.data.permissions ? { permissions: parsed.data.permissions } : {}),
  });
  return json({ connection });
}

export async function DELETE(req: Request, ctx: Ctx) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const l = await load(ctx);
  if (!l.ok) return l.res;
  // Composio forgets the sign-in too, so the bot's access to the account ends there as well.
  if (l.connection.mode === "composio") await revokeComposioConnection(l.connection);
  await l.db.delete(schema.connections).where(eq(schema.connections.id, l.connection.id));
  if (l.connection.credentialId) await l.db.delete(schema.credentials).where(eq(schema.credentials.id, l.connection.credentialId));
  await receipt(l.db, l.bot, "system", "ok", `Disconnected ${getConnector(l.connection.connectorId)?.name ?? l.connection.connectorId}`, { connectorId: l.connection.connectorId });
  return json({ ok: true });
}
