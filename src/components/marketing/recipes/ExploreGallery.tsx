"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export type GalleryItem = { slug: string; jobs: string[]; node: React.ReactNode };
export type GalleryFilter = { id: string; label: string; emoji: string; count: number };

/** Job filter chips over server-rendered recipe cards. Keeps the choice in ?job= so it can be shared. */
export function ExploreGallery({
  items,
  filters,
  initial,
  trailing,
}: {
  items: GalleryItem[];
  filters: GalleryFilter[];
  initial?: string | null;
  trailing?: React.ReactNode;
}) {
  const valid = (id: string | null | undefined) => (id && filters.some((f) => f.id === id) ? id : null);
  const [job, setJob] = React.useState<string | null>(valid(initial));

  const choose = (id: string | null) => {
    setJob(id);
    try {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("job", id);
      else url.searchParams.delete("job");
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* URL API unavailable: the filter still works, it just isn't shareable */
    }
  };

  const shown = job ? items.filter((i) => i.jobs.includes(job)) : items;

  return (
    <div>
      <div role="toolbar" aria-label="Filter recipes by job" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:justify-center sm:px-0">
        <Chip active={job === null} onClick={() => choose(null)} label="All" count={items.length} />
        {filters.map((f) => (
          <Chip key={f.id} active={job === f.id} onClick={() => choose(f.id)} label={f.label} emoji={f.emoji} count={f.count} />
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {shown.length} recipe{shown.length === 1 ? "" : "s"} shown
      </p>
      <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((i) => (
          <li key={i.slug} className="animate-fade-up">
            {i.node}
          </li>
        ))}
        {trailing ? <li>{trailing}</li> : null}
      </ul>
    </div>
  );
}

function Chip({ active, onClick, label, emoji, count }: { active: boolean; onClick: () => void; label: string; emoji?: string; count: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
        active ? "border-transparent bg-foreground text-background shadow-soft" : "border-border bg-card text-foreground hover:bg-muted",
      )}
    >
      {emoji ? <span aria-hidden="true">{emoji}</span> : null}
      {label}
      <span className={cn("text-xs tabular-nums", active ? "text-background/70" : "text-muted-foreground")}>{count}</span>
    </button>
  );
}
