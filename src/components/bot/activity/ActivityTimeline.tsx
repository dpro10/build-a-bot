"use client";
import * as React from "react";
import { ChevronDown, Hand, Inbox, Layers, Lock, RefreshCw, Send, Settings2, Zap, type LucideIcon } from "lucide-react";
import { BrandTile } from "@/components/brand/icons";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { channelIcon, channelName, detailRows, prettyTitle, receiptLook, ReceiptIcon, StatusBadge } from "./receipt-meta";
import { ago, dayKey, dayLabel, fullDateTime, timeLabel, useNow } from "./time";
import { radioKeyDown, radioTabIndex } from "./radio-keys";
import type { ActivityFilter, AppInfo, ReceiptView } from "./types";

const PAGE = 30;

const FILTERS: { id: ActivityFilter; label: string; icon: LucideIcon }[] = [
  { id: "all", label: "All", icon: Layers },
  { id: "actions", label: "Actions", icon: Zap },
  { id: "messages", label: "Messages", icon: Send },
  { id: "approvals", label: "Approvals", icon: Hand },
  { id: "settings", label: "Settings", icon: Settings2 },
];

const EMPTY: Record<ActivityFilter, { title: string; body: (bot: string) => string }> = {
  all: { title: "Nothing yet", body: (bot) => `When ${bot} does something, the receipt shows up here.` },
  actions: { title: "No actions yet", body: (bot) => `Searches, reminders, emails and everything else ${bot} does in your apps will show up here.` },
  messages: { title: "No messages sent yet", body: (bot) => `When ${bot} texts, emails, calls or messages anyone (you included), there's a receipt here.` },
  approvals: { title: "Nothing to approve so far", body: (bot) => `When ${bot} asks before acting, and what you decided, shows up here.` },
  settings: { title: "No setting changes yet", body: () => "Changes to its look, brain, trust level and apps are logged here." },
};

type Page = { receipts: ReceiptView[]; nextBefore: string | null; apps: Record<string, AppInfo> };

