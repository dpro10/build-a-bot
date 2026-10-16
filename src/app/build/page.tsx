import type { Metadata } from "next";
import { asc, count, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getUser } from "@/lib/auth/session";
import { starterCreditMicros } from "@/lib/billing/credit";
import { FAIR_USE, formatMicros } from "@/lib/billing/prices";
import { comingSoonConnectors } from "@/lib/connectors/availability";
import { demoMode, live } from "@/lib/env";
import { findFeatured, recipeSchema } from "@/lib/recipes";
import { Builder, type BuilderProps } from "@/components/builder/Builder";
import { BotLimit } from "@/components/builder/BotLimit";
import type { AvatarId, ColorwayId } from "@/lib/avatars";

export const metadata: Metadata = {
  title: "Build your bot",
  description: "Pick a face, name it, choose its brain, give it your apps, decide how much it can do, and pick how you'll talk. About a minute.",
};

async function loadRecipe(slug: string | undefined): Promise<BuilderProps["recipe"]> {
  if (!slug) return null;
  const featured = findFeatured(slug);
  if (featured) return featured;
  const db = await getDb();
  const [row] = await db.select().from(schema.recipes).where(eq(schema.recipes.slug, slug)).limit(1);
  if (!row?.public) return null;
  const parsed = recipeSchema.safeParse(row.data);
  return parsed.success ? { ...parsed.data, slug: row.slug, tagline: row.description || parsed.data.tagline } : null;
}

export default async function BuildPage({ searchParams }: { searchParams: Promise<{ recipe?: string }> }) {
  const { recipe: slug } = await searchParams;
  const user = await getUser();
  let botCount = 0;
  if (user) {
    const db = await getDb();
    [{ n: botCount }] = await db.select({ n: count() }).from(schema.bots).where(eq(schema.bots.ownerId, user.id));
    // No room for another bot: say so now, not after all seven steps.
    if (botCount >= FAIR_USE.bots) {
      const bots = await db
        .select({ id: schema.bots.id, name: schema.bots.name, avatar: schema.bots.avatar, color: schema.bots.color })
        .from(schema.bots)
        .where(eq(schema.bots.ownerId, user.id))
        .orderBy(asc(schema.bots.createdAt))
        .limit(3);
      return (
        <BotLimit bots={bots.map((b) => ({ ...b, avatar: b.avatar as AvatarId, color: b.color as ColorwayId }))} total={botCount} />
      );
    }
  }
  const recipe = await loadRecipe(slug?.slice(0, 80));
  return (
    <Builder
      demo={demoMode}
      live={{ twilio: live.twilio, botEmail: live.botEmail, discord: live.discord, telegramManaged: live.telegramManaged, slackOAuth: live.slackOAuth }}
      comingSoon={comingSoonConnectors()}
      recipe={recipe}
      botCount={botCount}
      signedIn={Boolean(user?.email)}
      ownerEmail={user?.email ?? null}
      starterCredit={starterCreditMicros() > 0 ? formatMicros(starterCreditMicros()) : null}
    />
  );
}
