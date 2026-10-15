import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft } from "lucide-react";
import { getDb } from "@/lib/db";
import { getUser } from "@/lib/auth/session";
import { adminEmails, adminMetrics, isAdmin, type Breakdown } from "@/lib/admin/metrics";
import { demoMode } from "@/lib/env";
import { getConnector } from "@/lib/connectors";
import { CHANNEL_BY_KIND, type ChannelKind } from "@/lib/channels/catalog";
import { AVATARS, isAvatarId } from "@/lib/avatars";
import { TRUST, isTrustLevel } from "@/lib/trust";
import { INCLUDED_MODELS, PROVIDERS } from "@/lib/models/catalog";
import { getPlan } from "@/lib/billing/plans";
import { Logo } from "@/components/brand/Logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/** One lookup per request, shared by the title and the page. */
const viewer = cache(getUser);

/** Everyone else gets the 404 page, so they get its plain title too (not a hint of what's here). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: isAdmin(await viewer()) ? "Operator dashboard" : "Page not found", robots: { index: false } };
}

const fmt = new Intl.NumberFormat("en-US");
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** Subscription models are stored by the CLI's short names. */
const SUBSCRIPTION_MODEL: Record<string, string> = {
  default: "Subscription default",
  opus: "Claude Opus (subscription)",
  sonnet: "Claude Sonnet (subscription)",
  haiku: "Claude Haiku (subscription)",
};

/** Approval and receipt states, in the words the app uses for them. */
const STATUS_LABEL: Record<string, string> = {
  executed: "Approved and done",
  approved: "Approved",
  pending: "Waiting",
  pending_approval: "Waiting",
  denied: "Declined",
  expired: "Expired",
  failed: "Approved, but failed",
  ok: "Done",
  blocked: "Blocked",
  error: "Error",
};
const statusLabel = (k: string) => STATUS_LABEL[k] ?? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, " ");

