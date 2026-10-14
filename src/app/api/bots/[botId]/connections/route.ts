import { z } from "zod";
import { and, count, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { getConnector, isBuiltinConnector } from "@/lib/connectors";
import { getPlan } from "@/lib/billing/plans";
import { demoMode, live } from "@/lib/env";
import { canonicalResource } from "@/lib/connectors/mcp/oauth";
import { newId } from "@/lib/utils";
import { receipt } from "@/lib/agent/run";

export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ connectorId: z.string().max(80), url: z.string().url().max(500).optional(), name: z.string().max(60).optional() }));
  if (!parsed.ok) return parsed.res;

  let connectorId = parsed.data.connectorId;
  let config: Record<string, unknown> = {};
  if (connectorId === "custom_mcp") {
    if (!parsed.data.url || !/^https:\/\//.test(parsed.data.url)) return apiError(422, "Paste the server's https:// URL.");
    const resource = canonicalResource(parsed.data.url);
    connectorId = `custom_mcp:${new URL(resource).host}${new URL(resource).pathname}`.slice(0, 80);
    config = { url: parsed.data.url, auth: "unknown", name: parsed.data.name ?? new URL(resource).host };
  }
  const def = getConnector(connectorId);
  if (!def && !connectorId.startsWith("custom_mcp:")) return apiError(404, "Unknown connector");
  if (def?.status === "soon") return apiError(409, `${def.name} is coming soon.`);

  const plan = getPlan(a.user.plan);
  if (def && !isBuiltinConnector(def) && !demoMode) {
    const [{ n }] = await a.db.select({ n: count() }).from(schema.connections).where(eq(schema.connections.botId, botId));
    if (n >= plan.limits.connectors + 12) return apiError(402, `The ${plan.name} plan connects ${plan.limits.connectors} apps. Upgrade to add more.`, { upgrade: "plus" });
  }

  let mode = "builtin";
  let status = "connected";
  if (def && !isBuiltinConnector(def)) {
    const via = def.via.find((v) => v.kind === "mcp" || (v.kind === "composio" && live.composio) || v.kind === "custom_mcp");
    if (connectorId.startsWith("custom_mcp:")) {
      mode = "mcp";
      status = "needs_auth";
    } else if (demoMode && via?.kind !== "composio") {
      mode = "demo";
      status = "demo";
      if (via?.kind === "mcp") config = { url: via.url, auth: via.auth, ...(via.headers ? { headers: via.headers } : {}) };
    } else if (via?.kind === "mcp") {
      mode = "mcp";
      status = "needs_auth";
      config = { url: via.url, auth: via.auth, ...(via.headers ? { headers: via.headers } : {}) };
    } else if (via?.kind === "composio") {
      mode = "composio";
      status = "needs_auth";
      config = { toolkit: via.toolkit };
    } else {
      return apiError(409, `${def.name} can't be connected on this server yet.`);
    }
  }
  const [existing] = await a.db.select().from(schema.connections).where(and(eq(schema.connections.botId, botId), eq(schema.connections.connectorId, connectorId))).limit(1);
  if (existing) {
    if (existing.status === "disabled") {
      const [revived] = await a.db
        .update(schema.connections)
        .set({ status: existing.credentialId ? "connected" : status, updatedAt: new Date() })
        .where(eq(schema.connections.id, existing.id))
        .returning();
      return json({ connection: revived ?? existing });
    }
    return json({ connection: existing });
  }
  const [connection] = await a.db.insert(schema.connections).values({ id: newId("con"), botId, connectorId, mode, status, config }).returning();
  await receipt(a.db, a.bot, "system", "ok", `Connected ${def?.name ?? connectorId}${status === "demo" ? " (demo)" : status === "needs_auth" ? " — waiting for sign-in" : ""}`, { connectorId, mode });
  return json({ connection });
}
