import { z } from "zod";
import { after } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { AVATAR_IDS, COLORWAY_IDS } from "@/lib/avatars";
import { TRUST_LEVELS } from "@/lib/trust";
import { ROLE_IDS } from "@/lib/roles";
import { readCredential, storeCredential } from "@/lib/channels/secrets";
import { setTelegramProfilePhoto, telegramCall } from "@/lib/channels/telegram";
import { INCLUDED_MODELS, PROVIDER_BY_ID, type ProviderId } from "@/lib/models/catalog";
import { getBotSetup } from "@/lib/data";
import { botNameSchema } from "@/lib/bots/create";
import { settingsChange } from "@/lib/bots/labels";
import { receipt } from "@/lib/agent/run";
import type { BrainConfig } from "@/lib/db/schema";

export async function GET(_req: Request, ctx: RouteCtx<{ botId: string }>) {
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const { channels, connections } = await getBotSetup(a.db, botId);
  const { mcpTokenHash: _h, ...bot } = a.bot;
  // Never secrets to the browser: a channel's config holds e.g. its Telegram webhook secret.
  const safeChannels = channels.map(({ config, credentialId, ...c }) => {
    const cfg = (config ?? {}) as { simulated?: boolean; pendingOwnerAddress?: unknown; username?: unknown };
    return {
      ...c,
      credentialId: credentialId ? "set" : null,
      config: {
        simulated: cfg.simulated ?? false,
        pendingOwnerAddress: typeof cfg.pendingOwnerAddress === "string" ? cfg.pendingOwnerAddress : null,
        username: typeof cfg.username === "string" ? cfg.username : null,
      },
    };
  });
  return json({ bot, channels: safeChannels, connections });
}

const patchSchema = z.object({
  name: botNameSchema.optional(),
  avatar: z.enum(AVATAR_IDS).optional(),
  color: z.enum(COLORWAY_IDS).optional(),
  instructions: z.string().max(4000).optional(),
  jobs: z.array(z.string()).max(12).optional(),
  /** A ready-made role, or null to make it a general assistant again. */
  role: z.enum(ROLE_IDS).nullable().optional(),
  trust: z.enum(TRUST_LEVELS).optional(),
  vibe: z
    .object({ verbosity: z.enum(["brief", "balanced", "detailed"]).optional(), emoji: z.boolean().optional(), tone: z.string().max(80).optional() })
    .optional(),
  limits: z
    .object({
      dailyActions: z.number().int().min(0).max(1000).optional(),
      spendCapUsd: z.number().min(0).max(10000).optional(),
      quietHours: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }).nullable().optional(),
      transcriptDays: z.number().int().min(1).max(3650).nullable().optional(),
    })
    .optional(),
  brain: z
    .object({
      kind: z.enum(["included", "byok", "subscription"]),
      provider: z.string().max(40).optional(),
      model: z.string().max(200).optional(),
      apiKey: z.string().min(8).max(400).optional(),
      baseUrl: z.string().url().optional(),
      effort: z.enum(["low", "medium", "high"]).optional(),
      whenOffline: z.enum(["wait", "included"]).optional(),
    })
    .optional(),
});

export async function PATCH(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, patchSchema);
  if (!parsed.ok) return parsed.res;
  const p = parsed.data;
  const updates: Partial<typeof schema.bots.$inferInsert> = { updatedAt: new Date() };

  if (p.name) updates.name = p.name;
  if (p.avatar) updates.avatar = p.avatar;
  if (p.color) updates.color = p.color;
  if (p.instructions !== undefined) updates.instructions = p.instructions;
  if (p.jobs) updates.jobs = p.jobs;
  if (p.role !== undefined) updates.role = p.role;
  if (p.vibe) updates.vibe = { ...a.bot.vibe, ...p.vibe };
  if (p.limits) updates.limits = { ...a.bot.limits, ...p.limits };
  if (p.trust) updates.trust = p.trust;
  if (p.brain) {
    let brain: BrainConfig;
    if (p.brain.kind === "included") {
      const def = INCLUDED_MODELS.find((m) => m.id === p.brain!.model) ?? INCLUDED_MODELS.find((m) => m.default)!;
      brain = { kind: "included", provider: "nebius", model: def.id, effort: p.brain.effort ?? a.bot.brain.effort ?? "low" };
    } else if (p.brain.kind === "byok") {
      const provider = (p.brain.provider ?? a.bot.brain.provider) as ProviderId;
      if (!PROVIDER_BY_ID[provider]) return apiError(422, "Unknown provider");
      let credentialId = a.bot.brain.kind === "byok" && a.bot.brain.provider === provider ? a.bot.brain.credentialId : null;
      if (p.brain.apiKey) {
        credentialId = await storeCredential(a.db, { ownerId: a.user.id, kind: "api_key", provider, secret: p.brain.apiKey, label: `${PROVIDER_BY_ID[provider].name} key` });
      }
      if (!credentialId) return apiError(422, "Add your API key");
      brain = {
        kind: "byok",
        provider,
        model: p.brain.model ?? PROVIDER_BY_ID[provider].models.find((m) => m.default)?.id ?? "",
        credentialId,
        baseUrl: p.brain.baseUrl ?? null,
        effort: p.brain.effort ?? "medium",
      };
    } else {
      brain = {
        kind: "subscription",
        provider: p.brain.provider === "codex" ? "codex" : "claude-code",
        model: p.brain.model ?? "default",
        whenOffline: p.brain.whenOffline ?? "wait",
      };
    }
    updates.brain = brain;
  }
  const [bot] = await a.db.update(schema.bots).set(updates).where(eq(schema.bots.id, botId)).returning();
  // Keep its Telegram bot's name and face in sync (after the response; best effort).
  if (p.name || p.avatar || p.color) {
    after(async () => {
      const [tg] = await a.db
        .select()
        .from(schema.channels)
        .where(and(eq(schema.channels.botId, botId), eq(schema.channels.kind, "telegram"), eq(schema.channels.status, "active")))
        .limit(1);
      const token = tg?.credentialId ? await readCredential(a.db, tg.credentialId) : null;
      if (!token) return;
      if (p.name) await telegramCall(token, "setMyName", { name: bot.name.slice(0, 64) }).catch(() => {});
      if (p.avatar || p.color) await setTelegramProfilePhoto(token, bot);
    });
  }
  // Named for what changed ("Keep transcripts: 30 days"), not the group it was saved in ("limits").
  const { title, changed } = settingsChange(p, a.bot.limits);
  await receipt(a.db, bot, "system", "ok", title, {
    changed,
    ...(p.trust ? { trust: p.trust } : {}),
    ...(p.brain ? { brain: { kind: bot.brain.kind, provider: bot.brain.provider, model: bot.brain.model } } : {}),
  });
  return json({ bot });
}

export async function DELETE(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  await a.db.transaction(async (tx) => {
    await tx.execute(sql`set local app.allow_receipt_delete = 'on'`);
    await tx.delete(schema.bots).where(eq(schema.bots.id, botId));
  });
  return json({ ok: true });
}
