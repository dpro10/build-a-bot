import { ArrowRight } from "lucide-react";
import { ROLES } from "@/lib/roles";

/**
 * One tap to a bot made for one job: its recipe fills in every step, and anything can still
 * change. Plain links: a recipe starts the builder fresh.
 */
export function ReadyMade() {
  return (
    <nav aria-labelledby="ready-made-title" className="mt-4 rounded-2xl border border-border bg-card/70 px-4 py-3">
      {/* A label, not a heading: it sits above the step's own heading. */}
      <p id="ready-made-title" className="text-sm font-semibold">
        Or start with a ready-made bot
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {ROLES.map((r) => (
          <li key={r.id}>
            <a
              href={`/build?recipe=${r.recipe}`}
              title={r.blurb}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3.5 py-2 text-sm font-semibold transition hover:border-primary/40 hover:bg-primary-soft/50 active:scale-[0.97]"
            >
              <span aria-hidden>{r.emoji}</span>
              {r.label}
            </a>
          </li>
        ))}
        <li>
          <a href="/explore" className="inline-flex items-center gap-1 px-2 py-2 text-sm font-semibold text-primary hover:underline">
            More ideas <ArrowRight className="size-3.5" aria-hidden />
          </a>
        </li>
      </ul>
    </nav>
  );
}
