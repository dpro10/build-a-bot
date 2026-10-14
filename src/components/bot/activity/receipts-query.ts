/**
 * Server-only receipt queries for the Activity tab (and GET /api/receipts).
 * Owner-scoped like everything in src/lib/data: every query filters by ownerId.
 */
import { and, desc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Receipt } from "@/lib/db/schema";
import { getConnector } from "@/lib/connectors";
import type { IconSpec } from "@/components/brand/icons";
import { ACTIVITY_FILTERS, type ActivityFilter, type AppInfo, type ReceiptView } from "./types";

export function isActivityFilter(value: unknown): value is ActivityFilter {
  return typeof value === "string" && (ACTIVITY_FILTERS as readonly string[]).includes(value);
}

function filterWhere(filter: ActivityFilter): SQL | undefined {
  const r = schema.receipts;
  switch (filter) {
    case "actions":
      return inArray(r.kind, ["tool", "policy", "routine"]);
    case "messages":
      return eq(r.kind, "message");
    case "approvals":
      // Asked / declined (kind approval) plus approved-and-run actions (tool receipts that carry an approval id).
      return or(eq(r.kind, "approval"), and(eq(r.kind, "tool"), sql`(${r.detail} ->> 'approvalId') is not null`));
    case "settings":
      return inArray(r.kind, ["system", "stop", "channel"]);
    default:
      return undefined;
  }
}

/**
 * Newest first. Scope by a bot the caller already proved they own (a bot's
 * receipts stay with it even if its owner's account was merged), or by owner.
 */
export async function queryReceipts(
  db: Db,
  scope: { botId: string } | { ownerId: string },
  opts: { filter?: ActivityFilter; kind?: string; before?: Date; limit?: number } = {},
): Promise<Receipt[]> {
  const r = schema.receipts;
  const conds: SQL[] = ["botId" in scope ? eq(r.botId, scope.botId) : eq(r.ownerId, scope.ownerId)];
  if (opts.kind) conds.push(eq(r.kind, opts.kind));
  const f = opts.filter ? filterWhere(opts.filter) : undefined;
  if (f) conds.push(f);
  if (opts.before && !Number.isNaN(opts.before.getTime())) conds.push(lt(r.createdAt, opts.before));
  return db
    .select()
    .from(r)
    .where(and(...conds))
    .orderBy(desc(r.createdAt), desc(r.id))
    .limit(Math.max(1, Math.min(100, opts.limit ?? 40)));
}

/** Counts for the "last 7 days" tiles. Call only for a bot the caller owns. */
export async function receiptStats(db: Db, botId: string, days = 7) {
  const r = schema.receipts;
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await db
    .select({ kind: r.kind, status: r.status, n: sql<number>`count(*)::int` })
    .from(r)
    .where(and(eq(r.botId, botId), gte(r.createdAt, since)))
    .groupBy(r.kind, r.status);
  let actions = 0;
  let messages = 0;
  let asked = 0;
  let blocked = 0;
  for (const row of rows) {
    const n = Number(row.n) || 0;
    if ((row.kind === "tool" || row.kind === "routine") && row.status === "ok") actions += n;
    if (row.kind === "message") messages += n;
    if (row.kind === "approval" && row.status === "pending") asked += n;
    if (row.status === "blocked") blocked += n;
  }
  return { actions, messages, asked, blocked };
}

/** Names and icons for the apps receipts mention, so the browser needn't load the whole catalog. */
export function appsFor(receipts: Pick<Receipt, "detail">[]): Record<string, AppInfo> {
  const ids = new Set<string>();
  for (const rc of receipts) {
    const d = rc.detail ?? {};
    for (const key of ["connector", "connectorId"]) if (typeof d[key] === "string") ids.add(d[key] as string);
    if (Array.isArray(d.connectors)) for (const c of d.connectors) if (typeof c === "string") ids.add(c);
  }
  const out: Record<string, AppInfo> = {};
  for (const id of ids) {
    const def = getConnector(id);
    if (def) out[id] = { name: def.name, icon: def.icon as IconSpec };
  }
  return out;
}

export function toReceiptView(rc: Receipt): ReceiptView {
  return {
    id: rc.id,
    kind: rc.kind,
    status: rc.status,
    title: rc.title,
    detail: rc.detail ?? {},
    costMicros: Number(rc.costMicros) || 0,
    createdAt: rc.createdAt.toISOString(),
  };
}
