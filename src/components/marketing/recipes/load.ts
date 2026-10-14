/**
 * Loads a recipe for its public page: a featured one, or a public recipe someone
 * shared (same rules as /api/recipes/[slug]). Shared recipes are validated before
 * they're shown; anything malformed counts as not found. Server-only (reads the DB).
 */
import { cache } from "react";
import { eq } from "drizzle-orm";
import { AVATARS } from "@/lib/avatars";
import { getDb, schema } from "@/lib/db";
import { findFeatured, recipeSchema, type RecipeData } from "@/lib/recipes";
import { forWho, recipeTitle } from "./format";

export type RecipeView = RecipeData & {
  slug: string;
  title: string;
  subtitle: string;
  tagline: string;
  highlights: string[];
  featured: boolean;
  clones: number | null;
};

export const loadRecipe = cache(async (slug: string): Promise<RecipeView | null> => {
  const featured = findFeatured(slug);
  if (featured) {
    return {
      ...featured,
      title: recipeTitle(featured.slug),
      subtitle: `${featured.name} · ${forWho(featured.who)}`,
      featured: true,
      clones: null,
    };
  }
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const db = await getDb();
  const [row] = await db.select().from(schema.recipes).where(eq(schema.recipes.slug, slug)).limit(1);
  if (!row || !row.public) return null;
  const parsed = recipeSchema.safeParse(row.data);
  if (!parsed.success) return null;
  const data = parsed.data;
  const character = AVATARS[data.avatar];
  return {
    ...data,
    slug: row.slug,
    title: data.name,
    subtitle: `${character.character} the ${character.species} · a shared recipe`,
    tagline: row.description || data.tagline || `${data.name} is a bot recipe you can make your own.`,
    highlights: [],
    featured: false,
    clones: row.clones,
  };
});
