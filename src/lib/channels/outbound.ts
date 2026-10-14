/**
 * Outbound delivery: the single path for anything a bot sends on a real channel.
 *
 * - Picks the adapter for the channel kind (Telegram, SMS, email, Slack, Discord, voice).
 * - When the integration isn't configured and we're in demo mode, records the message
 *   as "simulated" so the owner can see exactly what would have gone out.
 * - Records a delivery row and a receipt for every attempt.
 * - Labels messages to people other than the owner as AI-sent (hard rule).
 */
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Bot, Channel, User } from "@/lib/db/schema";
import { demoMode } from "@/lib/env";
import { newId, sortableId, truncate } from "@/lib/utils";
import type { ChannelKind } from "./catalog";

export type OutboundButton = { label: string; url?: string; data?: string };

export type OutboundMessage = {
  to: string;
  text: string;
  subject?: string;
  buttons?: OutboundButton[];
  /** True when the recipient is the bot's owner. */
  toOwner: boolean;
  /** Thread/reply context for adapters that support it. */
  replyTo?: string;
};

export type DeliveryResult = { status: "sent" | "simulated" | "failed"; providerId?: string; error?: string };

export type ChannelAdapter = {
  /** Is this adapter configured for this bot's channel row? */
  isLive(channel: Channel | null): boolean;
  send(ctx: { db: Db; bot: Bot; channel: Channel | null }, msg: OutboundMessage): Promise<DeliveryResult>;
};

const adapters: Partial<Record<ChannelKind, () => Promise<ChannelAdapter>>> = {
  telegram: async () => (await import("./telegram")).telegramAdapter,
  sms: async () => (await import("./twilio")).smsAdapter,
  voice: async () => (await import("./twilio")).voiceAdapter,
  email: async () => (await import("./email")).emailAdapter,
  slack: async () => (await import("./slack")).slackAdapter,
  discord: async () => (await import("./discord")).discordAdapter,
};

export function aiLabel(bot: Bot, owner: Pick<User, "name" | "email">): string {
  const ownerName = owner.name || owner.email?.split("@")[0] || "its owner";
  return `— Sent by ${bot.name}, ${ownerName}'s AI assistant`;
}

export async function deliver(
  db: Db,
  bot: Bot,
  kind: ChannelKind,
  msg: OutboundMessage,
  opts: { owner?: User; channel?: Channel | null } = {},
): Promise<DeliveryResult> {
  const channel =
    opts.channel !== undefined
      ? opts.channel
      : ((await db
          .select()
          .from(schema.channels)
          .where(and(eq(schema.channels.botId, bot.id), eq(schema.channels.kind, kind)))
          .limit(1))[0] ?? null);

  let text = msg.text;
  if (!msg.toOwner && opts.owner) text = `${text}\n\n${aiLabel(bot, opts.owner)}`;
  const finalMsg = { ...msg, text };

  let result: DeliveryResult;
  const load = adapters[kind];
  if (kind === "web") {
    result = { status: "sent" };
  } else if (!load) {
    result = { status: "failed", error: `No adapter for ${kind}` };
  } else {
    const adapter = await load();
    if (adapter.isLive(channel)) {
      try {
        result = await adapter.send({ db, bot, channel }, finalMsg);
      } catch (err) {
        result = { status: "failed", error: (err as Error).message?.slice(0, 300) ?? "send failed" };
      }
    } else if (demoMode) {
      result = { status: "simulated" };
    } else {
      result = { status: "failed", error: `${kind} isn't set up` };
    }
  }

  await db.insert(schema.deliveries).values({
    id: newId("dlv"),
    botId: bot.id,
    channelKind: kind,
    to: msg.to,
    subject: msg.subject ?? null,
    body: text,
    status: result.status,
    providerId: result.providerId ?? null,
    error: result.error ?? null,
  });
  await db.insert(schema.receipts).values({
    id: sortableId("rcp"),
    botId: bot.id,
    ownerId: bot.ownerId,
    kind: "message",
    status: result.status === "failed" ? "error" : "ok",
    title: `${result.status === "simulated" ? "Simulated " : ""}${labelFor(kind)} to ${msg.toOwner ? "you" : msg.to}`,
    detail: {
      channel: kind,
      to: msg.to,
      preview: truncate(text, 280),
      status: result.status,
      ...(result.error ? { error: result.error } : {}),
    },
  });
  return result;
}

