import type { Metadata } from "next";
import { count, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getUser } from "@/lib/auth/session";
import { getPlan } from "@/lib/billing/plans";
import { unavailableConnectors } from "@/lib/connectors";
import { demoMode, live } from "@/lib/env";
import { findFeatured, recipeSchema } from "@/lib/recipes";
import { Builder, type BuilderProps } from "@/components/builder/Builder";

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
  }
  const recipe = await loadRecipe(slug?.slice(0, 80));
  return (
    <Builder
      plan={getPlan(user?.plan).id}
      demo={demoMode}
      live={{ twilio: live.twilio, botEmail: live.botEmail, discord: live.discord, telegramManaged: live.telegramManaged, slackOAuth: live.slackOAuth, stripe: live.stripe }}
      unavailableApps={unavailableConnectors(demoMode, live)}
      recipe={recipe}
      botCount={botCount}
      signedIn={Boolean(user?.email)}
      ownerEmail={user?.email ?? null}
    />
  );
}
