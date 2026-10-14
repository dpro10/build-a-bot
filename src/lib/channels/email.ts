/**
 * Email: every bot owns an address like nova-k7x2@<BOT_EMAIL_DOMAIN> (brand-free on
 * purpose). Sending goes through AgentMail or Resend; inbound arrives by webhook
 * at /api/webhooks/email.
 */
import { config, live } from "@/lib/env";
import type { ChannelAdapter } from "./outbound";
import { botEmailAddress } from "@/lib/tools/builtin/inbox";
import { botEmailHtml, loginEmailHtml } from "./email-html";

export async function sendEmailRaw(input: { from: string; fromName: string; to: string; subject: string; text: string; html?: string; replyTo?: string; inReplyTo?: string }) {
  if (config.email.resendKey) {
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
  if (config.email.agentmailKey) {
    const res = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(input.from)}/messages/send`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.email.agentmailKey}`, "content-type": "application/json" },
      body: JSON.stringify({ to: [input.to], subject: input.subject, text: input.text, ...(input.html ? { html: input.html } : {}) }),
    });
    const data = (await res.json().catch(() => ({}))) as { message_id?: string; message?: string };
    if (!res.ok) throw new Error(`AgentMail ${res.status}: ${data.message ?? "error"}`);
    return { id: data.message_id };
  }
  throw new Error("No email provider configured");
}

export const emailAdapter: ChannelAdapter = {
  isLive() {
    return live.email;
  },
  async send({ bot }, msg) {
    const sent = await sendEmailRaw({
      from: botEmailAddress(bot),
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

/**
 * Why a sign-in email didn't go out: no provider on this server (the operator's to fix), or the
 * provider refused or couldn't be reached (worth trying again in a minute).
 */
export type LoginEmailResult = { ok: true } | { ok: false; reason: "not_configured" | "failed" };

/** Login emails (magic links) for the product itself. Failures are logged here, never with the key. */
export async function sendLoginEmail(to: string, link: string): Promise<LoginEmailResult> {
  if (!config.email.resendKey) return { ok: false, reason: "not_configured" };
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
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
  } catch (err) {
    console.error(`[sign-in email] Couldn't reach Resend: ${(err as Error).message}`);
    return { ok: false, reason: "failed" };
  }
  if (!res.ok) {
    // Resend explains itself in the body ("domain not verified", "rate limited"…).
    const body = await res.text().catch(() => "");
    console.error(`[sign-in email] Resend ${res.status}: ${body.slice(0, 500) || "(no body)"}`);
    return { ok: false, reason: "failed" };
  }
  return { ok: true };
}
