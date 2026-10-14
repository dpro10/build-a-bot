import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, sameOrigin, type RouteCtx } from "@/lib/api";
import { randomToken, sha256 } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { receipt } from "@/lib/agent/run";

/** Create (or rotate) a token so the owner can use this bot's tools from any MCP client. */
export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const token = `bab_mcp_${randomToken(32)}`;
  await a.db.update(schema.bots).set({ mcpTokenHash: sha256(token) }).where(eq(schema.bots.id, botId));
  await receipt(a.db, a.bot, "system", "ok", "Created a token to use this bot's tools elsewhere", {});
  const url = `${appUrl()}/api/mcp/${botId}`;
  return json({
    token,
    url,
    snippets: {
      claudeCode: `claude mcp add --transport http ${a.bot.handle.replace(/-/g, "_")} ${url} --header "Authorization: Bearer ${token}"`,
      json: { mcpServers: { [a.bot.handle]: { type: "http", url, headers: { Authorization: `Bearer ${token}` } } } },
    },
  });
}

export async function DELETE(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  await a.db.update(schema.bots).set({ mcpTokenHash: null }).where(eq(schema.bots.id, botId));
  if (a.bot.mcpTokenHash) await receipt(a.db, a.bot, "system", "ok", "Revoked the token for using this bot's tools elsewhere", {});
  return json({ ok: true });
}
