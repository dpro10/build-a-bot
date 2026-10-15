import { after } from "next/server";
import { getDb } from "@/lib/db";
import { config } from "@/lib/env";
import { timingSafeEqualStr } from "@/lib/crypto";
import { onManagedBotCreated, rememberManagerStart } from "@/lib/channels/telegram-setup";
import { telegramCall } from "@/lib/channels/telegram";
import { seenBefore } from "@/lib/channels/inbound";

/** Our manager bot: creates each owner's personal Telegram bot (Managed Bots). */
export async function POST(req: Request) {
  if (!config.telegram.managerToken) return new Response("not configured", { status: 503 });
  // Fail closed: without the secret anyone could post fake "a bot was created" updates.
  const secret = config.telegram.managerWebhookSecret;
  if (!secret || !timingSafeEqualStr(req.headers.get("x-telegram-bot-api-secret-token") ?? "", secret)) {
    return new Response("forbidden", { status: 403 });
  }
  const update = (await req.json().catch(() => null)) as {
    update_id?: number;
    managed_bot?: { user: { id: number }; bot: { id: number; username: string } };
    message?: { chat: { id: number }; from?: { id: number }; text?: string };
  } | null;
  if (!update) return new Response("bad request", { status: 400 });
  const db = await getDb();
  if (await seenBefore(db, "tg-manager", update.update_id)) return new Response("ok");

  after(async () => {
    if (update.managed_bot) {
      const result = await onManagedBotCreated(db, update.managed_bot);
      if (result.matched) {
        await telegramCall(config.telegram.managerToken!, "sendMessage", {
          chat_id: update.managed_bot.user.id,
          text: `Your bot @${result.username} is ready! Open it and tap Start to say hi: https://t.me/${result.username}?start=hello`,
        }).catch(() => {});
      }
      return;
    }
    const text = update.message?.text ?? "";
    const m = /^\/start\s+link_([A-Za-z0-9_-]+)/.exec(text);
    if (m && update.message?.from) {
      // The owner opened the manager from the app first: remember their Telegram id for matching.
      await rememberManagerStart(db, m[1], String(update.message.from.id));
      await telegramCall(config.telegram.managerToken!, "sendMessage", {
        chat_id: update.message.chat.id,
        text: "Got it! Now go back to the app and tap “Create my Telegram bot”.",
      }).catch(() => {});
    } else if (update.message) {
      await telegramCall(config.telegram.managerToken!, "sendMessage", {
        chat_id: update.message.chat.id,
        text: "Hi! I create personal assistant bots. Start from the app to make yours.",
      }).catch(() => {});
    }
  });
  return new Response("ok");
}
