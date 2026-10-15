/**
 * Slack: the bot joins the owner's workspace (via our app's OAuth, or a one-click
 * app manifest the owner installs themselves) and chats in DMs.
 */
import crypto from "node:crypto";
import type { Channel } from "@/lib/db/schema";
import { UnreachableError } from "@/lib/utils";
import type { ChannelAdapter, OutboundButton } from "./outbound";
import { channelSecret } from "./secrets";

export async function slackCall<T = Record<string, unknown>>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  }).catch((cause) => {
    throw new UnreachableError("Slack", { cause });
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error ?? res.status}`);
  return data;
}

/** Slack mrkdwn is close to markdown: bold is *x*, links are <url|text>. */
export function toSlackMrkdwn(markdown: string): string {
  return markdown
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "<$2|$1>")
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*");
}

export function slackBlocks(text: string, buttons?: OutboundButton[]) {
  const blocks: Record<string, unknown>[] = [{ type: "section", text: { type: "mrkdwn", text: toSlackMrkdwn(text).slice(0, 2900) } }];
  if (buttons?.length) {
    blocks.push({
      type: "actions",
      elements: buttons.map((b, i) =>
        b.url
          ? { type: "button", text: { type: "plain_text", text: b.label }, url: b.url, action_id: `link_${i}` }
          : { type: "button", text: { type: "plain_text", text: b.label }, value: b.data ?? b.label, action_id: `act_${i}` },
      ),
    });
  }
  return blocks;
}

export const slackAdapter: ChannelAdapter = {
  isLive(channel: Channel | null) {
    return Boolean(channel?.credentialId);
  },
  async send({ db, channel }, msg) {
    const token = await channelSecret(db, channel);
    if (!token) return { status: "failed", error: "Slack token missing" };
    // msg.to is a Slack user id: open (or reuse) the DM, then post.
    const open = await slackCall<{ channel: { id: string } }>(token, "conversations.open", { users: msg.to });
    const sent = await slackCall<{ ts: string }>(token, "chat.postMessage", {
      channel: open.channel.id,
      text: msg.text.slice(0, 3000),
      blocks: slackBlocks(msg.text, msg.buttons),
    });
    return { status: "sent", providerId: sent.ts };
  },
};

/** v0 signature: HMAC-SHA256(signingSecret, `v0:${ts}:${rawBody}`), 5-minute window. */
export function verifySlackSignature(signingSecret: string, rawBody: string, timestamp: string | null, signature: string | null): boolean {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const expected = "v0=" + crypto.createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