export function ActivityTimeline({
  botId,
  botName,
  timezone,
  serverNow,
  initialFilter,
  initial,
}: {
  botId: string;
  botName: string;
  timezone: string;
  serverNow: string;
  initialFilter: ActivityFilter;
  initial: Page;
}) {
  const now = useNow(serverNow);
  const [filter, setFilter] = React.useState<ActivityFilter>(initialFilter);
  const [items, setItems] = React.useState<ReceiptView[]>(initial.receipts);
  const [apps, setApps] = React.useState<Record<string, AppInfo>>(initial.apps);
  const [hasMore, setHasMore] = React.useState(initial.receipts.length >= PAGE);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  const request = React.useRef(0);

  const fetchPage = React.useCallback(
    async (f: ActivityFilter, before?: string) => {
      const qs = new URLSearchParams({ botId, limit: String(PAGE) });
      if (f !== "all") qs.set("filter", f);
      if (before) qs.set("before", before);
      const page = await api<{ receipts: (ReceiptView & { createdAt: string })[]; nextBefore: string | null; apps: Record<string, AppInfo> }>(`/api/receipts?${qs}`);
      return {
        ...page,
        receipts: page.receipts.map((r) => ({
          id: r.id,
          kind: r.kind,
          status: r.status,
          title: r.title,
          detail: r.detail ?? {},
          costMicros: Number(r.costMicros) || 0,
          createdAt: r.createdAt,
        })),
      };
    },
    [botId],
  );

  const load = React.useCallback(
    async (f: ActivityFilter) => {
      const id = ++request.current;
      setLoading(true);
      try {
        const page = await fetchPage(f);
        if (id !== request.current) return;
        setItems(page.receipts);
        setApps((a) => ({ ...a, ...page.apps }));
        setHasMore(page.receipts.length >= PAGE);
        setOpen(new Set());
      } catch (err) {
        if (id === request.current) toast.error((err as Error).message || "Couldn't load activity.");
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [fetchPage],
  );

  const choose = (f: ActivityFilter) => {
    if (f === filter) return;
    setFilter(f);
    void load(f);
    const url = new URL(window.location.href);
    if (f === "all") url.searchParams.delete("filter");
    else url.searchParams.set("filter", f);
    window.history.replaceState(window.history.state, "", url);
  };

  const loadMore = async () => {
    const last = items[items.length - 1];
    if (!last) return;
    setLoadingMore(true);
    const id = request.current;
    try {
      // +1 ms: timestamps carry microseconds the browser can't see; overlap a little and de-dupe.
      const before = new Date(new Date(last.createdAt).getTime() + 1).toISOString();
      const page = await fetchPage(filter, before);
      if (id !== request.current) return;
      const seen = new Set(items.map((r) => r.id));
      const fresh = page.receipts.filter((r) => !seen.has(r.id));
      setItems((cur) => [...cur, ...fresh]);
      setApps((a) => ({ ...a, ...page.apps }));
      setHasMore(page.receipts.length >= PAGE && fresh.length > 0);
    } catch (err) {
      toast.error((err as Error).message || "Couldn't load more.");
    } finally {
      setLoadingMore(false);
    }
  };

  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const groups = React.useMemo(() => {
    const out: { key: string; items: ReceiptView[] }[] = [];
    for (const r of items) {
      const key = dayKey(r.createdAt, timezone);
      const g = out[out.length - 1];
      if (g && g.key === key) g.items.push(r);
      else out.push({ key, items: [r] });
    }
    return out;
  }, [items, timezone]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <div role="radiogroup" aria-label="Show" className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {FILTERS.map((f, i) => {
            const active = f.id === filter;
            const Icon = f.icon;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={radioTabIndex(active, i, true)}
                onKeyDown={radioKeyDown}
                onClick={() => choose(f.id)}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition",
                  active ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {f.label}
              </button>
            );
          })}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => load(filter)} aria-label="Refresh" title="Refresh" disabled={loading}>
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
      </div>

      {loading && !items.length ? (
        <TimelineSkeleton />
      ) : !items.length ? (
        <EmptyState icon={<Inbox className="size-8" />} title={EMPTY[filter].title} className="bg-card/50">
          {EMPTY[filter].body(botName)}
        </EmptyState>
      ) : (
        <div className={cn("flex flex-col gap-5 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
          {groups.map((g) => (
            <section key={g.key} aria-label={dayLabel(g.key, now, timezone)}>
              <h3 className="sticky top-0 z-10 -mx-1 mb-2 bg-background/90 px-1 py-1.5 text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase backdrop-blur">
                {dayLabel(g.key, now, timezone)}
              </h3>
              <ol className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
                {g.items.map((r, i) => (
                  <ReceiptRow
                    key={r.id}
                    receipt={r}
                    apps={apps}
                    open={open.has(r.id)}
                    onToggle={() => toggle(r.id)}
                    now={now}
                    timezone={timezone}
                    first={i === 0}
                  />
                ))}
              </ol>
            </section>
          ))}
          <div className="flex justify-center pt-1 pb-2">
            {hasMore ? (
              <Button variant="outline" onClick={loadMore} loading={loadingMore}>
                Load more
              </Button>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="size-3.5" aria-hidden /> That&apos;s everything{filter === "all" ? ` since ${botName} was born` : ""}.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReceiptRow({
  receipt: r,
  apps,
  open,
  onToggle,
  now,
  timezone,
  first,
}: {
  receipt: ReceiptView;
  apps: Record<string, AppInfo>;
  open: boolean;
  onToggle: () => void;
  now: Date;
  timezone: string;
  first: boolean;
}) {
  const look = receiptLook(r, apps);
  const panelId = `rcp-${r.id}`;
  const rows = open ? detailRows(r, apps) : [];
  const tokens = look.compact ? Number(r.detail.inputTokens ?? 0) + Number(r.detail.outputTokens ?? 0) : 0;
  const Icon = look.icon;
  return (
    <li className={cn(!first && "border-t border-border", look.compact && !open && "bg-background-2/40")}>
      {look.compact ? (
        // Brain usage: one quiet line, so the real actions stand out.
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className={cn(
            "flex w-full items-center gap-3 px-4 py-2 text-left text-xs text-muted-foreground transition hover:bg-muted/40 hover:text-foreground focus-visible:-outline-offset-2 sm:px-5",
            open && "bg-muted/30",
          )}
        >
          <span className="flex w-9 shrink-0 justify-center" aria-hidden>
            <Icon className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate">
            {prettyTitle(r.title)}
            {tokens > 0 ? <span className="hidden sm:inline"> · {tokens.toLocaleString("en-US")} tokens</span> : null}
          </span>
          <time dateTime={r.createdAt} title={fullDateTime(r.createdAt, timezone)} className="shrink-0 tabular-nums">
            {timeLabel(r.createdAt, timezone)}
          </time>
          <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className={cn(
            "flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-muted/40 focus-visible:-outline-offset-2 sm:px-5",
            open && "bg-muted/30",
          )}
        >
          <ReceiptIcon look={look} size={36} />
          <span className="min-w-0 flex-1">
            <span className="flex items-start gap-2">
              <span className="min-w-0 flex-1 text-sm leading-snug font-semibold [overflow-wrap:anywhere]">{prettyTitle(r.title)}</span>
              <StatusBadge look={look} className="mt-px hidden shrink-0 sm:inline-flex" />
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
              <StatusBadge look={look} className="sm:hidden" />
              {look.app?.info && !look.tile ? (
                <>
                  <span className="inline-flex items-center gap-1">
                    <BrandTile icon={look.app.info.icon} size={14} variant="tile" className="rounded-[4px]" />
                    {look.app.info.name}
                  </span>
                  <span aria-hidden>·</span>
                </>
              ) : look.app?.info ? (
                <>
                  <span>{look.app.info.name}</span>
                  <span aria-hidden>·</span>
                </>
              ) : null}
              {look.channel && r.kind !== "message" ? (
                <>
                  <span className="inline-flex items-center gap-1">
                    <BrandTile icon={channelIcon(look.channel)} size={14} variant="tile" className="rounded-[4px]" />
                    {channelName(look.channel)}
                  </span>
                  <span aria-hidden>·</span>
                </>
              ) : null}
              <time dateTime={r.createdAt} title={fullDateTime(r.createdAt, timezone)}>
                {timeLabel(r.createdAt, timezone)}
              </time>
              <span aria-hidden>·</span>
              <span>{ago(r.createdAt, now)}</span>
            </span>
          </span>
          <ChevronDown className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      )}
      {open ? (
        <div id={panelId} className="animate-fade-up px-4 pb-4 sm:pr-5 sm:pl-[68px]">
          {rows.length ? (
            <dl className="grid grid-cols-1 gap-x-5 gap-y-1 rounded-2xl bg-muted/50 p-4 text-sm sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-y-2.5">
              {rows.map((row) => (
                <React.Fragment key={row.key}>
                  <dt className="pt-1.5 text-xs font-semibold text-muted-foreground first:pt-0 sm:pt-0 sm:text-sm sm:font-medium">{row.label}</dt>
                  <dd className="min-w-0 [overflow-wrap:anywhere]">{row.value}</dd>
                </React.Fragment>
              ))}
            </dl>
          ) : (
            <p className="rounded-2xl bg-muted/50 p-4 text-sm text-muted-foreground">No extra details on this one.</p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="size-3.5" aria-hidden /> Recorded {fullDateTime(r.createdAt, timezone)}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="font-mono">{r.id}</span>
              <CopyButton value={r.id} label="Copy ID" copiedLabel="Copied" variant="ghost" size="sm" className="h-7 px-2 text-xs" />
            </span>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function TimelineSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-3xl border border-border bg-card p-4 shadow-soft">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-1.5">
          <Skeleton className="size-9 rounded-2xl" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
