import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { credentialHint, getOwnedBot } from "@/lib/data";
import { appUrl, config, creditOpen, demoMode } from "@/lib/env";
import { isAvatarId, isColorwayId } from "@/lib/avatars";
import { brainLabel } from "@/lib/bots/labels";
import { SettingsNav } from "@/components/bot/settings/SettingsNav";
import { LookSection } from "@/components/bot/settings/LookSection";
import { JobsSection } from "@/components/bot/settings/JobsSection";
import { roleBadge } from "@/lib/roles";
import { BrainSection } from "@/components/bot/settings/BrainSection";
import { RecipeSection } from "@/components/bot/settings/RecipeSection";
import { McpSection } from "@/components/bot/settings/McpSection";
import { DangerSection } from "@/components/bot/settings/DangerSection";
import { ActivityPanel } from "@/components/bot/activity/ActivityPanel";
import { SubTabs } from "@/components/app/SubTabs";

export const metadata: Metadata = { title: "Settings" };

/** Settings: how the bot is set up (?tab=general), and everything it has done (?tab=activity). */
export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ botId: string }>;
  searchParams: Promise<{ tab?: string; filter?: string; view?: string }>;
}) {
  const { botId } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/app/bots/${botId}/settings`);
  const db = await getDb();
  const bot = await getOwnedBot(db, user.id, botId);
  if (!bot) notFound();
  const tab = sp.tab === "activity" ? "activity" : "general";
  const heading = (
    <div className="mb-6 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-bold sm:text-3xl">Settings</h2>
        <p className="text-muted-foreground">
          {tab === "activity"
            ? `Everything ${bot.name} has done, newest first.`
            : `Make ${bot.name} yours: how it looks and talks, what it thinks with, and how you share it.`}
        </p>
      </div>
      <SubTabs
        label="Settings"
        active={tab}
        items={[
          { id: "general", label: "General", href: `/app/bots/${botId}/settings` },
          { id: "activity", label: "Activity", href: `/app/bots/${botId}/settings?tab=activity` },
        ]}
      />
    </div>
  );

  if (tab === "activity") {
    return (
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
          {heading}
          <ActivityPanel botId={botId} botName={bot.name} timeZone={user.timezone} filter={sp.filter} view={sp.view} />
        </div>
      </div>
    );
  }

  const [hint, recipeRows] = await Promise.all([
    bot.brain.kind === "byok" ? credentialHint(db, user.id, bot.brain.credentialId) : Promise.resolve(null),
    // bots.recipeId is this bot's own published recipe (or, for a bot made from someone's
    // recipe, that recipe's slug): only a row this owner wrote counts as "shared".
    bot.recipeId
      ? db
          .select({ slug: schema.recipes.slug, public: schema.recipes.public, description: schema.recipes.description })
          .from(schema.recipes)
          .where(and(eq(schema.recipes.id, bot.recipeId), eq(schema.recipes.authorId, user.id)))
          .limit(1)
      : Promise.resolve([] as { slug: string; public: boolean; description: string }[]),
  ]);
  const base = appUrl();
  const shared = recipeRows[0];
  const recipe = shared ? { slug: shared.slug, url: `${base}/r/${shared.slug}`, public: shared.public, description: shared.description } : null;
  const vibe = bot.vibe ?? {};

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        {heading}
        <div className="lg:grid lg:grid-cols-[196px_minmax(0,1fr)] lg:gap-8">
          <SettingsNav />
          <div className="flex min-w-0 flex-col gap-6">
            <LookSection
              botId={botId}
              badge={roleBadge(bot.role)}
              initial={{
                name: bot.name,
                avatar: isAvatarId(bot.avatar) ? bot.avatar : "blip",
                color: isColorwayId(bot.color) ? bot.color : "ocean",
                instructions: bot.instructions ?? "",
                verbosity: vibe.verbosity ?? "balanced",
                emoji: vibe.emoji ?? true,
                tone: vibe.tone ?? "",
              }}
            />
            <JobsSection botId={botId} botName={bot.name} initial={bot.jobs ?? []} initialRole={bot.role} />
            <BrainSection
              botId={botId}
              botName={bot.name}
              initial={{
                kind: bot.brain.kind,
                provider: bot.brain.provider,
                model: bot.brain.model,
                effort: bot.brain.effort,
                baseUrl: bot.brain.baseUrl ?? null,
              }}
              label={brainLabel(bot.brain)}
              keyHint={hint?.hint ?? null}
              demoBrain={!config.tokenFactory.apiKey && demoMode}
              paidModels={creditOpen}
            />
            <RecipeSection botId={botId} botName={bot.name} hasInstructions={Boolean(bot.instructions?.trim())} initial={recipe} />
            <McpSection botId={botId} botName={bot.name} mcpUrl={`${base}/api/mcp/${botId}`} hasToken={Boolean(bot.mcpTokenHash)} />
            <DangerSection botId={botId} botName={bot.name} />
          </div>
        </div>
      </div>
    </div>
  );
}
