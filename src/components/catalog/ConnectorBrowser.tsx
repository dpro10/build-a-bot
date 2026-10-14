"use client";
/**
 * The app catalog: search ~190 apps, browse by category, pick with one tap.
 * Used by the builder (multi-select) and the dashboard ("Add apps").
 */
import * as React from "react";
import { Check, Eye, Lock, Pencil, Plus, Search, Send, ShieldAlert, Sparkles, Trash2, Wallet, X } from "lucide-react";
import { ALL_CONNECTORS, type ConnectorDef } from "@/lib/connectors";
import type { Effect } from "@/lib/connectors/types";
import { BrandTile } from "@/components/brand/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ALWAYS_ON, AVAILABLE_APP_COUNT_ROUNDED, EFFECT_LABEL, categoryCounts, effectsOf, isAvailable, isBuiltin, matchScore, suggestedFor } from "./connector-meta";

const EFFECT_ICON: Record<Effect, React.ComponentType<{ className?: string }>> = {
  read: Eye,
  write: Pencil,
  send: Send,
  delete: Trash2,
  spend: Wallet,
  admin: ShieldAlert,
};

type Filter = "suggested" | "popular" | "all" | ConnectorDef["category"];

export function ConnectorBrowser({
  selected,
  onToggle,
  jobs = [],
  added = [],
  comingSoon,
  onCustomMcp,
  className,
  autoFocus,
  maxHeight,
}: {
  selected: string[];
  onToggle: (def: ConnectorDef) => void;
  /** Job ids; turns on the "Suggested" filter. */
  jobs?: string[];
  /** Already connected (dashboard): shown as "Added", not toggleable. */
  added?: string[];
  /** Built-ins this server can't run yet: shown as "Coming soon", not pickable. */
  comingSoon?: string[];
  /** Called when "Any MCP server" is picked. */
  onCustomMcp?: () => void;
  className?: string;
  autoFocus?: boolean;
  /** Scroll the results inside a box of this height (CSS length). */
  maxHeight?: string;
}) {
  const [query, setQuery] = React.useState("");
  const soon = React.useMemo(() => new Set(comingSoon), [comingSoon]);
  const suggestions = React.useMemo(() => suggestedFor(jobs, 18, soon), [jobs, soon]);
  const [filter, setFilter] = React.useState<Filter>(suggestions.length ? "suggested" : "popular");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  const addedSet = React.useMemo(() => new Set(added), [added]);
  const categories = React.useMemo(() => categoryCounts(), []);

  // Follow the jobs: show suggestions once there are some, unless the owner picked a filter.
  const userPickedFilter = React.useRef(false);
  const hasSuggestions = suggestions.length > 0;
  React.useEffect(() => {
    if (!userPickedFilter.current) setFilter(hasSuggestions ? "suggested" : "popular");
    else setFilter((f) => (f === "suggested" && !hasSuggestions ? "popular" : f));
  }, [hasSuggestions]);

  // "/" focuses search (when not typing somewhere else).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && t && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = React.useMemo(() => {
    const visible = ALL_CONNECTORS.filter((c) => !ALWAYS_ON.has(c.id));
    if (query.trim()) {
      return visible
        .map((c) => ({ c, s: matchScore(c, query) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => Number(isAvailable(b.c, soon)) - Number(isAvailable(a.c, soon)) || b.s - a.s || Number(!!b.c.popular) - Number(!!a.c.popular) || a.c.name.localeCompare(b.c.name))
        .map((x) => x.c);
    }
    let list: ConnectorDef[];
    if (filter === "suggested") list = suggestions;
    else if (filter === "popular") list = visible.filter((c) => c.popular);
    else if (filter === "all") list = visible;
    else list = visible.filter((c) => c.category === filter);
    if (filter !== "suggested") {
      list = [...list].sort((a, b) => Number(isAvailable(b, soon)) - Number(isAvailable(a, soon)) || Number(!!b.popular) - Number(!!a.popular) || a.name.localeCompare(b.name));
    }
    return list;
  }, [query, filter, suggestions, soon]);

  const selectedDefs = selected.map((id) => ALL_CONNECTORS.find((c) => c.id === id)).filter((c): c is ConnectorDef => Boolean(c) && !ALWAYS_ON.has(c!.id));

  const chips: { id: Filter; label: string; count?: number; icon?: React.ReactNode }[] = [
    ...(suggestions.length ? [{ id: "suggested" as Filter, label: "Suggested", icon: <Sparkles className="size-3.5" /> }] : []),
    { id: "popular", label: "Popular" },
    { id: "all", label: "All", count: ALL_CONNECTORS.length - ALWAYS_ON.size },
    ...categories.filter((c) => c.id !== "custom").map((c) => ({ id: c.id as Filter, label: c.label, count: c.count - [...ALWAYS_ON].filter((id) => ALL_CONNECTORS.find((x) => x.id === id)?.category === c.id).length })).filter((c) => (c.count ?? 0) > 0),
  ];

  const pick = (def: ConnectorDef) => {
    if (!isAvailable(def, soon) || addedSet.has(def.id)) return;
    if (def.id === "custom_mcp" && onCustomMcp && !selectedSet.has(def.id)) {
      onCustomMcp();
      return;
    }
    onToggle(def);
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${AVAILABLE_APP_COUNT_ROUNDED}+ apps…`}
          aria-label="Search apps"
          className="h-12 w-full rounded-2xl border border-input bg-card pr-12 pl-12 text-base text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-4 focus:ring-primary/15 [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button type="button" onClick={() => setQuery("")} className="absolute top-1/2 right-3 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Clear search">
            <X className="size-4" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute top-1/2 right-4 hidden -translate-y-1/2 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground sm:block">/</kbd>
        )}
      </div>

      {!query ? (
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="tablist" aria-label="App categories">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={filter === c.id}
              onClick={() => {
                userPickedFilter.current = true;
                setFilter(c.id);
              }}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition",
                filter === c.id ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
            >
              {c.icon}
              {c.label}
              {c.count ? <span className={cn("text-xs tabular-nums", filter === c.id ? "opacity-75" : "text-muted-foreground")}>{c.count}</span> : null}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {results.length ? `${results.length} app${results.length === 1 ? "" : "s"} match “${query.trim()}”` : null}
          </span>
        </div>
      )}

      {selectedDefs.length && !added.length ? (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Picked apps">
          {selectedDefs.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onToggle(d)}
              className="group inline-flex items-center gap-1.5 rounded-full bg-primary-soft py-1 pr-2 pl-1 text-xs font-semibold text-primary transition hover:brightness-95 dark:hover:brightness-125"
              aria-label={`Remove ${d.name}`}
            >
              <BrandTile icon={d.icon} size={20} />
              {d.name}
              <X className="size-3 opacity-60 group-hover:opacity-100" />
            </button>
          ))}
        </div>
      ) : null}

      <div className={cn(maxHeight && "scrollbar-thin -mr-2 overflow-y-auto pr-2")} style={maxHeight ? { maxHeight } : undefined}>
        {results.length ? (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((def) => (
              <li key={def.id}>
                <ConnectorCard def={def} available={isAvailable(def, soon)} selected={selectedSet.has(def.id)} added={addedSet.has(def.id)} onPick={() => pick(def)} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-10 text-center">
            <div className="font-display text-lg font-semibold">No app called “{query.trim()}” yet</div>
            <p className="max-w-sm text-sm text-muted-foreground">If it has an MCP server, you can plug it in directly. Otherwise, tell us what you need from the app and we&apos;ll prioritize it.</p>
            {onCustomMcp ? (
              <Button variant="soft" size="sm" onClick={onCustomMcp}>
                <Plus /> Add an MCP server by URL
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectorCard({ def, available, selected, added, onPick }: { def: ConnectorDef; available: boolean; selected: boolean; added: boolean; onPick: () => void }) {
  const effects = effectsOf(def);
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={!available || added}
      aria-pressed={available && !added ? selected : undefined}
      className={cn(
        "group relative flex h-full w-full items-start gap-3 rounded-2xl border bg-card p-3 text-left transition",
        available && !added && "hover:-translate-y-px hover:border-foreground/20 hover:shadow-soft",
        selected ? "border-primary ring-2 ring-primary/20" : "border-border",
        (!available || added) && "cursor-default",
        !available && "opacity-60",
      )}
    >
      <BrandTile icon={def.icon} size={40} className={cn(!available && "grayscale")} />
      <span className="min-w-0 flex-1">
        {/* Badges wrap under the name when they don't fit, so the name itself never shrinks to a letter. */}
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="max-w-full min-w-0 truncate font-semibold">{def.name}</span>
          {def.sensitive ? (
            <Tooltip content="Money, health or identity data: changes always ask you first.">
              <span className="inline-flex text-warning" aria-label="Sensitive: always asks before changes">
                <Lock className="size-3.5" />
              </span>
            </Tooltip>
          ) : null}
          {!available ? <Badge tone="neutral" className="px-1.5 py-0 text-[10px]">Coming soon</Badge> : def.status === "beta" ? <Badge tone="warning" className="px-1.5 py-0 text-[10px]">Beta</Badge> : null}
          {isBuiltin(def) && available ? <Badge tone="success" className="px-1.5 py-0 text-[10px]">No sign-in</Badge> : null}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-muted-foreground">{def.description}</span>
        {available ? (
          <span className="mt-1.5 flex items-center gap-1.5 text-muted-foreground/80" title={`Can: ${effects.map((e) => EFFECT_LABEL[e].toLowerCase()).join(", ")}`}>
            {effects.map((e) => {
              const Icon = EFFECT_ICON[e];
              return <Icon key={e} className={cn("size-3.5", (e === "spend" || e === "delete" || e === "admin") && "text-warning")} aria-hidden />;
            })}
            <span className="sr-only">Can: {effects.map((e) => EFFECT_LABEL[e].toLowerCase()).join(", ")}</span>
          </span>
        ) : null}
      </span>
      {available ? (
        <span
          className={cn(
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition",
            added ? "border-success bg-success text-success-foreground" : selected ? "border-primary bg-primary text-primary-foreground animate-pop" : "border-input text-transparent group-hover:border-foreground/30",
          )}
          aria-hidden
        >
          {added || selected ? <Check className="size-3.5" strokeWidth={3} /> : <Plus className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />}
        </span>
      ) : null}
      {added ? <span className="sr-only">Already added</span> : null}
    </button>
  );
}
