/**
 * Telegram setup.
 *
 * One tap (Managed Bots, Bot API 9.6): we send the owner to
 *   https://t.me/newbot/{our_manager}/{suggested_username}?name={Bot name}
 * Telegram asks them to confirm, creates THEIR bot, and tells our manager bot. We fetch
 * the new bot's token, lock it to its owner, point its webhook at us, and it's live.
 * Fallback: paste a BotFather token and prove ownership with /start CODE.
 */
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Bot, Channel, User } from "@/lib/db/schema";
import { appUrl, config } from "@/lib/env";
import { numericCode, randomToken } from "@/lib/crypto";
import { shortCode, slugify } from "@/lib/utils";
import { storeCredential } from "./secrets";
import { telegramCall } from "./telegram";

export function suggestUsername(botName: string): string {
  const base = slugify(botName, 14).replace(/-/g, "_") || "helper";
  return `${base}_${shortCode().slice(0, 4)}_bot`.slice(0, 32);
}

export async function startManagedTelegram(db: Db, bot: Bot, channel: Channel) {
  if (!config.telegram.managerUsername || !config.telegram.managerToken) return null;
  const suggested = suggestUsername(bot.name);
  await db.insert(schema.pairingCodes).values({
    code: `tg_${randomToken(9)}`,
    purpose: "telegram_managed",
    ownerId: bot.ownerId,
    botId: bot.id,
    channelId: channel.id,
    data: { suggestedUsername: suggested.toLowerCase() },
    expiresAt: new Date(Date.now() + 24 * 3600_000),
  });
  return {
    link: `https://t.me/newbot/${config.telegram.managerUsername}/${suggested}?name=${encodeURIComponent(bot.name)}`,
    suggested,
  };
}

/** Finish wiring a Telegram bot we now hold a token for. */
export async function activateTelegramBot(
  db: Db,
  input: { bot: Bot; owner: User; channel: Channel; token: string; telegramBot: { id: number; username: string }; ownerTelegramId?: string | null },
) {
  const secret = randomToken(24).replace(/[^A-Za-z0-9_-]/g, "");
  const credentialId = await storeCredential(db, {
    ownerId: input.owner.id,
    kind: "bot_token",
    provider: "telegram",
    secret: input.token,
    label: `@${input.telegramBot.username}`,
  });
  await telegramCall(input.token, "setWebhook", {
    url: `${appUrl()}/api/webhooks/telegram/${input.channel.id}`,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  await telegramCall(input.token, "setMyCommands", {
    commands: [
      { command: "start", description: "Wake me up / say hi" },
      { command: "stop", description: "Pause me instantly" },
      { command: "status", description: "Am I on?" },
      { command: "help", description: "What I can do" },
    ],
  }).catch(() => {});
  await telegramCall(input.token, "setMyShortDescription", {
    short_description: `${input.bot.name} is an AI assistant (not a person).`.slice(0, 120),
  }).catch(() => {});
  await telegramCall(input.token, "setMyDescription", {
    description: `I'm ${input.bot.name}, a personal AI assistant. I only take instructions from my owner. Say STOP anytime to pause me.`.slice(0, 512),
  }).catch(() => {});

  await db
    .update(schema.channels)
    .set({
      credentialId,
      address: `@${input.telegramBot.username}`,
      status: input.ownerTelegramId ? "active" : "pending",
      ownerAddress: input.ownerTelegramId ?? null,
      ownerVerifiedAt: input.ownerTelegramId ? new Date() : null,
      config: { ...input.channel.config, telegramBotId: input.telegramBot.id, username: input.telegramBot.username, webhookSecret: secret },
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.channels.id, input.channel.id));
}

/** Paste-a-token flow: returns the deep link the owner opens to prove it's them. */
export async function connectTelegramToken(db: Db, bot: Bot, owner: User, channel: Channel, token: string) {
  const me = await telegramCall<{ id: number; username: string; is_bot: boolean }>(token.trim(), "getMe", {});
  if (!me.is_bot) throw new Error("That token isn't a bot token.");
  await activateTelegramBot(db, { bot, owner, channel, token: token.trim(), telegramBot: { id: me.id, username: me.username } });
  const code = numericCode(6);
  await db.insert(schema.pairingCodes).values({
    code: `tgo_${channel.id}_${code}`,
    purpose: "telegram_owner",
    ownerId: owner.id,
    botId: bot.id,
    channelId: channel.id,
    expiresAt: new Date(Date.now() + 24 * 3600_000),
  });
  return { username: me.username, startLink: `https://t.me/${me.username}?start=own_${code}` };
}

/** Manager bot received `managed_bot`: a user just created their bot through our link. */
export async function onManagedBotCreated(db: Db, update: { user: { id: number }; bot: { id: number; username: string } }) {
  const managerToken = config.telegram.managerToken!;
  const username = update.bot.username.toLowerCase();
  const pending = await db
    .select()
    .from(schema.pairingCodes)
    .where(
      and(
        eq(schema.pairingCodes.purpose, "telegram_managed"),
        isNull(schema.pairingCodes.usedAt),
        gt(schema.pairingCodes.expiresAt, new Date()),
        sql`${schema.pairingCodes.data}->>'suggestedUsername' = ${username}`,
      ),
    )
    .limit(1);
  let row = pending[0];
  if (!row) {
    // They edited the username: match the most recent pending request from the same Telegram user, if we know them.
    const byUser = await db
      .select()
      .from(schema.pairingCodes)
      .where(
        and(
          eq(schema.pairingCodes.purpose, "telegram_managed"),
          isNull(schema.pairingCodes.usedAt),
          gt(schema.pairingCodes.expiresAt, new Date()),
          sql`${schema.pairingCodes.data}->>'telegramUserId' = ${String(update.user.id)}`,
        ),
      )
      .limit(1);
    row = byUser[0];
  }
  if (!row?.botId || !row.channelId) return { matched: false as const };
  await db.update(schema.pairingCodes).set({ usedAt: new Date() }).where(eq(schema.pairingCodes.code, row.code));

  const [bot] = await db.select().from(schema.bots).where(eq(schema.bots.id, row.botId)).limit(1);
  const [owner] = await db.select().from(schema.users).where(eq(schema.users.id, row.ownerId)).limit(1);
  const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, row.channelId)).limit(1);
  if (!bot || !owner || !channel) return { matched: false as const };

  const token = await telegramCall<string>(managerToken, "getManagedBotToken", { user_id: update.bot.id });
  // Only the creator can talk to it (Telegram enforces this for managed bots).
  await telegramCall(managerToken, "setManagedBotAccessSettings", { user_id: update.bot.id, is_access_restricted: true }).catch(() => {});
  await activateTelegramBot(db, {
    bot,
    owner,
    channel,
    token,
    telegramBot: { id: update.bot.id, username: update.bot.username },
    ownerTelegramId: String(update.user.id),
  });
  return { matched: true as const, botId: bot.id, username: update.bot.username };
}
