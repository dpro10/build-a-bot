/**
 * Inbound email → the bot whose address it was sent to.
 * The owner (verified address) gives instructions; anyone else is a contact.
 * Email bodies are always treated as outside content (prompt-injection guard).
 */
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import { config } from "@/lib/env";
import { handleInbound, loadBotAndOwner } from "./inbound";
import { ensureConversation } from "./outbound";

export function extractAddress(raw: string): string {
  const m = /<([^>]+)>/.exec(raw);
  return (m ? m[1] : raw).trim().toLowerCase();
}

export async function routeInboundEmail(
  db: Db,
  input: { to: string[]; from: string; subject: string; text: string; messageId?: string },
) {
  const domain = config.email.botDomain.toLowerCase();
  const handles = input.to.map(extractAddress).filter((a) => a.endsWith(`@${domain}`)).map((a) => a.split("@")[0]);
  for (const handle of new Set(handles)) {
    const [bot] = await db.select().from(schema.bots).where(eq(schema.bots.handle, handle)).limit(1);
    if (!bot) continue;
    const loaded = await loadBotAndOwner(db, bot.id);
    if (!loaded) continue;
    const [channel] = await db
      .select()
      .from(schema.channels)
      .where(and(eq(schema.channels.botId, bot.id), eq(schema.channels.kind, "email")))
      .limit(1);
    const from = extractAddress(input.from);
    const isOwner = Boolean(channel?.ownerAddress && channel.ownerVerifiedAt && channel.ownerAddress.toLowerCase() === from);
    const text = `Subject: ${input.subject || "(none)"}\n\n${input.text}`.slice(0, 30000);
    if (!channel || channel.status !== "active") {
      // Not set up as a chat channel: just file it in the bot's inbox (read_inbox) without replying.
      const conversation = await ensureConversation(db, bot.id, "email", from);
      await db.insert(schema.messages).values({
        id: `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        conversationId: conversation.id,
        botId: bot.id,
        role: "user",
        author: isOwner ? "owner" : "contact",
        text,
        channelKind: "email",
        meta: { from, subject: input.subject, messageId: input.messageId },
      });
      continue;
    }
    await handleInbound({
      db,
      bot: loaded.bot,
      owner: loaded.owner,
      channel,
      kind: "email",
      threadId: from,
      replyTo: from,
      text,
      isOwner,
      from,
      contactLabel: input.from,
      tainted: true,
      subject: input.subject?.toLowerCase().startsWith("re:") ? input.subject : `Re: ${input.subject || "your note"}`,
      meta: { from, subject: input.subject, messageId: input.messageId },
    });
  }
}
