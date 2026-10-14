import { z } from "zod";
import { apiError, authedBot, clientIp, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { CHANNEL_BY_KIND, CHANNEL_KINDS } from "@/lib/channels/catalog";
import { channelAction, type SetupResult } from "@/lib/channels/setup";
import { getBotSetup } from "@/lib/data";

export async function GET(_req: Request, ctx: RouteCtx<{ botId: string }>) {
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const { channels } = await getBotSetup(a.db, botId);
  return json({ channels: channels.map((c) => ({ ...c, credentialId: c.credentialId ? "set" : null, config: publicChannelConfig(c.config) })) });
}

/** The non-secret bits of a channel's config the app shows (never tokens or webhook secrets). */
function publicChannelConfig(config: unknown) {
  const c = (config ?? {}) as { simulated?: boolean; locked?: boolean; pendingOwnerAddress?: string | null; username?: string };
  return {
    simulated: c.simulated ?? false,
    locked: c.locked ?? false,
    pendingOwnerAddress: typeof c.pendingOwnerAddress === "string" ? c.pendingOwnerAddress : null,
    username: typeof c.username === "string" ? c.username : null,
  };
}

export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ kind: z.enum(CHANNEL_KINDS), action: z.string().min(2).max(30), payload: z.record(z.string(), z.unknown()).optional() }));
  if (!parsed.ok) return parsed.res;
  const { kind, action } = parsed.data;
  let result: SetupResult;
  try {
    result = await channelAction(a.db, a.user, a.bot, kind, action, parsed.data.payload ?? {}, { ip: clientIp(req) ?? undefined });
  } catch (err) {
    // A provider (Twilio, the email service, Telegram...) or our own code failed. The details
    // go to the server log; the page gets a plain sentence.
    console.error(`[channels] ${kind} ${action} failed:`, err);
    return apiError(502, `Something went wrong with ${CHANNEL_BY_KIND[kind].name}. Try again in a moment.`);
  }
  if (!result.ok) return apiError(result.status ?? 400, result.error);
  return json({ ok: true, ...(result.data ?? {}) });
}
