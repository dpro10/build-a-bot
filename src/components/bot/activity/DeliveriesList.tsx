"use client";
import * as React from "react";
import { CircleAlert, MailOpen, RefreshCw } from "lucide-react";
import { BrandTile } from "@/components/brand/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { channelIcon, channelName, displayAddress } from "./receipt-meta";
import { ago, fullDateTime, whenLabel, useNow } from "./time";
import { radioKeyDown, radioTabIndex } from "./radio-keys";
import type { DeliveryView } from "./types";

const STATUS: Record<string, { label: string; tone: "success" | "neutral" | "danger"; hint: string }> = {
  sent: { label: "Sent", tone: "success", hint: "Handed to the provider for delivery." },
  simulated: { label: "Simulated", tone: "neutral", hint: "Demo mode: this shows what would have gone out. Nothing was really sent." },
  failed: { label: "Failed", tone: "danger", hint: "This one didn't go out." },
};

/** "by text", "by email", "on Telegram", "in the app" */
function viaPhrase(kind: string) {
  switch (kind) {
    case "web":
      return "in the app";
    case "sms":
      return "by text";
    case "voice":
      return "by phone call";
    case "email":
      return "by email";
    default:
      return `on ${channelName(kind)}`;
  }
}

export function DeliveriesList({
  botId,
  botName,
  timezone,
  serverNow,
  initial,
  ownerAddresses,
}: {
  botId: string;
  botName: string;
  timezone: string;
  serverNow: string;
  initial: DeliveryView[];
  ownerAddresses: string[];
}) {
  const now = useNow(serverNow);
  const [items, setItems] = React.useState(initial);
  const [channel, setChannel] = React.useState<string>("all");
  const [loading, setLoading] = React.useState(false);
  const mine = React.useMemo(() => new Set(ownerAddresses.map((a) => a.toLowerCase())), [ownerAddresses]);

  const counts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const d of items) m.set(d.channelKind, (m.get(d.channelKind) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const shown = channel === "all" ? items : items.filter((d) => d.channelKind === channel);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await api<{ deliveries: DeliveryView[] }>(`/api/bots/${botId}/deliveries`);
      setItems(
        res.deliveries.map((d) => ({
          id: d.id,
          channelKind: d.channelKind,
          to: d.to,
          subject: d.subject,
          body: d.body,
          status: d.status,
          error: d.error,
          createdAt: d.createdAt,
        })),
      );
    } catch (err) {
      toast.error((err as Error).message || "Couldn't refresh.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <div role="radiogroup" aria-label="Channel" className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          <FilterChip active={channel === "all"} index={0} onClick={() => setChannel("all")}>
            All <span className="font-normal tabular-nums">{items.length}</span>
          </FilterChip>
          {counts.map(([kind, n], i) => (
            <FilterChip key={kind} active={channel === kind} index={i + 1} onClick={() => setChannel(kind)}>
              <BrandTile icon={channelIcon(kind)} size={16} variant="tile" className="rounded-[5px]" />
              {channelName(kind)} <span className="font-normal tabular-nums">{n}</span>
            </FilterChip>
          ))}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={refresh} aria-label="Refresh" title="Refresh" disabled={loading}>
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
      </div>

      {!shown.length ? (
        <EmptyState icon={<MailOpen className="size-8" />} title="Nothing sent yet" className="bg-card/50">
          Texts, emails, calls and chat messages {botName} sends outside this app show up here, with whether they went through.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((d) => (
            <DeliveryCard key={d.id} d={d} toYou={d.channelKind === "web" || mine.has(d.to.toLowerCase())} now={now} timezone={timezone} />
          ))}
        </ul>
      )}
      {items.length >= 50 ? <p className="text-center text-xs text-muted-foreground">Showing the latest 50.</p> : null}
    </div>
  );
}

function FilterChip({ active, index, onClick, children }: { active: boolean; index: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      tabIndex={radioTabIndex(active, index, true)}
      onKeyDown={radioKeyDown}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition",
        active ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function DeliveryCard({ d, toYou, now, timezone }: { d: DeliveryView; toYou: boolean; now: Date; timezone: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const status = STATUS[d.status] ?? { label: d.status, tone: "neutral" as const, hint: "" };
  const long = d.body.length > 220 || d.body.split("\n").length > 4;
  return (
    <li className="flex gap-3 rounded-3xl border border-border bg-card p-4 shadow-soft sm:gap-4 sm:p-5">
      <BrandTile icon={channelIcon(d.channelKind)} size={40} variant="soft" className="rounded-2xl" label={channelName(d.channelKind)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold [overflow-wrap:anywhere]">
              {toYou ? "To you" : `To ${displayAddress(d.to)}`}
              <span className="font-normal text-muted-foreground"> {viaPhrase(d.channelKind)}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              <time dateTime={d.createdAt} title={fullDateTime(d.createdAt, timezone)}>
                {whenLabel(d.createdAt, now, timezone)}
              </time>
              <span aria-hidden> · </span>
              {ago(d.createdAt, now)}
              {toYou && d.channelKind !== "web" ? <span className="hidden sm:inline"> · {displayAddress(d.to)}</span> : null}
            </div>
          </div>
          <Tooltip content={status.hint}>
            <span tabIndex={0} className="shrink-0 rounded-full">
              <Badge tone={status.tone}>{status.label}</Badge>
            </span>
          </Tooltip>
        </div>
        {d.subject ? <div className="mt-2.5 text-sm font-semibold [overflow-wrap:anywhere]">{d.subject}</div> : null}
        <p className={cn("mt-1.5 text-sm leading-relaxed whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]", !expanded && long && "line-clamp-4")}>{d.body}</p>
        {long ? (
          <button type="button" onClick={() => setExpanded((e) => !e)} className="mt-1 text-xs font-semibold text-primary hover:underline">
            {expanded ? "Show less" : "Show all"}
          </button>
        ) : null}
        {d.error ? (
          <p className="mt-2 flex items-start gap-1.5 rounded-2xl bg-danger-soft px-3 py-2 text-xs text-danger">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden /> {d.error}
          </p>
        ) : null}
      </div>
    </li>
  );
}
