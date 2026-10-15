/**
 * Operator metrics for /admin: aggregates only — no names, emails, messages or
 * receipt contents. Access: emails listed in ADMIN_EMAILS (verified accounts);
 * in demo mode without ADMIN_EMAILS, anyone signed in can look (it's sample data).
 */
import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { demoMode } from "@/lib/env";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { periodKey } from "@/lib/utils";

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdmin(user: Pick<User, "email" | "emailVerifiedAt"> | null): boolean {
  const list = adminEmails();
  if (!list.length) return demoMode && Boolean(user);
  return Boolean(user?.email && user.emailVerifiedAt && list.includes(user.email.toLowerCase()));
}

const n = (v: unknown) => Number(v ?? 0);
const since = (days: number) => new Date(Date.now() - days * 86400_000);

export type Breakdown = { key: string; n: number }[];

export async function adminMetrics(db: Db) {
  const d1 = since(1);
  const d7 = since(7);
  const d30 = since(30);

  const [users] = await db
    .select({
      total: count(),
      signedUp: sql<number>`count(*) filter (where ${schema.users.emailVerifiedAt} is not null)`,
      new7: sql<number>`count(*) filter (where ${schema.users.createdAt} > ${d7})`,
    })
    .from(schema.users);

  const plans = await db
    .select({ plan: schema.users.plan, status: schema.users.planStatus, n: count() })
    .from(schema.users)
    .groupBy(schema.users.plan, schema.users.planStatus);
  const paying = plans.filter((p) => p.plan !== "free" && (p.status === "active" || p.status === "trialing"));
  const mrr = paying.reduce((sum, p) => sum + (PLANS[p.plan as PlanId]?.priceMonthly ?? 0) * n(p.n), 0);

  const [bots] = await db
    .select({
      total: count(),
      active7: sql<number>`count(*) filter (where ${schema.bots.lastActiveAt} > ${d7})`,
      active1: sql<number>`count(*) filter (where ${schema.bots.lastActiveAt} > ${d1})`,
      paused: sql<number>`count(*) filter (where ${schema.bots.status} = 'paused')`,
    })
    .from(schema.bots);

  const group = async (rows: Promise<{ key: unknown; n: number }[]>): Promise<Breakdown> =>
    (await rows).map((r) => ({ key: String(r.key ?? "unknown"), n: n(r.n) })).sort((a, b) => b.n - a.n);

  const brainKind = sql<string>`${schema.bots.brain}->>'kind'`;
  const brains = await group(db.select({ key: brainKind, n: count() }).from(schema.bots).groupBy(brainKind));
  const brainModel = sql<string>`${schema.bots.brain}->>'model'`;
  const models = await group(db.select({ key: brainModel, n: count() }).from(schema.bots).groupBy(brainModel));
  const trust = await group(db.select({ key: schema.bots.trust, n: count() }).from(schema.bots).groupBy(schema.bots.trust));
  const avatars = await group(db.select({ key: schema.bots.avatar, n: count() }).from(schema.bots).groupBy(schema.bots.avatar));

  const channels = await group(
    db.select({ key: schema.channels.kind, n: count() }).from(schema.channels).where(eq(schema.channels.status, "active")).groupBy(schema.channels.kind),
  );
  const waitlistChannels = await group(
    db.select({ key: schema.channels.kind, n: count() }).from(schema.channels).where(eq(schema.channels.status, "waitlist")).groupBy(schema.channels.kind),
  );
  const connectors = (
    await group(db.select({ key: schema.connections.connectorId, n: count() }).from(schema.connections).groupBy(schema.connections.connectorId))
  )
    .map((c) => ({ ...c, key: c.key.startsWith("custom_mcp:") ? "custom MCP" : c.key }))
    .reduce<Breakdown>((acc, c) => {
      const hit = acc.find((x) => x.key === c.key);
      if (hit) hit.n += c.n;
      else acc.push({ ...c });
      return acc;
    }, [])
    .sort((a, b) => b.n - a.n);

  const [messages] = await db
    .select({
      d1: sql<number>`count(*) filter (where ${schema.messages.createdAt} > ${d1})`,
      d7: sql<number>`count(*) filter (where ${schema.messages.createdAt} > ${d7})`,
      d30: sql<number>`count(*) filter (where ${schema.messages.createdAt} > ${d30})`,
    })
    .from(schema.messages);
  const messagesByChannel = await group(
    db
      .select({ key: schema.messages.channelKind, n: count() })
      .from(schema.messages)
      .where(and(gt(schema.messages.createdAt, d7), eq(schema.messages.role, "user")))
      .groupBy(schema.messages.channelKind),
  );

  const approvals = await group(
    db.select({ key: schema.approvals.status, n: count() }).from(schema.approvals).where(gt(schema.approvals.createdAt, d7)).groupBy(schema.approvals.status),
  );
  const receipts = await group(
    db.select({ key: schema.receipts.status, n: count() }).from(schema.receipts).where(gt(schema.receipts.createdAt, d7)).groupBy(schema.receipts.status),
  );
  const errorKinds = await group(
    db
      .select({ key: schema.receipts.kind, n: count() })
      .from(schema.receipts)
      .where(and(gt(schema.receipts.createdAt, d7), eq(schema.receipts.status, "error")))
      .groupBy(schema.receipts.kind),
  );

  const [usage] = await db
    .select({
      costMicros: sql<number>`coalesce(sum(${schema.usage.costMicros}), 0)`,
      tokensIn: sql<number>`coalesce(sum(${schema.usage.tokensIn}), 0)`,
      tokensOut: sql<number>`coalesce(sum(${schema.usage.tokensOut}), 0)`,
      searches: sql<number>`coalesce(sum(${schema.usage.searches}), 0)`,
      voiceSeconds: sql<number>`coalesce(sum(${schema.usage.voiceSeconds}), 0)`,
      meetingSeconds: sql<number>`coalesce(sum(${schema.usage.meetingSeconds}), 0)`,
      dictationWords: sql<number>`coalesce(sum(${schema.usage.dictationWords}), 0)`,
      smsSegments: sql<number>`coalesce(sum(${schema.usage.smsSegments}), 0)`,
      includedMessages: sql<number>`coalesce(sum(${schema.usage.includedMessages}), 0)`,
    })
    .from(schema.usage)
    .where(eq(schema.usage.period, periodKey()));

  const waitlist = await group(db.select({ key: schema.waitlist.feature, n: count() }).from(schema.waitlist).groupBy(schema.waitlist.feature));

  const recipes = await db
    .select({ slug: schema.recipes.slug, name: schema.recipes.name, clones: schema.recipes.clones })
    .from(schema.recipes)
    .where(eq(schema.recipes.public, true))
    .orderBy(desc(schema.recipes.clones))
    .limit(8);

  const signupsByDay = await db
    .select({ day: sql<string>`to_char(date_trunc('day', ${schema.users.createdAt}), 'YYYY-MM-DD')`, n: count() })
    .from(schema.users)
    .where(gt(schema.users.createdAt, since(14)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  return {
    users: { total: n(users.total), signedUp: n(users.signedUp), new7: n(users.new7) },
    plans: plans.map((p) => ({ plan: p.plan, status: p.status, n: n(p.n) })),
    paying: paying.reduce((s, p) => s + n(p.n), 0),
    mrr,
    bots: { total: n(bots.total), active7: n(bots.active7), active1: n(bots.active1), paused: n(bots.paused) },
    brains,
    models: models.slice(0, 8),
    trust,
    avatars,
    channels,
    waitlistChannels,
    connectors: connectors.slice(0, 12),
    messages: { d1: n(messages.d1), d7: n(messages.d7), d30: n(messages.d30) },
    messagesByChannel,
    approvals,
    receipts,
    errorKinds,
    usage: {
      costUsd: n(usage.costMicros) / 1_000_000,
      tokensIn: n(usage.tokensIn),
      tokensOut: n(usage.tokensOut),
      searches: n(usage.searches),
      voiceMinutes: Math.round(n(usage.voiceSeconds) / 60),
      meetingMinutes: Math.round(n(usage.meetingSeconds) / 60),
      dictationWords: n(usage.dictationWords),
      smsSegments: n(usage.smsSegments),
      includedMessages: n(usage.includedMessages),
    },
    waitlist,
    recipes,
    signupsByDay: signupsByDay.map((d) => ({ day: d.day, n: n(d.n) })),
  };
}

export type AdminMetrics = Awaited<ReturnType<typeof adminMetrics>>;
