import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { BrandTile } from "@/components/brand/icons";
import { COLORWAYS, isColorwayId } from "@/lib/avatars";
import { CHANNEL_BY_KIND, channelUsable, isChannelKind } from "@/lib/channels/catalog";
import { getConnector } from "@/lib/connectors";
import { demoMode, live } from "@/lib/env";
import type { FeaturedRecipe } from "@/lib/recipes";
import { TRUST } from "@/lib/trust";
import { cn } from "@/lib/utils";
import { channelIcon } from "../icons";
import { forWho, recipeTitle } from "./format";

/** Soft colorway wash that works on both themes. */
export function colorwayWash(color: string) {
  const c = COLORWAYS[isColorwayId(color) ? color : "grape"];
  return `radial-gradient(120% 120% at 15% 100%, color-mix(in oklab, ${c.base} 34%, var(--card)) 0%, color-mix(in oklab, ${c.light} 26%, var(--card)) 55%, color-mix(in oklab, ${c.accent} 16%, var(--card)) 100%)`;
}

export function RecipeCard({ recipe, className, compact }: { recipe: FeaturedRecipe; className?: string; compact?: boolean }) {
  const trust = TRUST[recipe.trust];
  const apps = recipe.connectors.map((id) => getConnector(id)).filter((c) => c !== undefined);
  // Only channels people can use here: a card is a promise.
  const channels = recipe.channels
    .filter(isChannelKind)
    .map((k) => CHANNEL_BY_KIND[k])
    .filter((c) => channelUsable(c, demoMode, live));
  const title = recipeTitle(recipe.slug);

  return (
    <Link
      href={`/r/${recipe.slug}`}
      className={cn(
        "group flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-lift focus-visible:-translate-y-1",
        className,
      )}
    >
      <div className="relative flex h-36 items-end px-5" style={{ background: colorwayWash(recipe.color) }}>
        <Avatar
          avatar={recipe.avatar}
          color={recipe.color}
          size={120}
          mood="idle"
          className="-mb-3 h-auto w-[112px] transition duration-300 group-hover:-translate-y-1 group-hover:scale-[1.03]"
          title={`${recipe.name}, the ${title.replace(/\b[A-Z][a-z]+\b/g, (w) => w.toLowerCase())} bot`}
        />
        <span className="absolute top-4 right-4 rounded-full bg-card/85 px-2.5 py-1 text-xs font-semibold shadow-soft backdrop-blur">
          <span aria-hidden="true">{trust.emoji}</span> {trust.name}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5 pt-6">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-display text-xl leading-tight font-bold tracking-tight">{title}</h3>
            <ArrowUpRight className="size-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" aria-hidden="true" />
          </div>
          <p className="mt-0.5 text-sm font-medium text-muted-foreground">
            {recipe.name} · {forWho(recipe.who)}
          </p>
        </div>
        <p className="text-[15px] leading-snug">{recipe.tagline}</p>
        {!compact ? (
          <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            {recipe.highlights.map((h) => (
              <li key={h} className="flex gap-2">
                <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary/60" />
                {h}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-auto flex items-center gap-3 border-t border-border pt-4">
          <div className="flex items-center gap-1.5">
            {apps.map((a) => (
              <span key={a.id} title={a.name}>
                <BrandTile icon={a.icon} size={26} label={a.name} />
              </span>
            ))}
          </div>
          {channels.length ? (
            <>
              <span className="h-5 w-px bg-border" aria-hidden="true" />
              <div className="flex items-center gap-1.5">
                {channels.map((c) => (
                  <span key={c.kind} title={c.name}>
                    <BrandTile icon={channelIcon(c)} size={22} label={c.name} />
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
