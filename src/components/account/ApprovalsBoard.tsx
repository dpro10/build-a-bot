"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Ban,
  Check,
  CircleCheck,
  CircleX,
  Clock,
  Eye,
  Gauge,
  Hand,
  Hourglass,
  KeyRound,
  LoaderCircle,
  Moon,
  PauseCircle,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  UserPlus,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { api, type ApiError } from "@/lib/client/api";
import { cn, relativeTime } from "@/lib/utils";
import type { AvatarId, ColorwayId } from "@/lib/avatars";
import { reasonCopy, type ReasonIcon } from "./approval-reasons";
import { readResult, type ApprovalBot, type ApprovalItem, type ApprovalResult } from "./approvals-shared";
import { timeLeft, useNow } from "./time";
import { WebFormPreview } from "@/components/chat/WebFormPreview";

type Local = { status: string; decidedAt: string; followUp?: string | null; result?: ApprovalResult | null };
type Decided = ApprovalItem & { followUp?: string | null; local?: boolean };

const REASON_ICONS: Record<ReasonIcon, LucideIcon> = {
  trust: Hand,
  stakes: TriangleAlert,
  person: UserPlus,
  guard: ShieldAlert,
  sensitive: ShieldCheck,
  delete: Trash2,
  limit: Gauge,
  moon: Moon,
  rule: SlidersHorizontal,
  secret: KeyRound,
  money: Wallet,
  pause: PauseCircle,
  eye: Eye,
};

/** "5 min ago", never "in a moment" when the server's clock is a little ahead of ours. */
const ago = (at: string, now: number) => relativeTime(at, Math.max(now, Date.parse(at)));

const VIA: Record<string, string> = { telegram: "Telegram", slack: "Slack", discord: "Discord", sms: "text", email: "email", voice: "a call" };

