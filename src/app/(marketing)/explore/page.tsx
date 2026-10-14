import Link from "next/link";
import { ArrowRight, Plus, Share2 } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { ExploreGallery, type GalleryFilter } from "@/components/marketing/recipes/ExploreGallery";
import { RecipeCard } from "@/components/marketing/recipes/RecipeCard";
import { FinalCta } from "@/components/marketing/landing/FinalCta";
import { Container } from "@/components/marketing/ui";
import { JOBS } from "@/lib/jobs";
import { FEATURED_RECIPES } from "@/lib/recipes";
import { pageMetadata } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Explore recipes",
  description:
    "Ready-made AI bots for inbox zero, studying, code review, errands, research, family logistics, habits, job hunting and travel. Make one yours in a tap.",
  path: "/explore",
});

function ScratchCard() {
  return (
    <Link
      href="/build"
      className="group flex h-full min-h-[340px] flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed border-border bg-card/50 p-8 text-center transition hover:border-primary/50 hover:bg-primary-soft/30"
    >
      <div className="flex -space-x-3" aria-hidden="true">
        <Avatar avatar="blip" size={56} animated={false} />
        <Avatar avatar="otto" size={56} animated={false} />
        <Avatar avatar="ember" size={56} animated={false} />
      </div>
      <div>
        <div className="font-display text-xl font-bold">Start from scratch</div>
        <p className="mt-1 text-sm text-muted-foreground">Pick a face, a name and a job of your own. About a minute.</p>
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow transition group-hover:bg-primary-hover">
        <Plus className="size-4" aria-hidden="true" /> Build your bot
      </span>
    </Link>
  );
}

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ job?: string | string[] }> }) {
  const { job } = await searchParams;
  const initial = typeof job === "string" ? job : null;

  const counts = new Map<string, number>();
  for (const r of FEATURED_RECIPES) for (const j of r.jobs) counts.set(j, (counts.get(j) ?? 0) + 1);
  const filters: GalleryFilter[] = JOBS.filter((j) => counts.has(j.id)).map((j) => ({ id: j.id, label: j.label, emoji: j.emoji, count: counts.get(j.id) ?? 0 }));

  const items = FEATURED_RECIPES.map((r) => ({ slug: r.slug, jobs: r.jobs, node: <RecipeCard recipe={r} /> }));

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="aurora" aria-hidden="true" />
        <Container className="relative pt-16 pb-10 text-center sm:pt-20">
          <div className="mx-auto flex w-fit items-end gap-2" aria-hidden="true">
            <Avatar avatar="nimbus" size={84} mood="happy" />
            <Avatar avatar="sprout" size={104} mood="happy" />
            <Avatar avatar="otto" size={84} mood="happy" />
          </div>
          <h1 className="mx-auto mt-5 max-w-3xl font-display text-[2.6rem] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance sm:text-6xl">
            Start from a <span className="mk-gradient-text">recipe.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-muted-foreground sm:text-xl">
            Ready-made bots for everyday jobs, with the apps, channels, trust level and routines already picked. Make one yours in a tap, then change
            anything.
          </p>
        </Container>
      </section>

      <section aria-label="Recipes" className="pb-20 sm:pb-28">
        <Container>
          <ExploreGallery items={items} filters={filters} initial={initial} trailing={<ScratchCard />} />

          <div className="mt-14 flex flex-col items-center gap-4 rounded-3xl border border-border bg-card p-6 text-center shadow-soft sm:flex-row sm:p-7 sm:text-left">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary" aria-hidden="true">
              <Share2 className="size-6" />
            </span>
            <div className="flex-1">
              <div className="font-display text-lg font-semibold">Made a bot you love? Share it.</div>
              <p className="text-sm text-muted-foreground">
                Any bot can become a recipe link: its look, personality, apps, channels and routines. Never your keys, memories or messages.
              </p>
            </div>
            <Link href="/build" className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary hover:underline">
              Build one first <ArrowRight className="size-4" />
            </Link>
          </div>
        </Container>
      </section>

      <FinalCta />
    </>
  );
}
