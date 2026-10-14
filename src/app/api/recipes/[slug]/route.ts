import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { apiError, json, type RouteCtx } from "@/lib/api";
import { findFeatured } from "@/lib/recipes";

export async function GET(_req: Request, ctx: RouteCtx<{ slug: string }>) {
  const { slug } = await ctx.params;
  const featured = findFeatured(slug);
  if (featured) return json({ recipe: featured, featured: true });
  const db = await getDb();
  const [row] = await db.select().from(schema.recipes).where(eq(schema.recipes.slug, slug)).limit(1);
  if (!row || !row.public) return apiError(404, "Recipe not found");
  return json({ recipe: { ...row.data, slug: row.slug, tagline: row.description }, featured: false, clones: row.clones });
}