function labelFor(kind: ChannelKind): string {
  return (
    {
      sms: "Text",
      voice: "Call",
      email: "Email",
      telegram: "Telegram message",
      slack: "Slack message",
      discord: "Discord message",
      web: "Message",
    } as Partial<Record<ChannelKind, string>>
  )[kind] ?? "Message";
}

/** Where "your usual place" means, best first. Web is always reached through the inbox; calls are never automatic. */
export const OWNER_PRIORITY: ChannelKind[] = ["telegram", "sms", "slack", "discord", "email"];

const rank = (kind: string) => {
  const i = OWNER_PRIORITY.indexOf(kind as ChannelKind);
  return i === -1 ? OWNER_PRIORITY.length : i;
};

/** Channels where the owner is verified and the bot can reach them, best first (web and calls last). */
export async function ownerChannels(db: Db, botId: string): Promise<Channel[]> {
  const rows = await db.select().from(schema.channels).where(eq(schema.channels.botId, botId));
  return rows.filter((c) => c.status === "active" && c.ownerAddress && c.ownerVerifiedAt).sort((a, b) => rank(a.kind) - rank(b.kind));
}

/**
 * Send something to the bot's owner: on the requested channel if it's verified,
 * otherwise their best channel, and always into the web inbox so nothing is lost
 * (unless it's already there: `inWebAlready`).
 */
export async function messageOwner(
  db: Db,
  bot: Bot,
  owner: User,
  text: string,
  opts: {
    channel?: ChannelKind | "auto";
    subject?: string;
    buttons?: OutboundButton[];
    /** false: no copy in the web inbox, unless no other channel reaches the owner. */
    alsoWeb?: boolean;
    /** The text is already in the owner's web chat (a routine's own reply): never post it there again. */
    inWebAlready?: boolean;
  } = {},
): Promise<{ channel: ChannelKind; result: DeliveryResult }> {
  const verified = await ownerChannels(db, bot.id);
  let target: Channel | undefined;
  if (opts.channel && opts.channel !== "auto" && opts.channel !== "web") {
    target = verified.find((c) => c.kind === opts.channel);
  }
  // "auto": the owner's best messaging channel; the web inbox always gets a copy below.
  if (!target && (!opts.channel || opts.channel === "auto")) target = verified.find((c) => OWNER_PRIORITY.includes(c.kind as ChannelKind));

  if (!opts.inWebAlready && (opts.alsoWeb !== false || !target)) await postToWebInbox(db, bot, text);

  if (!target) return { channel: "web", result: { status: "sent" } };
  const result = await deliver(
    db,
    bot,
    target.kind as ChannelKind,
    { to: target.ownerAddress!, text, subject: opts.subject, buttons: opts.buttons, toOwner: true },
    { owner, channel: target },
  );
  return { channel: target.kind as ChannelKind, result };
}

/** Drop a bot message into the owner's web conversation (the app inbox). */
export async function postToWebInbox(db: Db, bot: Bot, text: string, meta: Record<string, unknown> = {}) {
  const conv = await ensureConversation(db, bot.id, "web", "owner");
  await db.insert(schema.messages).values({
    id: sortableId("msg"),
    conversationId: conv.id,
    botId: bot.id,
    role: "assistant",
    author: "bot",
    text,
    channelKind: "web",
    meta: { proactive: true, ...meta },
  });
  await db.update(schema.conversations).set({ updatedAt: new Date() }).where(eq(schema.conversations.id, conv.id));
}

export async function ensureConversation(db: Db, botId: string, channelKind: string, externalId: string) {
  const [existing] = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.botId, botId),
        eq(schema.conversations.channelKind, channelKind),
        eq(schema.conversations.externalId, externalId),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(schema.conversations)
    .values({ id: newId("cnv"), botId, channelKind, externalId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.botId, botId),
        eq(schema.conversations.channelKind, channelKind),
        eq(schema.conversations.externalId, externalId),
      ),
    )
    .limit(1);
  return again;
}
