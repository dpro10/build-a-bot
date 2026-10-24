/**
 * Discord: one shared Build-a-bot application. People add it to their account
 * (user install) or a server and talk to their bot with /ask; it can DM them for
 * reminders. Interactions arrive over HTTP at /api/webhooks/discord, verified
 * with Ed25519.
 */
import crypto from "node:crypto";
import type { Channel } from "@/lib/db/schema";
import { config, live } from "@/lib/env";
import type { ChannelAdapter, OutboundButton } from "./outbound";
import { splitMessage } from "./telegram";

const API = "https://discord.com/api/v10";

export async function discordCall<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bot ${config.discord.botToken}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Discord ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export function discordComponents(buttons?: OutboundButton[]) {
  if (!buttons?.length) return undefined;
  return [
    {
      type: 1,
      components: buttons.slice(0, 5).map((b) =>
        b.url
          ? { type: 2, style: 5, label: b.label.slice(0, 80), url: b.url }
          : { type: 2, style: 1, label: b.label.slice(0, 80), custom_id: (b.data ?? b.label).slice(0, 100) },
      ),
    },
  ];
}

export const discordAdapter: ChannelAdapter = {
  isLive(_channel: Channel | null) {
    return live.discord;
  },
  async send(_ctx, msg) {
    const dm = await discordCall<{ id: string }>("POST", "/users/@me/channels", { recipient_id: msg.to });
    // Discord takes 2,000 characters a message: a long reply goes in parts, buttons on the last.
    const parts = splitMessage(msg.text, 1990);
    let sent: { id: string } | undefined;
    for (let i = 0; i < parts.length; i++) {
      sent = await discordCall<{ id: string }>("POST", `/channels/${dm.id}/messages`, {
        content: parts[i],
        components: i === parts.length - 1 ? discordComponents(msg.buttons) : undefined,
        allowed_mentions: { parse: [] },
      });
    }
    return { status: "sent", providerId: sent!.id };
  },
};

/** Verify an interaction: Ed25519 over timestamp + raw body with the app's public key. */
export function verifyDiscordSignature(rawBody: string, signature: string | null, timestamp: string | null): boolean {
  if (!signature || !timestamp || !config.discord.publicKey) return false;
  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(config.discord.publicKey, "hex")]),
      format: "der",
      type: "spki",
    });
    return crypto.verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}
