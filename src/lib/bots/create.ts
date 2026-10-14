/**
 * Creating a bot from the builder's answers.
 */
import { z } from "zod";
import { count, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Bot, BrainConfig, User } from "@/lib/db/schema";
import { AVATAR_IDS, COLORWAY_IDS } from "@/lib/avatars";
import { TRUST_LEVELS, type TrustLevel } from "@/lib/trust";
import { CHANNEL_BY_KIND, CHANNEL_KINDS, type ChannelKind } from "@/lib/channels/catalog";
import { getConnector, isBuiltinConnector } from "@/lib/connectors";
import { connectVia, connectorUsable } from "@/lib/connectors/availability";
import { INCLUDED_MODELS, PROVIDER_BY_ID, type ProviderId } from "@/lib/models/catalog";
import { JOB_BY_ID } from "@/lib/jobs";
import { PAID_PLANS_SOON, getPlan, planAllowsChannel, planAllowsTrust } from "@/lib/billing/plans";
import { available, demoMode, live, paidPlansOpen } from "@/lib/env";
import { storeCredential } from "@/lib/channels/secrets";
import { computeNextRun, isValidTimeZone } from "@/lib/scheduler/time";
import { canonicalResource } from "@/lib/connectors/mcp/oauth";
import { findFeatured, recipeSchema, type RecipeData } from "@/lib/recipes";
import { isEmail, newId, normalizePhone, shortCode, slugify, sortableId } from "@/lib/utils";

const brainSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("included"),
    model: z.string().min(1).max(120),
    effort: z.enum(["low", "medium", "high"]).optional(),
  }),
  z.object({
    kind: z.literal("byok"),
    provider: z.string().min(1).max(40),
    model: z.string().min(1).max(200),
    apiKey: z.string().min(8).max(400),
    baseUrl: z.string().url().max(400).optional(),
    effort: z.enum(["low", "medium", "high"]).optional(),
  }),
  z.object({
    kind: z.literal("subscription"),
    subscription: z.enum(["claude", "chatgpt"]),
    model: z.string().max(60).optional(),
    whenOffline: z.enum(["wait", "included"]).optional(),
  }),
]);

/** A bot's name: short, and never the product's own name (it stays out of anything a bot owns). */
export const botNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .refine((n) => !/build[\s-]*a[\s-]*bot/i.test(n), "Pick a name that isn't the product's name");

export const createBotSchema = z.object({
  avatar: z.enum(AVATAR_IDS),
  color: z.enum(COLORWAY_IDS),
  name: botNameSchema,
  jobs: z.array(z.string()).max(12).default([]),
  instructions: z.string().max(4000).optional(),
  brain: brainSchema,
  connectors: z.array(z.string().max(60)).max(200).default([]),
  /**
   * The builder sends the full list, the jobs' built-ins included, so one the owner took
   * out stays out. Other callers get each job's built-ins added for them.
   */
  exactConnectors: z.boolean().optional(),
  /** Any MCP servers the owner pasted (https only); they sign in after the bot is born. */
  customMcp: z
    .array(z.object({ url: z.string().url().max(500).refine((u) => u.startsWith("https://"), "Use an https:// URL"), name: z.string().trim().max(60).optional() }))
    .max(5)
    .default([]),
  trust: z.enum(TRUST_LEVELS),
  channels: z.array(z.enum(CHANNEL_KINDS)).max(12).default([]),
  contact: z
    .object({
      phone: z.string().max(40).optional(),
      email: z.string().max(200).optional(),
      telegram: z.string().max(64).optional(),
    })
    .default({}),
  ownerName: z.string().trim().max(60).optional(),
  timezone: z.string().max(80).optional(),
  ageConfirmed: z.literal(true),
  recipeId: z.string().max(60).optional(),
  /** A daily brief the bot sends on its own (the habit that keeps people coming back). */
  morningBrief: z
    .object({ time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), days: z.array(z.number().int().min(0).max(6)).max(7).optional() })
    .nullable()
    .optional(),
});

type ParsedInput = z.infer<typeof createBotSchema>;
/** Parsed builder input; `customMcp` may be left out by server-side callers. */
export type CreateBotInput = Omit<ParsedInput, "customMcp"> & { customMcp?: ParsedInput["customMcp"] };

