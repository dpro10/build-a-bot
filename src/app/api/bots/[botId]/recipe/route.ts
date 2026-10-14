import { z } from "zod";
import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { getBotSetup, listSchedules } from "@/lib/data";
import { botToRecipe } from "@/lib/recipes";
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

/** Publish a shareable "clone this bot" page. */
export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ description: z.string().max(280).optional() }));
  if (!parsed.ok) return parsed.res;
  const { channels, connections } = await getBotSetup(a.db, botId);
  const recipe = botToRecipe(a.bot, connections, channels, await listSchedules(a.db, botId));
  const slug = `${slugify(a.bot.name, 20) || "bot"}-${shortCode()}`;
  const [row] = await a.db
    .insert(schema.recipes)
    .values({ id: newId("rcp"), slug, authorId: a.user.id, name: a.bot.name, description: parsed.data.description ?? "", data: recipe })
    .returning();
  await a.db.update(schema.bots).set({ recipeId: row.id }).where(eq(schema.bots.id, botId));
  return json({ slug, url: `${appUrl()}/r/${slug}` });
}
