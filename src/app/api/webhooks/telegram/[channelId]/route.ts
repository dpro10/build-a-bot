import { after } from "next/server";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { timingSafeEqualStr } from "@/lib/crypto";
import { channelSecret } from "@/lib/channels/secrets";
import { telegramCall, sendTelegram } from "@/lib/channels/telegram";
import { handleInbound, loadBotAndOwner, seenBefore } from "@/lib/channels/inbound";
import { decideApproval, readApprovalButtonToken, resolveShortApprovalKey } from "@/lib/agent/approvals";
import { runTurn, setPaused } from "@/lib/agent/run";
import { demoMode } from "@/lib/env";
import { greetingDirective } from "@/lib/agent/prompt";
import { ensureConversation } from "@/lib/channels/outbound";
import { appKinds } from "@/lib/connectors";
import { startersFor } from "@/lib/jobs";
import { fetchCapped, takeChannelFile } from "@/lib/library/inbound";
import type { RouteCtx } from "@/lib/api";

export const maxDuration = 300;

type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; first_name?: string; username?: string };
    text?: string;
    caption?: string;
    /** Set when the owner forwarded someone else's message: its words aren't the owner's. */
    forward_origin?: unknown;
    forward_date?: number;
    /** A file sent as a file (PDF, Word, a photo sent uncompressed). */
    document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
    /** A photo, in several sizes (the last is the largest). */
    photo?: { file_id: string; file_size?: number; width: number; height: number }[];
  };
  callback_query?: { id: string; from: { id: number }; data?: string; message?: { message_id: number; chat: { id: number } } };
};

