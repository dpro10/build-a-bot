import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { getBotSetup, listSchedules } from "@/lib/data";
import { botToRecipe } from "@/lib/recipes";
import { receipt } from "@/lib/agent/run";
import { appUrl } from "@/lib/env";
import { newId, shortCode, slugify } from "@/lib/utils";

/** Download this bot as a recipe (JSON). */
export async function GET(_req: Request, ctx: RouteCtx<{ botId: string }>) {
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const { channels, connections } = await getBotSetup(a.db, botId);
  const recipe = botToRecipe(a.bot, connections, channels, await listSchedules(a.db, botId));
  return new Response(JSON.stringify(recipe, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${slugify(a.bot.name) || "bot"}.recipe.json"` },
  });
}

/**
 * Publish a shareable "clone this bot" page. The first publish makes a link;
 * publishing again refreshes the same link with the bot as it is now (and turns it
 * back on if it was unpublished). Omit `description` to keep the current one.
 */
export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ description: z.string().trim().max(280).optional() }));
  if (!parsed.ok) return parsed.res;
  const { channels, connections } = await getBotSetup(a.db, botId);
  const recipe = botToRecipe(a.bot, connections, channels, await listSchedules(a.db, botId));

  const [existing] = a.bot.recipeId
    ? await a.db
        .select()
        .from(schema.recipes)
        .where(and(eq(schema.recipes.id, a.bot.recipeId), eq(schema.recipes.authorId, a.user.id)))
        .limit(1)
    : [];

  let slug: string;
  let description: string;
  if (existing) {
    description = parsed.data.description ?? existing.description;
    const [row] = await a.db
      .update(schema.recipes)
      .set({ name: a.bot.name, description, data: recipe, public: true, updatedAt: new Date() })
      .where(eq(schema.recipes.id, existing.id))
      .returning();
    slug = row.slug;
  } else {
    description = parsed.data.description ?? "";
    slug = `${slugify(a.bot.name, 20) || "bot"}-${shortCode()}`;
    const [row] = await a.db
      .insert(schema.recipes)
      .values({ id: newId("rcp"), slug, authorId: a.user.id, name: a.bot.name, description, data: recipe })
      .returning();
    await a.db.update(schema.bots).set({ recipeId: row.id }).where(eq(schema.bots.id, botId));
  }
  await receipt(a.db, a.bot, "system", "ok", existing ? (existing.public ? "Updated the shared recipe" : "Shared the recipe again") : "Shared as a recipe", { slug });
  return json({ slug, url: `${appUrl()}/r/${slug}`, public: true, description });
}

/** Unpublish: the link stops working (404). The row stays, so clone counts and the slug survive a re-publish. */
export async function DELETE(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  if (!a.bot.recipeId) return apiError(404, "This bot isn't shared.");
  const [row] = await a.db
    .update(schema.recipes)
    .set({ public: false, updatedAt: new Date() })
    .where(and(eq(schema.recipes.id, a.bot.recipeId), eq(schema.recipes.authorId, a.user.id)))
    .returning({ slug: schema.recipes.slug });
  if (!row) return apiError(404, "This bot isn't shared.");
  await receipt(a.db, a.bot, "system", "ok", "Stopped sharing the recipe", { slug: row.slug });
  return json({ ok: true, slug: row.slug, public: false });
}
