import { after } from "next/server";
import { and, eq, gt, isNull, like } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { config } from "@/lib/env";
import { verifyDiscordSignature, discordComponents } from "@/lib/channels/discord";
import { handleInbound, loadBotAndOwner } from "@/lib/channels/inbound";
import { decideApproval, readApprovalButtonToken, resolveShortApprovalKey } from "@/lib/agent/approvals";

export const maxDuration = 300;

type Interaction = {
  id: string;
  type: number;
  token: string;
  data?: { name?: string; options?: { name: string; value: string }[]; custom_id?: string };
  user?: { id: string; username?: string };
  member?: { user: { id: string; username?: string } };
};

const EPHEMERAL = 64;

/** Discord interactions: /ask, /link and approval buttons (HTTP only, serverless-friendly). */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyDiscordSignature(raw, req.headers.get("x-signature-ed25519"), req.headers.get("x-signature-timestamp"))) {
    return new Response("invalid request signature", { status: 401 });
  }
  const i = JSON.parse(raw) as Interaction;
  if (i.type === 1) return Response.json({ type: 1 }); // PING → PONG
  const userId = i.user?.id ?? i.member?.user.id;
  if (!userId) return Response.json({ type: 4, data: { content: "Who are you?", flags: EPHEMERAL } });
  const db = await getDb();

  if (i.type === 2 && i.data?.name === "link") {
    const code = i.data.options?.find((o) => o.name === "code")?.value?.trim() ?? "";
    const [row] = await db
      .select()
      .from(schema.pairingCodes)
      .where(and(like(schema.pairingCodes.code, `dsc_%_${code}`), eq(schema.pairingCodes.purpose, "discord_owner"), isNull(schema.pairingCodes.usedAt), gt(schema.pairingCodes.expiresAt, new Date())))
      .limit(1);
    if (!row?.channelId) return Response.json({ type: 4, data: { content: "That code didn't work. Get a fresh one in the app.", flags: EPHEMERAL } });
    await db.update(schema.pairingCodes).set({ usedAt: new Date() }).where(eq(schema.pairingCodes.code, row.code));
    await db.update(schema.channels).set({ ownerAddress: userId, ownerVerifiedAt: new Date(), status: "active" }).where(eq(schema.channels.id, row.channelId));
    return Response.json({ type: 4, data: { content: "Linked! Talk to your bot with /ask.", flags: EPHEMERAL } });
  }

  // Which bot? The one this Discord user is the verified owner of (most recent).
  const [channel] = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.kind, "discord"), eq(schema.channels.ownerAddress, userId), eq(schema.channels.status, "active")))
    .limit(1);

  if (i.type === 3 && i.data?.custom_id?.startsWith("ak:")) {
    if (!channel) return Response.json({ type: 4, data: { content: "Only the bot's owner can do that.", flags: EPHEMERAL } });
    const signed = await resolveShortApprovalKey(db, i.data.custom_id.slice(3));
    const parsed = signed ? readApprovalButtonToken(signed) : null;
    if (!parsed) return Response.json({ type: 4, data: { content: "That button expired.", flags: EPHEMERAL } });
    const [bot] = await db.select().from(schema.bots).where(eq(schema.bots.id, channel.botId)).limit(1);
    const result = bot ? await decideApproval(db, { approvalId: parsed.approvalId, ownerId: bot.ownerId, decision: parsed.decision, via: "discord" }) : { ok: false as const, error: "Bot not found" };
    return Response.json({ type: 7, data: { content: result.ok ? (parsed.decision === "approve" ? "✅ Approved" : "✖ Declined") : result.error, components: [] } });
  }

  if (i.type === 2 && i.data?.name === "ask") {
    if (!channel) {
      return Response.json({ type: 4, data: { content: "You don't have a bot linked yet. In the app: your bot → Channels → Discord.", flags: EPHEMERAL } });
    }
    const prompt = i.data.options?.find((o) => o.name === "prompt")?.value ?? "";
    after(async () => {
      const loaded = await loadBotAndOwner(db, channel.botId);
      let content = "Something went wrong.";
      let components: unknown;
      if (loaded) {
        const out = await handleInbound({
          db, bot: loaded.bot, owner: loaded.owner, channel, kind: "discord",
          threadId: userId, replyTo: userId, text: prompt, isOwner: true, from: userId, deliverReply: false,
        });
        content = out.replyText || "Done.";
        components = discordComponents(out.buttons);
      }
      await fetch(`https://discord.com/api/v10/webhooks/${config.discord.applicationId}/${i.token}/messages/@original`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: content.slice(0, 1990), components: components ?? [], allowed_mentions: { parse: [] } }),
      }).catch(() => {});
    });
    return Response.json({ type: 5 }); // deferred: "Bot is thinking…"
  }
  return Response.json({ type: 4, data: { content: "Unknown command.", flags: EPHEMERAL } });
}
