import { z } from "zod";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { CHANNEL_KINDS } from "@/lib/channels/catalog";
import { channelAction } from "@/lib/channels/setup";
import { getBotSetup } from "@/lib/data";

export async function GET(_req: Request, ctx: RouteCtx<{ botId: string }>) {
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const { channels } = await getBotSetup(a.db, botId);
  return json({ channels: channels.map((c) => ({ ...c, credentialId: c.credentialId ? "set" : null, config: { simulated: (c.config as { simulated?: boolean }).simulated ?? false } })) });
}

export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ kind: z.enum(CHANNEL_KINDS), action: z.string().min(2).max(30), payload: z.record(z.string(), z.unknown()).optional() }));
  if (!parsed.ok) return parsed.res;
  const result = await channelAction(a.db, a.user, a.bot, parsed.data.kind, parsed.data.action, parsed.data.payload ?? {});
  if (!result.ok) return apiError(result.status ?? 400, result.error);
  return json({ ok: true, ...(result.data ?? {}) });
}
