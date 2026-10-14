/**
 * The shared path for messages arriving on any channel.
 *
 *   webhook → (dedupe) → who is it? owner / contact → runTurn → reply on the same channel
 *
 * Only the verified owner can give commands. Messages from anyone else are handled
 * as contacts: polite, no actions, relayed to the owner when it matters. Opt-outs
 * from contacts (STOP) are honored for good.
 */
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Approval, Bot, Channel, User } from "@/lib/db/schema";
import { runTurn, type RunResult } from "@/lib/agent/run";
import { approvalButtons, shortApprovalKey } from "@/lib/agent/approvals";
import { isOptOut } from "@/lib/safety";
import { newId } from "@/lib/utils";
import { deliver, ensureConversation, type OutboundButton } from "./outbound";
import type { ChannelKind } from "./catalog";

/** True if we've already processed this webhook event (retries, duplicates). */
export async function seenBefore(db: Db, source: string, externalId: string | number | null | undefined): Promise<boolean> {
  if (externalId === null || externalId === undefined || externalId === "") return false;
  const inserted = await db
    .insert(schema.inboundEvents)
    .values({ id: `${source}:${externalId}` })
    .onConflictDoNothing()
    .returning({ id: schema.inboundEvents.id });
  return inserted.length === 0;
}

export async function loadBotAndOwner(db: Db, botId: string): Promise<{ bot: Bot; owner: User } | null> {
  const [bot] = await db.select().from(schema.bots).where(eq(schema.bots.id, botId)).limit(1);
  if (!bot) return null;
  const [owner] = await db.select().from(schema.users).where(eq(schema.users.id, bot.ownerId)).limit(1);
  return owner ? { bot, owner } : null;
}

export type InboundInput = {
  db: Db;
  bot: Bot;
  owner: User;
  channel: Channel;
  kind: ChannelKind;
  /** Conversation key on this channel (chat id, phone number, email address...). */
  threadId: string;
  /** Where to send the reply (often the same as threadId). */
  replyTo: string;
  text: string;
  isOwner: boolean;
  from: string;
  contactLabel?: string;
  meta?: Record<string, unknown>;
  /** Content came from outside (e.g. a forwarded email) even if the owner sent it. */
  tainted?: boolean;
  /** Return the reply instead of sending it (voice, Discord interactions). */
  deliverReply?: boolean;
  subject?: string;
};

export async function handleInbound(input: InboundInput): Promise<RunResult & { replyText: string; buttons: OutboundButton[] }> {
  const { db, bot, owner, channel } = input;

  // Contacts who opt out never hear from this bot again on this channel.
  if (!input.isOwner && isOptOut(input.text)) {
    await db
      .insert(schema.contacts)
      .values({ id: newId("ctc"), botId: bot.id, kind: input.kind, address: input.from.toLowerCase(), name: "opted-out" })
      .onConflictDoUpdate({ target: [schema.contacts.botId, schema.contacts.kind, schema.contacts.address], set: { name: "opted-out", approvedAt: null } });
    return { status: "ok", text: "", messageId: null, approvals: [], replyText: "", buttons: [] };
  }
  if (!input.isOwner) {
    const [optedOut] = await db
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.botId, bot.id), eq(schema.contacts.kind, input.kind), eq(schema.contacts.address, input.from.toLowerCase()), eq(schema.contacts.name, "opted-out")))
      .limit(1);
    if (optedOut) return { status: "ok", text: "", messageId: null, approvals: [], replyText: "", buttons: [] };
  }

  const conversation = await ensureConversation(db, bot.id, input.kind, input.threadId);
  const result = await runTurn({
    db,
    bot,
    owner,
    conversation,
    channelKind: input.kind,
    message: {
      text: input.text,
      author: input.isOwner ? "owner" : "contact",
      from: input.from,
      contactLabel: input.contactLabel,
      meta: input.meta,
    },
    startTainted: input.tainted,
  });

  const buttons = await channelButtons(db, owner.id, input.kind, result.approvals);
  if (input.deliverReply !== false && result.text && result.status !== "queued") {
    await deliver(
      db,
      bot,
      input.kind,
      { to: input.replyTo, text: result.text, subject: input.subject, buttons, toOwner: input.isOwner },
      { owner, channel },
    );
  }
  return { ...result, replyText: result.text, buttons };
}

/** Approval buttons sized for the channel (Telegram's callback_data is 64 bytes). */
export async function channelButtons(db: Db, ownerId: string, kind: ChannelKind, approvals: Approval[]): Promise<OutboundButton[]> {
  if (!approvals.length) return [];
  const buttons = approvalButtons(approvals);
  if (kind === "telegram" || kind === "discord") {
    for (const b of buttons) {
      if (b.data?.startsWith("ap:")) b.data = `ak:${await shortApprovalKey(db, ownerId, b.data.slice(3))}`;
    }
  }
  if (kind === "sms" || kind === "voice" || kind === "email") {
    // No buttons on plain channels: point to the app.
    return buttons.filter((b) => b.url);
  }
  return buttons;
}

export async function findChannel(db: Db, botId: string, kind: ChannelKind): Promise<Channel | null> {
  const [row] = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.botId, botId), eq(schema.channels.kind, kind)))
    .limit(1);
  return row ?? null;
}
