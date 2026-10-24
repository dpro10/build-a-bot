import { after } from "next/server";
import { and, eq, gt, isNull, like, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { config } from "@/lib/env";
import { verifyDiscordSignature, discordComponents } from "@/lib/channels/discord";
import { handleInbound, loadBotAndOwner } from "@/lib/channels/inbound";
import { splitMessage } from "@/lib/channels/telegram";
import { decideApproval, readApprovalButtonToken, resolveShortApprovalKey } from "@/lib/agent/approvals";
import { rateLimit } from "@/lib/safety/ratelimit";
import { normalizeLinkCode } from "@/lib/channels/setup";
import { fetchCapped, takeChannelFile } from "@/lib/library/inbound";

export const maxDuration = 300;

type Interaction = {
  id: string;
  type: number;
  token: string;
  data?: {
    name?: string;
    options?: { name: string; value: string }[];
    custom_id?: string;
    /** Files attached to a command's options, by id. */
    resolved?: { attachments?: Record<string, { id: string; filename: string; size: number; url: string; content_type?: string }> };
  };
  user?: { id: string; username?: string };
  member?: { user: { id: string; username?: string } };
  /** Set when the command was typed in a server rather than a DM. */
  guild_id?: string;
};

const EPHEMERAL = 64;

/** Edit or add to the interaction's reply (Discord keeps an interaction's token for 15 minutes). */
function followUp(token: string, method: "PATCH" | "POST", body: Record<string, unknown>) {
  const path = method === "PATCH" ? "/messages/@original" : "";
  return fetch(`https://discord.com/api/v10/webhooks/${config.discord.applicationId}/${token}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...body }),
  }).catch(() => {});
}

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
    const nope = (content = "That code didn't work. Get a fresh one in the app.") => Response.json({ type: 4, data: { content, flags: EPHEMERAL } });
    // Codes look like "K7XQ-29MD". Anything else (e.g. "%" or "_", which LIKE treats as wildcards) never matches.
    const code = normalizeLinkCode(String(i.data.options?.find((o) => o.name === "code")?.value ?? ""));
    // The typed code isn't tied to a channel (it's checked against every pending one), so cap guesses per Discord user.
    if (!(await rateLimit(db, `discord-link:${userId}`, 10, 600)).ok) return nope("Too many tries. Wait a few minutes and get a fresh code in the app.");
    if (!/^[A-Z0-9]{8}$/.test(code)) return nope();
    const [row] = await db
      .select()
      .from(schema.pairingCodes)
      .where(and(like(schema.pairingCodes.code, `dsc\\_%\\_${code}`), eq(schema.pairingCodes.purpose, "discord_owner"), isNull(schema.pairingCodes.usedAt), gt(schema.pairingCodes.expiresAt, new Date())))
      .limit(1);
    if (!row?.channelId || !row.code.endsWith(`_${code}`)) return nope();
    // Claim it once: two people typing the same code can't both link.
    const [claimed] = await db
      .update(schema.pairingCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(schema.pairingCodes.code, row.code), isNull(schema.pairingCodes.usedAt)))
      .returning();
    if (!claimed) return nope();
    await db.update(schema.channels).set({ ownerAddress: userId, ownerVerifiedAt: new Date(), status: "active" }).where(eq(schema.channels.id, row.channelId));
    return Response.json({ type: 4, data: { content: "Linked! Talk to your bot with /ask.", flags: EPHEMERAL } });
  }

  // Which bot? The one this Discord user is the verified owner of (most recently linked).
  const [channel] = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.kind, "discord"), eq(schema.channels.ownerAddress, userId), eq(schema.channels.status, "active")))
    // Postgres puts nulls first when sorting down: an older link without the date would come first.
    .orderBy(sql`${schema.channels.ownerVerifiedAt} desc nulls last`)
    .limit(1);

  if (i.type === 3 && i.data?.custom_id?.startsWith("ak:")) {
    if (!channel) return Response.json({ type: 4, data: { content: "Only the bot's owner can do that.", flags: EPHEMERAL } });
    const signed = await resolveShortApprovalKey(db, i.data.custom_id.slice(3));
    const parsed = signed ? readApprovalButtonToken(signed) : null;
    if (!parsed) return Response.json({ type: 4, data: { content: "That button expired.", flags: EPHEMERAL } });
    const [bot] = await db.select().from(schema.bots).where(eq(schema.bots.id, channel.botId)).limit(1);
    if (!bot) return Response.json({ type: 4, data: { content: "Bot not found.", flags: EPHEMERAL } });
    // Discord wants an answer within 3 seconds, and the approved action can take longer: decide after answering.
    after(async () => {
      const result = await decideApproval(db, { approvalId: parsed.approvalId, ownerId: bot.ownerId, decision: parsed.decision, via: "discord" });
      await followUp(i.token, "PATCH", { content: result.ok ? (parsed.decision === "approve" ? "✅ Approved" : "✖ Declined") : result.error, components: [] });
    });
    return Response.json({ type: 6 }); // deferred update of the message the buttons are on
  }

  if (i.type === 2 && i.data?.name === "ask") {
    if (!channel) {
      return Response.json({ type: 4, data: { content: "You don't have a bot linked yet. In the app: your bot → Channels → Discord.", flags: EPHEMERAL } });
    }
    // In a server, only the owner sees the bot's answer.
    const flags = i.guild_id ? EPHEMERAL : undefined;
    const prompt = i.data.options?.find((o) => o.name === "prompt")?.value ?? "";
    const fileId = i.data.options?.find((o) => o.name === "file")?.value;
    const attachment = fileId ? i.data.resolved?.attachments?.[fileId] : undefined;
    after(async () => {
      const loaded = await loadBotAndOwner(db, channel.botId);
      let content = "Something went wrong.";
      let components: unknown;
      if (loaded) {
        // A file goes into the bot's Library (read first), then the question goes on with it.
        let meta: Record<string, unknown> | undefined;
        let note = "";
        if (attachment) {
          const got = await takeChannelFile(db, {
            bot: loaded.bot,
            owner: loaded.owner,
            source: "discord",
            file: { name: attachment.filename, size: attachment.size, fetch: () => fetchCapped(attachment.url) },
          });
          if ("error" in got) note = `${got.error}\n\n`;
          else meta = { files: [got.attached] };
        }
        const out = await handleInbound({
          db, bot: loaded.bot, owner: loaded.owner, channel, kind: "discord",
          threadId: userId, replyTo: userId, text: prompt, isOwner: true, from: userId, deliverReply: false, meta,
        });
        content = `${note}${out.replyText || "Done."}`;
        components = discordComponents(out.buttons);
      }
      // Discord takes 2,000 characters a message: a long answer goes on in follow-ups, buttons on the last.
      const parts = splitMessage(content, 1990);
      for (let n = 0; n < parts.length; n++) {
        const last = n === parts.length - 1;
        // An edit keeps the reply's privacy; a follow-up states it again.
        await followUp(i.token, n === 0 ? "PATCH" : "POST", { content: parts[n], components: last ? (components ?? []) : [], ...(n > 0 && flags ? { flags } : {}) });
      }
    });
    return Response.json({ type: 5, data: { flags } }); // deferred: "Bot is thinking…"
  }
  return Response.json({ type: 4, data: { content: "Unknown command.", flags: EPHEMERAL } });
}
