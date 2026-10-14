/**
 * Integrations that set themselves up from their keys, so going live is only pasting keys:
 * the Telegram manager bot's webhook and Discord's slash commands. The every-minute tick
 * calls this; each step runs at most once per window, and a failure only logs.
 */
import type { Db } from "@/lib/db";
import { appUrl, config } from "@/lib/env";
import { rateLimit } from "@/lib/safety/ratelimit";
import { telegramCall } from "./telegram";
import { registerDiscordCommands } from "./discord-commands";

export async function selfSetup(db: Db) {
  await Promise.all([telegramManagerWebhook(db), discordCommands(db)]);
}

async function telegramManagerWebhook(db: Db) {
  const token = config.telegram.managerToken;
  const secret = process.env.TELEGRAM_MANAGER_WEBHOOK_SECRET;
  if (!token || !secret) return;
  if (!(await rateLimit(db, "setup:telegram-manager-webhook", 1, 30 * 60)).ok) return;
  // Setting it again is harmless, and it picks up a new domain or secret.
  await telegramCall(token, "setWebhook", { url: `${appUrl()}/api/webhooks/telegram/manager`, secret_token: secret }).catch((err) =>
    console.warn("[setup] Telegram manager webhook:", (err as Error).message),
  );
}

async function discordCommands(db: Db) {
  const { applicationId, botToken } = config.discord;
  if (!applicationId || !botToken) return;
  if (!(await rateLimit(db, "setup:discord-commands", 1, 6 * 3600)).ok) return;
  const res = await registerDiscordCommands(applicationId, botToken).catch((err: Error) => ({ ok: false, status: 0, body: err.message }));
  if (!res.ok) console.warn("[setup] Discord commands:", res.status, res.body.slice(0, 300));
}