export function ApprovalsBoard({
  bots,
  pending,
  history,
  focusId,
  serverNow,
}: {
  bots: ApprovalBot[];
  pending: ApprovalItem[];
  history: ApprovalItem[];
  focusId?: string | null;
  serverNow: number;
}) {
  const router = useRouter();
  const now = useNow(serverNow, 30_000);
  const [local, setLocal] = React.useState<Record<string, Local>>({});
  const [highlight, setHighlight] = React.useState<string | null>(focusId ?? null);
  const botById = React.useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);

  // Approvals can arrive from any channel at any time: keep the page fresh while it's open.
  React.useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(refresh, 45_000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [router]);

  // Deep links from chat apps (?focus=apv_…): scroll to it and glow for a moment.
  React.useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`approval-${focusId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = setTimeout(() => setHighlight(null), 3500);
    return () => clearTimeout(timer);
  }, [focusId]);

  const open = pending.filter((a) => !local[a.id] && Date.parse(a.expiresAt) > now);
  const groups = groupByBot(open, botById);
  const decided = mergeDecided(pending, history, local, now);

  const decide = async (item: ApprovalItem, decision: "approve" | "deny") => {
    const bot = botById.get(item.botId);
    const name = bot?.name ?? "Your bot";
    setLocal((s) => ({ ...s, [item.id]: { status: decision === "approve" ? "approving" : "denying", decidedAt: new Date().toISOString() } }));
    try {
      const res = await api<{ approval: { status: string; decidedAt?: string | null; result?: unknown }; followUp: string | null }>(
        `/api/approvals/${item.id}`,
        { body: { decision } },
      );
      const result = readResult(res.approval.result);
      setLocal((s) => ({
        ...s,
        [item.id]: { status: res.approval.status, decidedAt: res.approval.decidedAt ?? s[item.id]?.decidedAt ?? new Date().toISOString(), followUp: res.followUp, result },
      }));
      if (decision === "deny") toast(`Declined. ${name} won't do it.`);
      else if (res.approval.status === "failed") toast.error(`Approved, but it didn't work.`, { description: result?.text ?? undefined });
      else toast.success(`Approved — ${name} took care of it.`);
    } catch (err) {
      const e = err as ApiError;
      const server = (e.data?.approval ?? null) as { status?: string; decidedAt?: string | null } | null;
      if (server?.status && server.status !== "pending") {
        const status = server.status;
        setLocal((s) => ({ ...s, [item.id]: { status, decidedAt: server.decidedAt ?? new Date().toISOString() } }));
      } else {
        setLocal((s) => {
          const next = { ...s };
          delete next[item.id];
          return next;
        });
      }
      toast.error(e.message || "Couldn't do that. Try again.");
    } finally {
      // Updates the sidebar badge and pulls in anything new.
      router.refresh();
    }
  };

  const firstBot = bots[0];

  return (
    <div className="flex flex-col gap-10">
      {groups.length ? (
        <div className="flex flex-col gap-8">
          <p className="-mt-4 flex items-center gap-2 text-sm font-medium" role="status">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-warning opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-warning" />
            </span>
            {open.length === 1 ? "1 thing is" : `${open.length} things are`} waiting on you
            {groups.length > 1 ? ` across ${groups.length} bots` : ""}.
          </p>
          {groups.map(({ bot, items }) => (
            <section key={bot.id} aria-labelledby={`group-${bot.id}`} className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Avatar avatar={bot.avatar} color={bot.color} size={52} mood={bot.paused ? "sleeping" : "alert"} />
                <div className="min-w-0 flex-1">
                  <h2 id={`group-${bot.id}`} className="truncate font-display text-lg font-semibold">
                    {bot.name}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {items.length} waiting · {bot.paused ? "Paused" : bot.trustName}
                  </p>
                </div>
                <Button asChild variant="ghost" size="sm" className="shrink-0">
                  <Link href={`/app/bots/${bot.id}`}>
                    Open chat <ArrowRight />
                  </Link>
                </Button>
              </div>
              {items.map((item) => (
                <PendingCard key={item.id} item={item} bot={bot} now={now} onDecide={decide} highlighted={highlight === item.id} />
              ))}
            </section>
          ))}
        </div>
      ) : (
        <AllClear bot={firstBot} />
      )}

      {decided.length ? (
        <section aria-labelledby="recently-decided">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 id="recently-decided" className="font-display text-xl font-semibold">
                Recently decided
              </h2>
              <p className="text-sm text-muted-foreground">What you said yes and no to, and how it went.</p>
            </div>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
            {decided.slice(0, 30).map((item) => (
              <HistoryRow key={item.id} item={item} bot={botById.get(item.botId)} now={now} highlighted={highlight === item.id} />
            ))}
          </ul>
        </section>
      ) : null}

      {firstBot ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <SlidersHorizontal className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Want fewer taps? Each bot&apos;s{" "}
            <Link href={`/app/bots/${firstBot.id}/tools`} className="font-medium text-foreground underline-offset-4 hover:underline">
              Apps &amp; trust
            </Link>{" "}
            page sets what it can do on its own. Some checks — like the prompt-injection guard — always ask, whatever the setting.
          </span>
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function groupByBot(items: ApprovalItem[], botById: Map<string, ApprovalBot>) {
  const map = new Map<string, { bot: ApprovalBot; items: ApprovalItem[]; newest: number }>();
  for (const item of items) {
    const bot = botById.get(item.botId) ?? {
      id: item.botId,
      name: "Your bot",
      avatar: "blip" as AvatarId,
      color: "ocean" as ColorwayId,
      paused: false,
      trustName: "",
    };
    const entry = map.get(bot.id) ?? { bot, items: [], newest: 0 };
    entry.items.push(item);
    entry.newest = Math.max(entry.newest, Date.parse(item.createdAt));
    map.set(bot.id, entry);
  }
  return [...map.values()]
    .map((g) => ({ ...g, items: g.items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) }))
    .sort((a, b) => b.newest - a.newest);
}

/** Server history + what was decided on this page (which may not be in the server list yet). */
function mergeDecided(pending: ApprovalItem[], history: ApprovalItem[], local: Record<string, Local>, now: number): Decided[] {
  const byId = new Map<string, Decided>();
  for (const h of history) byId.set(h.id, h);
  for (const p of pending) {
    if (!byId.has(p.id) && !local[p.id] && Date.parse(p.expiresAt) <= now) byId.set(p.id, { ...p, status: "expired" });
  }
  for (const [id, l] of Object.entries(local)) {
    const server = history.find((h) => h.id === id);
    const base = server ?? pending.find((p) => p.id === id);
    if (!base) continue;
    const settled = server && server.status !== "pending" && server.status !== "approved";
    byId.set(id, {
      ...base,
      status: settled ? server.status : l.status,
      decidedAt: base.decidedAt ?? l.decidedAt,
      result: (settled ? server.result : null) ?? l.result ?? base.result,
      followUp: l.followUp,
      local: true,
    });
  }
  const at = (d: Decided) => Date.parse(d.decidedAt ?? (d.status === "expired" ? d.expiresAt : d.createdAt));
  return [...byId.values()].sort((a, b) => at(b) - at(a));
}

// ---------------------------------------------------------------------------

function RiskBadge({ risk }: { risk: string }) {
  if (risk === "high") return <Badge tone="danger">High risk</Badge>;
  if (risk === "medium") return <Badge tone="warning">Medium risk</Badge>;
  return <Badge tone="neutral">Low risk</Badge>;
}

function PendingCard({
  item,
  bot,
  now,
  onDecide,
  highlighted,
}: {
  item: ApprovalItem;
  bot: ApprovalBot;
  now: number;
  onDecide: (item: ApprovalItem, decision: "approve" | "deny") => void;
  highlighted: boolean;
}) {
  const left = Date.parse(item.expiresAt) - now;
  const soon = left < 60 * 60 * 1000;
  const reasons = item.reasons.map((code) => ({ code, ...reasonCopy(code) }));
  const alarming = reasons.some((r) => r.tone === "danger");
  return (
    <article
      id={`approval-${item.id}`}
      aria-label={item.title}
      className={cn(
        "animate-fade-up scroll-mt-6 rounded-3xl border bg-card p-4 shadow-soft transition-shadow sm:p-5",
        alarming ? "border-danger/40 ring-4 ring-danger/10" : "border-warning/45 ring-4 ring-warning/10",
        highlighted && "ring-primary/30",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0">{item.app?.icon ?? <FallbackIcon />}</div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-snug break-words">{item.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            <span className="sm:hidden">
              <RiskBadge risk={item.risk} />
            </span>
            {item.app ? (
              <>
                <span>{item.app.name}</span>
                <span aria-hidden>·</span>
              </>
            ) : null}
            <span>Asked {ago(item.createdAt, now)}</span>
            <span aria-hidden>·</span>
            <span className={cn("inline-flex items-center gap-1", soon && "font-semibold text-warning")}>
              <Clock className="size-3.5" aria-hidden />
              Expires in {timeLeft(Date.parse(item.expiresAt), now)}
            </span>
          </div>
        </div>
        <div className="hidden shrink-0 sm:block">
          <RiskBadge risk={item.risk} />
        </div>
      </div>

      {item.webForm ? <WebFormPreview preview={item.webForm} /> : null}

      {item.fields.length ? (
        <dl className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-background-2/50">
          {item.fields.map((f, i) => (
            <div key={`${f.label}-${i}`} className={cn("px-3.5 py-2.5", f.long ? "" : "flex gap-3")}>
              <dt className={cn("shrink-0 text-xs font-semibold text-muted-foreground", f.long ? "" : "w-20 pt-0.5")}>{f.label}</dt>
              <dd
                className={cn(
                  "min-w-0 text-sm break-words text-foreground",
                  f.long && "scrollbar-thin mt-1 max-h-52 overflow-y-auto leading-relaxed whitespace-pre-wrap",
                )}
              >
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {reasons.length ? (
        <div className={cn("mt-4 rounded-2xl p-3.5", alarming ? "bg-danger-soft" : "bg-muted/70")}>
          <div className={cn("text-xs font-bold tracking-wide uppercase", alarming ? "text-danger" : "text-muted-foreground")}>Why it&apos;s asking</div>
          <ul className="mt-2 flex flex-col gap-2">
            {reasons.map((r) => {
              const Icon = REASON_ICONS[r.icon];
              return (
                <li key={r.code} className="flex gap-2.5 text-sm leading-snug">
                  <Icon
                    className={cn("mt-0.5 size-4 shrink-0", r.tone === "danger" ? "text-danger" : r.tone === "warning" ? "text-warning" : "text-muted-foreground")}
                    aria-hidden
                  />
                  <span>
                    <span className="font-semibold">{r.label}.</span> <span className="text-foreground/85">{r.text}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button
            onClick={() => onDecide(item, "approve")}
            disabled={bot.paused}
            aria-label={`Approve: ${item.title}`}
            aria-describedby={bot.paused ? `paused-${item.id}` : undefined}
          >
            <Check /> Approve
          </Button>
          <Button variant="outline" onClick={() => onDecide(item, "deny")} aria-label={`Deny: ${item.title}`}>
            <X /> Deny
          </Button>
        </div>
        {bot.paused ? (
          <span id={`paused-${item.id}`} className="text-xs text-muted-foreground sm:ml-auto">
            {bot.name} is paused. Resume it to approve.
          </span>
        ) : null}
      </div>
    </article>
  );
}

function FallbackIcon() {
  return (
    <span className="inline-flex size-10 items-center justify-center rounded-[28%] bg-warning-soft text-warning">
      <ShieldAlert className="size-5" aria-hidden />
    </span>
  );
}

function statusView(status: string, via: string | null): { label: string; icon: React.ReactNode; className: string } {
  // STOP cancels everything a bot was waiting on.
  if (status === "expired" && via === "stop") return { label: "Canceled by STOP", icon: <PauseCircle className="size-4" />, className: "text-muted-foreground" };
  switch (status) {
    case "approving":
      return { label: "Approving…", icon: <LoaderCircle className="size-4 animate-spin" />, className: "text-primary" };
    case "denying":
      return { label: "Declining…", icon: <LoaderCircle className="size-4 animate-spin" />, className: "text-muted-foreground" };
    case "executed":
      return { label: "Approved · done", icon: <CircleCheck className="size-4" />, className: "text-success" };
    case "approved":
      return { label: "Approved", icon: <CircleCheck className="size-4" />, className: "text-success" };
    case "failed":
      return { label: "Approved, but it failed", icon: <CircleX className="size-4" />, className: "text-danger" };
    case "denied":
      return { label: "You declined", icon: <Ban className="size-4" />, className: "text-muted-foreground" };
    default:
      return { label: "Expired", icon: <Hourglass className="size-4" />, className: "text-muted-foreground" };
  }
}

function HistoryRow({ item, bot, now, highlighted }: { item: Decided; bot?: ApprovalBot; now: number; highlighted: boolean }) {
  const view = statusView(item.status, item.decidedVia);
  const when = item.decidedAt ?? (item.status === "expired" ? item.expiresAt : item.createdAt);
  const via = item.decidedVia ? (VIA[item.decidedVia] ?? null) : null;
  return (
    <li id={`approval-${item.id}`} className={cn("flex gap-3 px-4 py-3.5 transition-colors sm:px-5", item.local && "animate-fade-up", highlighted && "bg-primary-soft/60")}>
      <span className={cn("mt-0.5 shrink-0", view.className)} aria-hidden>
        {view.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-snug break-words">{item.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          {bot ? (
            <span className="inline-flex items-center gap-1">
              <Avatar avatar={bot.avatar} color={bot.color} size={18} animated={false} title={bot.name} />
              {bot.name}
            </span>
          ) : null}
          {bot ? <span aria-hidden>·</span> : null}
          <span className={cn("font-semibold", view.className)}>{view.label}</span>
          {item.status !== "approving" && item.status !== "denying" ? (
            <>
              <span aria-hidden>·</span>
              <span>
                {ago(when, now)}
                {via ? ` · from ${via}` : ""}
              </span>
            </>
          ) : null}
        </div>
        {item.status === "failed" && item.result?.text ? <p className="mt-1.5 text-xs text-danger">{item.result.text}</p> : null}
        {item.followUp && bot ? (
          <div className="mt-2.5 flex items-start gap-2">
            <Avatar avatar={bot.avatar} color={bot.color} size={24} mood="happy" />
            <p className="rounded-2xl rounded-tl-md bg-muted px-3 py-1.5 text-sm leading-snug">{item.followUp}</p>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function AllClear({ bot }: { bot?: ApprovalBot }) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border bg-card px-6 py-12 text-center shadow-soft sm:py-14">
      <div className="dot-grid absolute inset-0 opacity-60" aria-hidden />
      <div className="relative flex flex-col items-center">
        <Avatar avatar={bot?.avatar ?? "sprout"} color={bot?.color} size={128} mood="happy" />
        <h2 className="mt-3 font-display text-2xl font-bold">Nothing waiting on you.</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          When a bot needs your OK — to message someone new, delete things or spend money — it shows up here. Bots on Telegram, Slack or
          Discord send you Approve buttons there too.
        </p>
        {bot ? (
          <Button asChild variant="soft" className="mt-5">
            <Link href={`/app/bots/${bot.id}`}>
              Chat with {bot.name} <ArrowRight />
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