export default async function AdminPage() {
  const user = await viewer();
  if (!isAdmin(user)) notFound();
  const m = await adminMetrics(await getDb());

  const label = {
    brain: (k: string) => ({ included: "Included models", byok: "Own API key", subscription: "Subscription (Bridge)" })[k] ?? k,
    model: (k: string) =>
      INCLUDED_MODELS.find((x) => x.id === k)?.label ?? PROVIDERS.flatMap((p) => p.models).find((x) => x.id === k)?.label ?? SUBSCRIPTION_MODEL[k] ?? k,
    trust: (k: string) => (isTrustLevel(k) ? `${TRUST[k].emoji} ${TRUST[k].name}` : k),
    avatar: (k: string) => (isAvatarId(k) ? AVATARS[k].character : k),
    channel: (k: string) => CHANNEL_BY_KIND[k as ChannelKind]?.name ?? k,
    connector: (k: string) => getConnector(k)?.name ?? k,
  };

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/app" aria-label="Your bots">
            <Logo className="text-lg" />
          </Link>
          <Badge tone="primary">Operator</Badge>
          <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
            Updated {new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" })}
          </span>
          <Button asChild variant="ghost" size="sm" className="ml-auto sm:ml-0">
            <Link href="/app">
              <ArrowLeft /> Back to the app
            </Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
        {demoMode && !adminEmails().length ? (
          <div className="rounded-2xl bg-warning-soft px-4 py-2.5 text-sm text-warning">
            Demo mode: anyone signed in can see this page. Set <code className="font-mono">ADMIN_EMAILS</code> to lock it to your team.
          </div>
        ) : null}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Monthly revenue (est.)" value={usd.format(m.mrr)} sub={`${fmt.format(m.paying)} paying`} />
          <Stat label="People" value={fmt.format(m.users.total)} sub={`${fmt.format(m.users.signedUp)} with email · +${fmt.format(m.users.new7)} this week`} />
          <Stat label="Bots" value={fmt.format(m.bots.total)} sub={`${fmt.format(m.bots.active7)} active this week · ${fmt.format(m.bots.paused)} paused`} />
          <Stat label="Messages" value={fmt.format(m.messages.d7)} sub={`${fmt.format(m.messages.d1)} today · ${fmt.format(m.messages.d30)} in 30 days`} />
        </section>

        <section className="grid gap-3 lg:grid-cols-3">
          <Panel title="Signups, last 14 days">
            <Spark data={m.signupsByDay} />
          </Panel>
          <Panel title="Plans">
            <Bars data={m.plans.map((p) => ({ key: `${p.plan}${p.status !== "active" ? ` (${p.status})` : ""}`, n: p.n }))} format={(k) => k.charAt(0).toUpperCase() + k.slice(1)} />
          </Panel>
          <Panel title="Included-model spend this month">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Kv k="Model cost" v={usd.format(m.usage.costUsd)} />
              <Kv k="Included messages" v={fmt.format(m.usage.includedMessages)} />
              <Kv k="Tokens in / out" v={`${fmt.format(m.usage.tokensIn)} / ${fmt.format(m.usage.tokensOut)}`} />
              <Kv k="Searches" v={fmt.format(m.usage.searches)} />
              <Kv k="Voice minutes" v={fmt.format(m.usage.voiceMinutes)} />
              <Kv k="Meeting minutes" v={fmt.format(m.usage.meetingMinutes)} />
              <Kv k="Voice typing words" v={fmt.format(m.usage.dictationWords)} />
              <Kv k="Text segments" v={fmt.format(m.usage.smsSegments)} />
            </dl>
          </Panel>
        </section>

        <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Panel title="Brains">
            <Bars data={m.brains} format={label.brain} />
          </Panel>
          <Panel title="Top models">
            <Bars data={m.models} format={label.model} />
          </Panel>
          <Panel title="Trust levels">
            <Bars data={m.trust} format={label.trust} />
          </Panel>
          <Panel title="Characters">
            <Bars data={m.avatars} format={label.avatar} />
          </Panel>
          <Panel title="Active channels">
            <Bars data={m.channels} format={label.channel} />
          </Panel>
          <Panel title="Messages by channel (7 days)">
            <Bars data={m.messagesByChannel} format={label.channel} />
          </Panel>
          <Panel title="Top apps">
            <Bars data={m.connectors} format={label.connector} />
          </Panel>
          <Panel title="Approvals (7 days)">
            <Bars data={m.approvals} format={statusLabel} />
          </Panel>
          <Panel title="Receipts (7 days)">
            <Bars data={m.receipts} format={statusLabel} />
            {m.errorKinds.length ? (
              <p className="mt-3 text-xs text-muted-foreground">Errors by kind: {m.errorKinds.map((e) => `${e.key} ${e.n}`).join(" · ")}</p>
            ) : null}
          </Panel>
          <Panel title="Waitlists">
            <Bars data={mergeWaitlists(m.waitlistChannels, m.waitlist, label)} />
          </Panel>
          <Panel title="Most-cloned recipes">
            {m.recipes.some((r) => r.clones > 0) ? (
              <ul className="flex flex-col gap-1.5 text-sm">
                {m.recipes
                  .filter((r) => r.clones > 0)
                  .map((r) => (
                  <li key={r.slug} className="flex justify-between gap-2">
                    <Link href={`/r/${r.slug}`} className="truncate hover:underline">
                      {r.name}
                    </Link>
                    <span className="text-muted-foreground tabular-nums">{fmt.format(r.clones)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {m.recipes.length ? `Nobody has made a copy yet. ${fmt.format(m.recipes.length)} shared so far.` : "Nothing shared yet."}
              </p>
            )}
          </Panel>
        </section>
        <p className="pb-4 text-center text-xs text-muted-foreground">Aggregates only — no names, emails, messages or receipt contents are shown here.</p>
      </main>
    </div>
  );
}

/** Channel rows on the waitlist plus waitlist sign-ups ("channel:whatsapp", "connector:strava", "plan:plus"), under one readable label each. */
function mergeWaitlists(channels: Breakdown, signups: Breakdown, label: { channel: (k: string) => string; connector: (k: string) => string }): Breakdown {
  const out = new Map<string, number>();
  const add = (key: string, n: number) => out.set(key, (out.get(key) ?? 0) + n);
  for (const c of channels) add(`${label.channel(c.key)} (channel)`, c.n);
  for (const w of signups) {
    const [kind, id] = w.key.includes(":") ? w.key.split(":", 2) : ["", w.key];
    add(
      kind === "channel" ? `${label.channel(id)} (channel)` : kind === "connector" ? `${label.connector(id)} (app)` : kind === "plan" ? `${getPlan(id).name} (plan)` : w.key,
      w.n,
    );
  }
  return [...out].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-3xl border border-border bg-card p-4 shadow-soft sm:p-5">
      <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="mt-1 font-display text-3xl font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-border bg-card p-4 shadow-soft sm:p-5">
      <h2 className="mb-3 font-display text-base font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium tabular-nums">{v}</dd>
    </>
  );
}

function Empty() {
  return <p className="text-sm text-muted-foreground">Nothing yet.</p>;
}

function Bars({ data, format = (k) => k }: { data: Breakdown; format?: (key: string) => string }) {
  if (!data.length) return <Empty />;
  const max = Math.max(...data.map((d) => d.n), 1);
  return (
    <ul className="flex flex-col gap-2">
      {data.slice(0, 10).map((d) => (
        <li key={d.key} className="text-sm">
          <div className="mb-0.5 flex justify-between gap-2">
            <span className="truncate">{format(d.key)}</span>
            <span className="text-muted-foreground tabular-nums">{fmt.format(d.n)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(3, (d.n / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** All 14 days (UTC, like the query), so quiet days show as gaps instead of disappearing. */
function lastDays(data: { day: string; n: number }[], days = 14): { day: string; n: number }[] {
  const byDay = new Map(data.map((d) => [d.day, d.n]));
  const today = new Date();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (days - 1 - i)));
    const day = d.toISOString().slice(0, 10);
    return { day, n: byDay.get(day) ?? 0 };
  });
}

const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function Spark({ data }: { data: { day: string; n: number }[] }) {
  if (!data.length) return <Empty />;
  const series = lastDays(data);
  const max = Math.max(...series.map((d) => d.n), 1);
  const total = series.reduce((sum, d) => sum + d.n, 0);
  return (
    <div>
      <div className="mb-2 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground tabular-nums">{fmt.format(total)}</span> in 14 days
      </div>
      <div className="flex h-24 items-end gap-1" role="img" aria-label={`Signups per day: ${series.map((d) => `${shortDay(d.day)} ${d.n}`).join(", ")}`}>
        {series.map((d) => (
          <div key={d.day} className="group relative flex h-full flex-1 items-end" title={`${shortDay(d.day)}: ${fmt.format(d.n)}`}>
            <div
              className={d.n ? "w-full rounded-t-md bg-primary/80 transition group-hover:bg-primary" : "h-1 w-full rounded-full bg-muted"}
              style={d.n ? { height: `${Math.max(6, (d.n / max) * 100)}%` } : undefined}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
        <span>{shortDay(series[0].day)}</span>
        <span>Today</span>
      </div>
    </div>
  );
}
