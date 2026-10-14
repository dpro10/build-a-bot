/**
 * Telegram: each bot gets its own Telegram bot (created in one tap through our
 * manager bot, or by pasting a BotFather token). Updates arrive by webhook at
 * /api/webhooks/telegram/[channelId] with a per-channel secret header.
 */
import type { Channel } from "@/lib/db/schema";
import type { ChannelAdapter, OutboundButton } from "./outbound";
import { channelSecret } from "./secrets";
import { appUrl } from "@/lib/env";

const API = "https://api.telegram.org";

export async function telegramCall<T = unknown>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description ?? res.status}`);
  return data.result as T;
}

/** Telegram HTML parse mode: escape everything, then allow a few simple marks. */
export function toTelegramHtml(markdown: string): string {
  const esc = markdown.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/```([\s\S]*?)```/g, (_m, code) => `<pre>${code.trim()}</pre>`)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/^\s*[-*]\s+/gm, "• ");
}

export function inlineKeyboard(buttons?: OutboundButton[]) {
  if (!buttons?.length) return undefined;
  return {
    inline_keyboard: [
      buttons.map((b) => (b.url ? { text: b.label, url: b.url } : { text: b.label, callback_data: (b.data ?? b.label).slice(0, 64) })),
    ],
  };
}

export async function sendTelegram(token: string, chatId: string, text: string, buttons?: OutboundButton[]) {
  const chunks = splitMessage(text, 3900);
  let last: { message_id: number } | undefined;
  for (let i = 0; i < chunks.length; i++) {
    last = await telegramCall<{ message_id: number }>(token, "sendMessage", {
      chat_id: chatId,
      text: toTelegramHtml(chunks[i]),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(i === chunks.length - 1 && buttons?.length ? { reply_markup: inlineKeyboard(buttons) } : {}),
    });
  }
  return last;
}

export function splitMessage(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

export const telegramAdapter: ChannelAdapter = {
  isLive(channel: Channel | null) {
    return Boolean(channel?.credentialId);
  },
  async send({ db, channel }, msg) {
    const token = await channelSecret(db, channel);
    if (!token) return { status: "failed", error: "Telegram bot token missing" };
    const sent = await sendTelegram(token, msg.to, msg.text, msg.buttons);
    return { status: "sent", providerId: sent ? String(sent.message_id) : undefined };
  },
};

/** The public URL of a bot's avatar picture (rendered by scripts/render-avatars.tsx). */
export function avatarImageUrl(bot: { avatar: string; color: string }): string {
  return `${appUrl()}/avatars/${bot.avatar}-${bot.color}.jpg`;
}

/** Give a Telegram bot its avatar as a profile photo (best effort; photos are uploaded fresh each time). */
export async function setTelegramProfilePhoto(token: string, bot: { avatar: string; color: string }): Promise<boolean> {
  try {
    const img = await fetch(avatarImageUrl(bot));
    if (!img.ok) return false;
    const form = new FormData();
    form.append("photo", JSON.stringify({ type: "static", photo: "attach://avatar" }));
    form.append("avatar", new Blob([await img.arrayBuffer()], { type: "image/jpeg" }), "avatar.jpg");
    const res = await fetch(`${API}/bot${token}/setMyProfilePhoto`, { method: "POST", body: form });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return Boolean(data.ok);
  } catch {
    return false;
  }
}