export async function POST(req: Request, ctx: RouteCtx<{ channelId: string }>) {
  const { channelId } = await ctx.params;
  const db = await getDb();
  const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).limit(1);
  const expected = (channel?.config as { webhookSecret?: string } | undefined)?.webhookSecret;
  if (!channel || channel.kind !== "telegram" || !expected) return new Response("not found", { status: 404 });
  if (!timingSafeEqualStr(req.headers.get("x-telegram-bot-api-secret-token") ?? "", expected)) return new Response("forbidden", { status: 403 });

  // Turned off in the app: Telegram may still deliver, but the bot doesn't answer anyone.
  if (channel.status === "disabled") return new Response("ok");
  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  if (!update) return new Response("bad request", { status: 400 });
  if (await seenBefore(db, `tg-${channelId}`, update.update_id)) return new Response("ok");

  after(async () => {
    const loaded = await loadBotAndOwner(db, channel.botId);
    const token = await channelSecret(db, channel);
    if (!loaded || !token) return;
    const { bot, owner } = loaded;

    // Approval buttons.
    if (update.callback_query) {
      const cq = update.callback_query;
      const isOwner = channel.ownerAddress === String(cq.from.id);
      let text = "Not allowed.";
      if (isOwner && cq.data?.startsWith("ak:")) {
        const signed = await resolveShortApprovalKey(db, cq.data.slice(3));
        const parsed = signed ? readApprovalButtonToken(signed) : null;
        if (parsed) {
          const result = await decideApproval(db, { approvalId: parsed.approvalId, ownerId: owner.id, decision: parsed.decision, via: "telegram" });
          text = result.ok ? (parsed.decision === "approve" ? "Approved ✅" : "Declined") : result.error;
        } else text = "That button expired.";
      }
      await telegramCall(token, "answerCallbackQuery", { callback_query_id: cq.id, text: text.slice(0, 190) }).catch(() => {});
      if (cq.message) {
        await telegramCall(token, "editMessageReplyMarkup", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
      }
      return;
    }

    const msg = update.message;
    if (!msg?.from || msg.chat.type !== "private") return;
    const text = (msg.text ?? msg.caption ?? "").trim();
    // Telegram lets bots download files up to 20 MB.
    const sent = msg.document
      ? { id: msg.document.file_id, name: msg.document.file_name || "File", size: msg.document.file_size }
      : msg.photo?.length
        ? { id: msg.photo[msg.photo.length - 1].file_id, name: `Photo ${new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".")}.jpg`, size: msg.photo[msg.photo.length - 1].file_size }
        : null;
    if (!text && !sent) {
      await sendTelegram(token, String(msg.chat.id), "I can read text, files and photos. Stickers and voice notes are beyond me for now.").catch(() => {});
      return;
    }
    const fromId = String(msg.from.id);

    // Owner verification for pasted-token bots: /start own_<code> (the code is long: it comes in a link, never typed).
    const own = /^\/start\s+own_([A-Za-z0-9_-]{6,40})$/.exec(text);
    if (own && !channel.ownerAddress) {
      const [code] = await db
        .select()
        .from(schema.pairingCodes)
        .where(and(eq(schema.pairingCodes.code, `tgo_${channel.id}_${own[1]}`), isNull(schema.pairingCodes.usedAt), gt(schema.pairingCodes.expiresAt, new Date())))
        .limit(1);
      if (code) {
        await db.update(schema.pairingCodes).set({ usedAt: new Date() }).where(eq(schema.pairingCodes.code, code.code));
        await db.update(schema.channels).set({ ownerAddress: fromId, ownerVerifiedAt: new Date(), status: "active" }).where(eq(schema.channels.id, channel.id));
        channel.ownerAddress = fromId;
      }
    }

    const isOwner = channel.ownerAddress === fromId;
    if (isOwner && /^\/start(\s|$)/.test(text) && bot.status === "paused") {
      // The menu's /start also wakes a paused bot.
      await setPaused(db, bot, false, "/start from telegram");
      await sendTelegram(token, String(msg.chat.id), "I'm back! What do you need?").catch(() => {});
      return;
    }
    if (isOwner && /^\/start(\s|$)/.test(text)) {
      // First hello on Telegram: the bot introduces itself.
      await telegramCall(token, "sendChatAction", { chat_id: msg.chat.id, action: "typing" }).catch(() => {});
      const conversation = await ensureConversation(db, bot.id, "telegram", String(msg.chat.id));
      // Ideas only for what works now: built-ins and apps already signed in to.
      const apps = await db
        .select({ connectorId: schema.connections.connectorId })
        .from(schema.connections)
        .where(and(eq(schema.connections.botId, bot.id), inArray(schema.connections.status, demoMode ? ["connected", "demo"] : ["connected"])));
      const starters = startersFor(bot.jobs ?? [], appKinds(apps.map((c) => c.connectorId)), bot.role);
      const result = await runTurn({
        db, bot, owner, conversation, channelKind: "telegram", message: null, noTools: true,
        directive: greetingDirective(bot, owner, "telegram", starters, []),
      });
      if (result.text) await sendTelegram(token, String(msg.chat.id), result.text);
      return;
    }

    await telegramCall(token, "sendChatAction", { chat_id: msg.chat.id, action: "typing" }).catch(() => {});
    const typing = setInterval(() => telegramCall(token, "sendChatAction", { chat_id: msg.chat.id, action: "typing" }).catch(() => {}), 4500);
    try {
      // A file from the owner goes into the bot's Library (read first), then the message goes on with it.
      let meta: Record<string, unknown> = { telegramMessageId: msg.message_id };
      if (sent) {
        if (!isOwner) {
          if (!text) {
            await sendTelegram(token, String(msg.chat.id), "I only take files from the person I work for.").catch(() => {});
            return;
          }
        } else if (sent.size && sent.size > 20 * 1024 * 1024) {
          await sendTelegram(token, String(msg.chat.id), `${sent.name} is too big for Telegram to hand me (bots get files up to 20 MB). Add it on the website instead: your bot → Memory → Files.`).catch(() => {});
          if (!text) return;
        } else {
          const got = await takeChannelFile(db, {
            bot,
            owner,
            source: "telegram",
            file: {
              name: sent.name,
              size: sent.size,
              fetch: async () => {
                const f = await telegramCall<{ file_path?: string }>(token, "getFile", { file_id: sent.id }).catch(() => null);
                return f?.file_path ? fetchCapped(`https://api.telegram.org/file/bot${token}/${f.file_path}`) : null;
              },
            },
          });
          if ("error" in got) {
            await sendTelegram(token, String(msg.chat.id), got.error).catch(() => {});
            if (!text) return;
          } else meta = { ...meta, files: [got.attached] };
        }
      }
      // A forwarded message is someone else's words: shown to the bot as outside content.
      const forwarded = Boolean(msg.forward_origin || msg.forward_date);
      await handleInbound({
        db,
        bot,
        owner,
        channel,
        kind: "telegram",
        threadId: String(msg.chat.id),
        replyTo: String(msg.chat.id),
        text: forwarded ? text : text.replace(/^\/(stop|status|help)(@\w+)?$/i, "$1"),
        isOwner,
        from: fromId,
        contactLabel: msg.from.username ? `@${msg.from.username}` : msg.from.first_name,
        meta: forwarded ? { ...meta, forwarded: true } : meta,
        tainted: forwarded,
      });
    } finally {
      clearInterval(typing);
    }
  });
  return new Response("ok");
}
