/**
 * Email: every bot owns an address like nova-k7x2@<BOT_EMAIL_DOMAIN> (brand-free on
 * purpose). Sending goes through AgentMail or Resend, whichever takes in the bots' mail;
 * inbound arrives by webhook at /api/webhooks/email.
 */
import { botEmailProvider, config, live } from "@/lib/env";
import type { ChannelAdapter } from "./outbound";
import { botEmailAddress } from "@/lib/tools/builtin/inbox";
import { botEmailHtml, loginEmailHtml } from "./email-html";

/** Mail from a bot's own address, through the provider that runs bots' inboxes (never just the sign-in key). */
export async function sendEmailRaw(input: { from: string; fromName: string; to: string; subject: string; text: string; html?: string; replyTo?: string; inReplyTo?: string }) {
  const provider = botEmailProvider(config.email);
  if (provider === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${config.email.resendKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: `${input.fromName} <${input.from}>`,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.inReplyTo ? { headers: { "In-Reply-To": input.inReplyTo, References: input.inReplyTo } } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) throw new Error(`Resend ${res.status}: ${data.message ?? "error"}`);
    return { id: data.id };
  }
  if (provider === "agentmail") {
    const res = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(input.from)}/messages/send`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.email.agentmailKey}`, "content-type": "application/json" },
      body: JSON.stringify({ to: [input.to], subject: input.subject, text: input.text, ...(input.html ? { html: input.html } : {}) }),
    });
    const data = (await res.json().catch(() => ({}))) as { message_id?: string; message?: string };
    if (!res.ok) throw new Error(`AgentMail ${res.status}: ${data.message ?? "error"}`);
    return { id: data.message_id };
  }
  throw new Error("Bots' email isn't set up");
}

export const emailAdapter: ChannelAdapter = {
  isLive() {
    return live.botEmail;
  },
  async send({ bot }, msg) {
    const from = botEmailAddress(bot);
    if (!from) return { status: "failed", error: "Bots' email isn't set up" };
    const sent = await sendEmailRaw({
      from,
      fromName: `${bot.name} (AI assistant)`,
      to: msg.to,
      subject: msg.subject ?? `A note from ${bot.name}`,
      text: msg.text,
      html: botEmailHtml({ botName: bot.name, avatar: bot.avatar, color: bot.color, text: msg.text, toOwner: msg.toOwner }),
      inReplyTo: msg.replyTo,
    });
    return { status: "sent", providerId: sent.id };
  },
};

/** Login emails (magic links) for the product itself. */
export async function sendLoginEmail(to: string, link: string) {
  if (!config.email.resendKey) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${config.email.resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: config.email.from,
      to: [to],
      subject: "Your Build-a-bot sign-in link",
      text: `Tap to sign in to Build-a-bot:\n\n${link}\n\nThis link works once and expires in 20 minutes. If you didn't ask for it, ignore this email.`,
      html: loginEmailHtml(link),
    }),
  });
  return res.ok;
}
