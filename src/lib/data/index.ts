/**
 * Owner-scoped reads. Every query here filters by the owner (or by a bot the
 * caller already proved they own). Pages and API routes use these instead of
 * touching tables directly, so a missed check can't leak another person's data.
 */
import { and, asc, count, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Bot } from "@/lib/db/schema";
import { getUsage } from "@/lib/billing/usage";

export async function getOwnedBot(db: Db, ownerId: string, botId: string): Promise<Bot | null> {
  const [bot] = await db
    .select()
    .from(schema.bots)
    .where(and(eq(schema.bots.id, botId), eq(schema.bots.ownerId, ownerId)))
    .limit(1);
  return bot ?? null;
}

export async function listBots(db: Db, ownerId: string) {
  const bots = await db.select().from(schema.bots).where(eq(schema.bots.ownerId, ownerId)).orderBy(desc(schema.bots.createdAt));
  if (!bots.length) return [];
  const ids = bots.map((b) => b.id);
  const pending = await db
    .select({ botId: schema.approvals.botId, n: count() })
    .from(schema.approvals)
    .where(and(inArray(schema.approvals.botId, ids), eq(schema.approvals.status, "pending"), gt(schema.approvals.expiresAt, new Date())))
    .groupBy(schema.approvals.botId);
  const pendingBy = new Map(pending.map((p) => [p.botId, Number(p.n)]));
  const lastMessages = await db.execute(sql`
    select distinct on (bot_id) bot_id, text, role, created_at
    from messages where bot_id in ${ids} order by bot_id, created_at desc`);
  const rows = (lastMessages as unknown as { rows?: { bot_id: string; text: string; role: string; created_at: string }[] }).rows ??
    (lastMessages as unknown as { bot_id: string; text: string; role: string; created_at: string }[]);
  const lastBy = new Map((rows ?? []).map((r) => [r.bot_id, r]));
  return bots.map((b) => ({
    bot: b,
    pendingApprovals: pendingBy.get(b.id) ?? 0,
    lastMessage: lastBy.get(b.id) ? { text: lastBy.get(b.id)!.text, role: lastBy.get(b.id)!.role, at: new Date(lastBy.get(b.id)!.created_at) } : null,
  }));
}

export async function getBotSetup(db: Db, botId: string) {
  const [channels, connections] = await Promise.all([
    db.select().from(schema.channels).where(eq(schema.channels.botId, botId)).orderBy(asc(schema.channels.createdAt)),
    db.select().from(schema.connections).where(eq(schema.connections.botId, botId)).orderBy(asc(schema.connections.createdAt)),
  ]);
  return { channels, connections };
}

export async function listConversations(db: Db, botId: string) {
  return db.select().from(schema.conversations).where(eq(schema.conversations.botId, botId)).orderBy(desc(schema.conversations.updatedAt));
}

export async function listMessages(db: Db, conversationId: string, opts: { limit?: number; after?: Date } = {}) {
  const where = opts.after
    ? and(eq(schema.messages.conversationId, conversationId), gt(schema.messages.createdAt, opts.after))
    : eq(schema.messages.conversationId, conversationId);
  const rows = await db
    .select()
    .from(schema.messages)
    .where(where)
    .orderBy(desc(schema.messages.createdAt))
    .limit(opts.limit ?? 60);
  return rows.reverse();
}

export async function listReceipts(db: Db, ownerId: string, opts: { botId?: string; before?: Date; limit?: number; kind?: string } = {}) {
  // Receipts are append-only, so the owner id on old ones can't follow an account merge;
  // ownership is decided by the bot instead.
  const conds = [inArray(schema.receipts.botId, db.select({ id: schema.bots.id }).from(schema.bots).where(eq(schema.bots.ownerId, ownerId)))];
  if (opts.botId) conds.push(eq(schema.receipts.botId, opts.botId));
  if (opts.before) conds.push(lt(schema.receipts.createdAt, opts.before));
  if (opts.kind) conds.push(eq(schema.receipts.kind, opts.kind));
  return db
    .select()
    .from(schema.receipts)
    .where(and(...conds))
    .orderBy(desc(schema.receipts.createdAt))
    .limit(opts.limit ?? 50);
}

export async function listApprovals(db: Db, ownerId: string, opts: { status?: string; botId?: string; limit?: number } = {}) {
  const conds = [eq(schema.approvals.ownerId, ownerId)];
  if (opts.status) conds.push(eq(schema.approvals.status, opts.status));
  if (opts.botId) conds.push(eq(schema.approvals.botId, opts.botId));
  if (opts.status === "pending") conds.push(gt(schema.approvals.expiresAt, new Date()));
  return db
    .select()
    .from(schema.approvals)
    .where(and(...conds))
    .orderBy(desc(schema.approvals.createdAt))
    .limit(opts.limit ?? 50);
}

export async function pendingApprovalCount(db: Db, ownerId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(schema.approvals)
    .where(and(eq(schema.approvals.ownerId, ownerId), eq(schema.approvals.status, "pending"), gt(schema.approvals.expiresAt, new Date())));
  return Number(row?.n ?? 0);
}

export async function listSchedules(db: Db, botId: string) {
  return db.select().from(schema.schedules).where(eq(schema.schedules.botId, botId)).orderBy(desc(schema.schedules.active), asc(schema.schedules.nextRunAt));
}

export async function listMemories(db: Db, botId: string) {
  return db.select().from(schema.memories).where(eq(schema.memories.botId, botId)).orderBy(desc(schema.memories.pinned), desc(schema.memories.createdAt));
}

export async function listNotes(db: Db, botId: string) {
  return db.select().from(schema.notes).where(eq(schema.notes.botId, botId)).orderBy(desc(schema.notes.updatedAt));
}

export async function listDeliveries(db: Db, botId: string, limit = 30) {
  return db.select().from(schema.deliveries).where(eq(schema.deliveries.botId, botId)).orderBy(desc(schema.deliveries.createdAt)).limit(limit);
}

export async function listContacts(db: Db, botId: string) {
  return db.select().from(schema.contacts).where(eq(schema.contacts.botId, botId)).orderBy(desc(schema.contacts.createdAt));
}

export async function listBridgeDevices(db: Db, ownerId: string) {
  return db.select().from(schema.bridgeDevices).where(eq(schema.bridgeDevices.ownerId, ownerId)).orderBy(desc(schema.bridgeDevices.createdAt));
}

export async function usageSummary(db: Db, ownerId: string) {
  return getUsage(db, ownerId);
}

export async function credentialHint(db: Db, ownerId: string, credentialId: string | null | undefined) {
  if (!credentialId) return null;
  const [row] = await db
    .select({ hint: schema.credentials.hint, provider: schema.credentials.provider, label: schema.credentials.label, kind: schema.credentials.kind })
    .from(schema.credentials)
    .where(and(eq(schema.credentials.id, credentialId), eq(schema.credentials.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}
