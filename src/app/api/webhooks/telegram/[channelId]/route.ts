import { after } from "next/server";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { timingSafeEqualStr } from "@/lib/crypto";
import { channelSecret } from "@/lib/channels/secrets";
import { telegramCall, sendTelegram } from "@/lib/channels/telegram";
import { handleInbound, loadBotAndOwner, seenBefore } from "@/lib/channels/inbound";
import { decideApproval, readApprovalButtonToken, resolveShortApprovalKey } from "@/lib/agent/approvals";
import { runTurn } from "@/lib/agent/run";
import { greetingDirective } from "@/lib/agent/prompt";
import { ensureConversation } from "@/lib/channels/outbound";
import { appKinds } from "@/lib/connectors";
import { startersFor } from "@/lib/jobs";
import type { RouteCtx } from "@/lib/api";

export const maxDuration = 300;

type TgUpdate = {
  update_id: number;
  message?: { message_id: number; chat: { id: number; type: string }; from?: { id: number; first_name?: string; username?: string }; text?: string; caption?: string };
  callback_query?: { id: string; from: { id: number }; data?: string; message?: { message_id: number; chat: { id: number } } };
};

export async function POST(req: Request, ctx: RouteCtx<{ channelId: string }>) {
  const { channelId } = await ctx.params;
  const db = await getDb();
  const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).limit(1);
  const expected = (channel?.config as { webhookSecret?: string } | undefined)?.webhookSecret;
  if (!channel || channel.kind !== "telegram" || !expected) return new Response("not found", { status: 404 });
  if (!timingSafeEqualStr(req.headers.get("x-telegram-bot-api-secret-token") ?? "", expected)) return new Response("forbidden", { status: 403 });

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
    if (!text) {
      await sendTelegram(token, String(msg.chat.id), "I can only read text for now.").catch(() => {});
      return;
    }
    const fromId = String(msg.from.id);

    // Owner verification for pasted-token bots: /start own_123456
    const own = /^\/start\s+own_(\d{6})$/.exec(text);
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
    if (isOwner && /^\/start(\s|$)/.test(text)) {
      // First hello on Telegram: the bot introduces itself.
      await telegramCall(token, "sendChatAction", { chat_id: msg.chat.id, action: "typing" }).catch(() => {});
      const conversation = await ensureConversation(db, bot.id, "telegram", String(msg.chat.id));
      const apps = await db
        .select({ connectorId: schema.connections.connectorId })
        .from(schema.connections)
        .where(and(eq(schema.connections.botId, bot.id), ne(schema.connections.status, "disabled")));
      const starters = startersFor(bot.jobs ?? [], appKinds(apps.map((c) => c.connectorId)));
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
      await handleInbound({
        db,
        bot,
        owner,
        channel,
        kind: "telegram",
        threadId: String(msg.chat.id),
        replyTo: String(msg.chat.id),
        text: text.replace(/^\/(stop|status|help)(@\w+)?$/i, "$1"),
        isOwner,
        from: fromId,
        contactLabel: msg.from.username ? `@${msg.from.username}` : msg.from.first_name,
        meta: { telegramMessageId: msg.message_id },
      });
    } finally {
      clearInterval(typing);
    }
  });
  return new Response("ok");
}
