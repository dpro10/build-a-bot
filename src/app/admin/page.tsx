import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getUser } from "@/lib/auth/session";
import { adminEmails, adminMetrics, isAdmin, type Breakdown } from "@/lib/admin/metrics";
import { demoMode } from "@/lib/env";
import { getConnector } from "@/lib/connectors";
import { CHANNEL_BY_KIND, type ChannelKind } from "@/lib/channels/catalog";
import { AVATARS, isAvatarId } from "@/lib/avatars";
import { TRUST, isTrustLevel } from "@/lib/trust";
import { INCLUDED_MODELS } from "@/lib/models/catalog";
import { Logo } from "@/components/brand/Logo";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Operator dashboard", robots: { index: false } };
export const dynamic = "force-dynamic";

const fmt = new Intl.NumberFormat("en-US");
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export default async function AdminPage() {
  const user = await getUser();
  if (!isAdmin(user)) notFound();
  const m = await adminMetrics(await getDb());

  const label = {
    brain: (k: string) => ({ included: "Included models", byok: "Own API key", subscription: "Subscription (Bridge)" })[k] ?? k,
    model: (k: string) => INCLUDED_MODELS.find((x) => x.id === k)?.label ?? k,
    trust: (k: string) => (isTrustLevel(k) ? `${TRUST[k].emoji} ${TRUST[k].name}` : k),
    avatar: (k: string) => (isAvatarId(k) ? AVATARS[k].character : k),
    channel: (k: string) => CHANNEL_BY_KIND[k as ChannelKind]?.name ?? k,
    connector: (k: string) => getConnector(k)?.name ?? k,
  };

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/app" aria-label="Back to the app">
            <Logo className="text-lg" />
          </Link>
          <Badge tone="primary">Operator</Badge>
          <span className="ml-auto text-xs text-muted-foreground">Updated {new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
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
            <Bars data={m.approvals} />
          </Panel>
          <Panel title="Receipts (7 days)">
            <Bars data={m.receipts} />
            {m.errorKinds.length ? (
              <p className="mt-3 text-xs text-muted-foreground">Errors by kind: {m.errorKinds.map((e) => `${e.key} ${e.n}`).join(" · ")}</p>
            ) : null}
          </Panel>
          <Panel title="Waitlists">
            <Bars data={mergeWaitlists(m.waitlistChannels, m.waitlist, label)} />
          </Panel>
          <Panel title="Most-cloned recipes">
            {m.recipes.length ? (
              <ul className="flex flex-col gap-1.5 text-sm">
                {m.recipes.map((r) => (
                  <li key={r.slug} className="flex justify-between gap-2">
                    <Link href={`/r/${r.slug}`} className="truncate hover:underline">
                      {r.name}
                    </Link>
                    <span className="text-muted-foreground tabular-nums">{fmt.format(r.clones)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty />
            )}
          </Panel>
        </section>
        <p className="pb-4 text-center text-xs text-muted-foreground">Aggregates only — no names, emails, messages or receipt contents are shown here.</p>
      </main>
    </div>
  );
}

/** Channel rows on the waitlist plus waitlist sign-ups ("channel:whatsapp", "connector:strava"), under one readable label each. */
function mergeWaitlists(channels: Breakdown, signups: Breakdown, label: { channel: (k: string) => string; connector: (k: string) => string }): Breakdown {
  const out = new Map<string, number>();
  const add = (key: string, n: number) => out.set(key, (out.get(key) ?? 0) + n);
  for (const c of channels) add(`${label.channel(c.key)} (channel)`, c.n);
  for (const w of signups) {
    const [kind, id] = w.key.includes(":") ? w.key.split(":", 2) : ["", w.key];
    add(kind === "channel" ? `${label.channel(id)} (channel)` : kind === "connector" ? `${label.connector(id)} (app)` : w.key, w.n);
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

function Spark({ data }: { data: { day: string; n: number }[] }) {
  if (!data.length) return <Empty />;
  const max = Math.max(...data.map((d) => d.n), 1);
  return (
    <div className="flex h-28 items-end gap-1" role="img" aria-label={`Signups per day: ${data.map((d) => `${d.day} ${d.n}`).join(", ")}`}>
      {data.map((d) => (
        <div key={d.day} className="group relative flex-1" title={`${d.day}: ${d.n}`}>
          <div className="w-full rounded-t-md bg-primary/80 transition group-hover:bg-primary" style={{ height: `${Math.max(4, (d.n / max) * 104)}px` }} />
        </div>
      ))}
    </div>
  );
}