export type CreateBotResult =
  | { ok: true; bot: Bot; notes: string[]; upgrade?: "plus" | "pro" }
  | { ok: false; error: string; status?: number };

export async function createBot(db: Db, owner: User, input: CreateBotInput): Promise<CreateBotResult> {
  const plan = getPlan(owner.plan);
  const [{ n }] = await db.select({ n: count() }).from(schema.bots).where(eq(schema.bots.ownerId, owner.id));
  if (n >= plan.limits.bots) {
    const next = paidPlansOpen ? "Upgrade to make more." : `To make another, delete ${plan.limits.bots === 1 ? "it" : "one"} first. ${PAID_PLANS_SOON}`;
    return { ok: false, status: 402, error: `The ${plan.name} plan includes ${plan.limits.bots} bot${plan.limits.bots === 1 ? "" : "s"}. ${next}` };
  }

  const notes: string[] = [];
  let upgrade: "plus" | "pro" | undefined;

  // Trust: honor the pick; plans gate Full faith (demo mode lets everyone try it).
  let trust: TrustLevel = input.trust;
  if (!planAllowsTrust(plan, trust) && !demoMode) {
    trust = "trusted";
    upgrade = "plus";
    notes.push(
      paidPlansOpen
        ? "Full faith is part of Plus. Your bot starts as a Trusted helper; upgrade anytime to switch."
        : `Full faith is part of Plus. ${PAID_PLANS_SOON} Your bot starts as a Trusted helper.`,
    );
  }

  // Brain.
  let brain: BrainConfig;
  if (input.brain.kind === "included") {
    const def = INCLUDED_MODELS.find((m) => m.id === input.brain.model) ?? INCLUDED_MODELS.find((m) => m.default)!;
    const tier = def.tier;
    const allowed = plan.includedModels.includes(tier) || demoMode;
    const model = allowed ? def : INCLUDED_MODELS.find((m) => m.default)!;
    if (!allowed) {
      upgrade = upgrade ?? (tier === "smart" ? "pro" : "plus");
      notes.push(`${def.label} is part of ${tier === "smart" ? "Pro" : "Plus"}. Starting on ${model.label}.`);
    }
    brain = { kind: "included", provider: "nebius", model: model.id, effort: input.brain.effort ?? "low" };
  } else if (input.brain.kind === "byok") {
    const provider = input.brain.provider as ProviderId;
    if (!PROVIDER_BY_ID[provider]) return { ok: false, error: "Unknown AI provider." };
    if (provider === "custom" && !input.brain.baseUrl) return { ok: false, error: "Add your endpoint's base URL." };
    const credentialId = await storeCredential(db, {
      ownerId: owner.id,
      kind: "api_key",
      provider,
      secret: input.brain.apiKey.trim(),
      label: `${PROVIDER_BY_ID[provider].name} key`,
    });
    brain = {
      kind: "byok",
      provider,
      model: input.brain.model,
      credentialId,
      baseUrl: input.brain.baseUrl ?? null,
      effort: input.brain.effort ?? "medium",
    };
  } else {
    brain = {
      kind: "subscription",
      provider: input.brain.subscription === "claude" ? "claude-code" : "codex",
      model: input.brain.model ?? "default",
      whenOffline: input.brain.whenOffline ?? "wait",
    };
    notes.push("One more step for your subscription: pair your computer on the Bridge page (it takes a minute).");
  }

  // User profile bits from the builder.
  await db
    .update(schema.users)
    .set({
      ageConfirmedAt: owner.ageConfirmedAt ?? new Date(),
      ...(input.timezone && isValidTimeZone(input.timezone) ? { timezone: input.timezone } : {}),
      ...(input.ownerName ? { name: input.ownerName } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, owner.id));

  const id = newId("bot");
  const handle = `${slugify(input.name, 16) || "bot"}-${shortCode()}`;
  const jobs = input.jobs.filter((j) => j in JOB_BY_ID);

  const [bot] = await db
    .insert(schema.bots)
    .values({
      id,
      ownerId: owner.id,
      name: input.name.trim(),
      avatar: input.avatar,
      color: input.color,
      jobs,
      instructions: input.instructions?.trim() ?? "",
      brain,
      trust,
      handle,
      recipeId: input.recipeId ?? null,
      limits: {},
    })
    .returning();

  // Connections (built-ins from jobs are added too, unless the list is already exact).
  const connectorIds = new Set(input.connectors);
  if (!input.exactConnectors) for (const j of jobs) for (const b of JOB_BY_ID[j as keyof typeof JOB_BY_ID]?.builtins ?? []) connectorIds.add(b);
  const thirdPartyLimit = plan.limits.connectors;
  let thirdParty = 0;
  for (const connectorId of connectorIds) {
    const def = getConnector(connectorId);
    // "Coming soon" ones are left out: not built yet, or a built-in whose service isn't set up here.
    if (!def || !connectorUsable(def)) continue;
    if (isBuiltinConnector(def)) {
      await db.insert(schema.connections).values({ id: newId("con"), botId: id, connectorId, mode: "builtin", status: "connected" }).onConflictDoNothing();
      continue;
    }
    if (thirdParty >= thirdPartyLimit && !demoMode) {
      upgrade = upgrade ?? "plus";
      notes.push(`The ${plan.name} plan connects ${thirdPartyLimit} apps. ${def.name} was skipped — ${paidPlansOpen ? "upgrade to add more." : PAID_PLANS_SOON.toLowerCase()}`);
      continue;
    }
    thirdParty++;
    // Best usable way to connect (see connectors/availability.ts).
    const via = connectVia(def);
    // Demo mode starts every app as a simulated connection (works instantly); "Connect for real" upgrades it.
    const mode = demoMode && !(via?.kind === "composio") ? "demo" : via?.kind === "composio" ? "composio" : "mcp";
    if (!demoMode && !via) {
      notes.push(`${def.name} is coming soon, so it wasn't added.`);
      continue;
    }
    await db
      .insert(schema.connections)
      .values({
        id: newId("con"),
        botId: id,
        connectorId,
        mode,
        status: mode === "demo" ? "demo" : "needs_auth",
        config: via?.kind === "mcp" ? { url: via.url, auth: via.auth, ...(via.headers ? { headers: via.headers } : {}) } : via?.kind === "composio" ? { toolkit: via.toolkit } : {},
      })
      .onConflictDoNothing();
  }

  // Custom MCP servers: added now, signed in to from Apps & trust.
  for (const server of input.customMcp ?? []) {
    if (thirdParty >= thirdPartyLimit && !demoMode) {
      upgrade = upgrade ?? "plus";
      notes.push(
        `The ${plan.name} plan connects ${thirdPartyLimit} apps. ${server.name || new URL(server.url).host} was skipped — ${paidPlansOpen ? "upgrade to add more." : PAID_PLANS_SOON.toLowerCase()}`,
      );
      continue;
    }
    thirdParty++;
    const resource = new URL(canonicalResource(server.url));
    await db
      .insert(schema.connections)
      .values({
        id: newId("con"),
        botId: id,
        connectorId: `custom_mcp:${resource.host}${resource.pathname}`.slice(0, 80),
        mode: "mcp",
        status: "needs_auth",
        config: { url: server.url, auth: "unknown", name: server.name || resource.host },
      })
      .onConflictDoNothing();
  }

  // Routines from the recipe this bot was made from.
  const recipe = input.recipeId ? await loadRecipe(db, input.recipeId) : null;
  if (recipe?.routines?.length) {
    const tz = input.timezone && isValidTimeZone(input.timezone) ? input.timezone : owner.timezone || "UTC";
    let made = 0;
    for (const r of recipe.routines) {
      if (made >= plan.limits.routines && !demoMode) {
        notes.push(`The ${plan.name} plan includes ${plan.limits.routines} routines; the rest of this recipe's routines were skipped.`);
        break;
      }
      const sched = { type: "daily" as const, time: r.time, ...(r.days?.length ? { days: r.days } : {}) };
      const nextRunAt = computeNextRun(sched, tz, new Date());
      if (!nextRunAt) continue;
      await db.insert(schema.schedules).values({
        id: newId("sch"),
        botId: id,
        kind: "routine",
        title: r.title,
        prompt: r.instruction,
        schedule: sched,
        timezone: tz,
        nextRunAt,
      });
      made++;
    }
  }
  if (input.morningBrief) {
    const tz = input.timezone && isValidTimeZone(input.timezone) ? input.timezone : owner.timezone || "UTC";
    const sched = { type: "daily" as const, time: input.morningBrief.time, ...(input.morningBrief.days?.length ? { days: input.morningBrief.days } : {}) };
    const nextRunAt = computeNextRun(sched, tz, new Date());
    if (nextRunAt) {
      await db.insert(schema.schedules).values({
        id: newId("sch"),
        botId: id,
        kind: "routine",
        title: "Morning brief",
        prompt: briefPrompt(jobs),
        schedule: sched,
        timezone: tz,
        nextRunAt,
      });
    }
  }

  if (input.recipeId && !findFeatured(input.recipeId)) {
    await db.update(schema.recipes).set({ clones: sql`${schema.recipes.clones} + 1` }).where(eq(schema.recipes.slug, input.recipeId));
  }

  // Channels: web is always on.
  await db.insert(schema.channels).values({
    id: newId("chn"),
    botId: id,
    kind: "web",
    status: "active",
    ownerAddress: owner.id,
    ownerVerifiedAt: new Date(),
  });
  const phone = input.contact.phone ? normalizePhone(input.contact.phone) : null;
  const email = input.contact.email && isEmail(input.contact.email) ? input.contact.email.trim().toLowerCase() : null;
  for (const kind of new Set(input.channels)) {
    if (kind === "web") continue;
    const def = CHANNEL_BY_KIND[kind as ChannelKind];
    if (!def) continue;
    if (def.availability === "waitlist" || def.availability === "soon") {
      await db.insert(schema.channels).values({ id: newId("chn"), botId: id, kind, status: "waitlist" }).onConflictDoNothing();
      continue;
    }
    if (!planAllowsChannel(plan, kind) && !demoMode) {
      upgrade = upgrade ?? (def.minPlan === "pro" ? "pro" : "plus");
      notes.push(`${def.name} is part of ${def.minPlan === "pro" ? "Pro" : "Plus"}. Upgrade to turn it on.`);
      await db.insert(schema.channels).values({ id: newId("chn"), botId: id, kind, status: "needs_setup", config: { locked: true } }).onConflictDoNothing();
      continue;
    }
    const ownerAddress = def.needs === "phone" ? phone : def.needs === "email" ? email : null;
    // In demo mode with nothing configured, channels run simulated so the whole flow can be seen.
    const simulated = demoMode && def.requires ? !available(def.requires) || !(live as Record<string, boolean>)[def.requires] : false;
    await db
      .insert(schema.channels)
      .values({
        id: newId("chn"),
        botId: id,
        kind,
        status: simulated && ownerAddress ? "active" : "needs_setup",
        ownerAddress: simulated ? ownerAddress : null,
        ownerVerifiedAt: simulated && ownerAddress ? new Date() : null,
        config: { pendingOwnerAddress: ownerAddress, ...(simulated ? { simulated: true } : {}) },
      })
      .onConflictDoNothing();
  }

  await db.insert(schema.receipts).values({
    id: sortableId("rcp"),
    botId: id,
    ownerId: owner.id,
    kind: "system",
    status: "ok",
    title: `${bot.name} was born`,
    detail: { avatar: bot.avatar, trust, brain: { kind: brain.kind, provider: brain.provider, model: brain.model }, channels: input.channels, connectors: [...connectorIds] },
  });

  return { ok: true, bot, notes, upgrade };
}

/** A featured recipe, or a public one someone published. */
async function loadRecipe(db: Db, slug: string): Promise<RecipeData | null> {
  const featured = findFeatured(slug);
  if (featured) return featured;
  const [row] = await db.select().from(schema.recipes).where(eq(schema.recipes.slug, slug)).limit(1);
  if (!row || !row.public) return null;
  const parsed = recipeSchema.safeParse(row.data);
  return parsed.success ? parsed.data : null;
}

/** What the morning brief covers, from the jobs the owner picked. */
export function briefPrompt(jobs: string[]): string {
  const parts: string[] = [];
  if (jobs.includes("calendar")) parts.push("what's on my calendar today");
  if (jobs.includes("inbox")) parts.push("emails that need a reply");
  if (jobs.includes("reminders") || !parts.length) parts.push("reminders due today");
  if (jobs.includes("research")) parts.push("one headline worth knowing about");
  if (jobs.includes("money")) parts.push("anything due on bills or subscriptions");
  if (jobs.includes("health")) parts.push("a gentle nudge on my habits");
  parts.push("the weather");
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `Give me a short, friendly morning brief: ${list}. Keep it skimmable, and lead with anything urgent.`;
}
