import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FEATURED_RECIPES } from "@/lib/recipes";
import { Container, Section, SectionHeader } from "../ui";
import { RecipeCard } from "../recipes/RecipeCard";

export function Recipes() {
  const picks = FEATURED_RECIPES.slice(0, 6);
  return (
    <Section id="recipes" aria-labelledby="recipes-title" className="bg-background-2">
      <Container>
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <SectionHeader id="recipes-title" eyebrow="Recipes" title="Start from a recipe." align="left">
            Ready-made bots for common jobs, with the apps, channels and routines already picked. Make one yours in a tap, then change anything.
          </SectionHeader>
          <Button asChild variant="outline" size="lg" className="shrink-0">
            <Link href="/explore">
              Explore all recipes <ArrowRight />
            </Link>
          </Button>
        </div>
        <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {picks.map((r, i) => (
            <li key={r.slug} className={i >= 3 ? "hidden sm:block" : undefined}>
              <RecipeCard recipe={r} compact />
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
