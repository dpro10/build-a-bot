import { z } from "zod";
import { messageOwner } from "@/lib/channels/outbound";
import { defineTool } from "../types";

export const messageOwnerTool = defineTool({
  name: "message_owner",
  title: "Message you",
  description:
    "Send the owner a message on another channel (e.g. 'text me when it's done', 'call me with the summary'). channel 'voice' places a phone call that reads the message aloud. Only reaches the owner.",
  input: z.object({
    text: z.string().min(1).max(1500),
    channel: z.enum(["auto", "sms", "voice", "email", "telegram", "discord", "slack"]).optional(),
  }),
  connectorId: "memory",
  effect: "send",
  risk: "low",
  taints: false,
  ownerOnly: true,
  outboundText: (a) => a.text,
  summarize: (a) => `Message you${a.channel && a.channel !== "auto" ? ` by ${a.channel}` : ""}`,
  async run(args, ctx) {
    const { channel, result } = await messageOwner(ctx.db, ctx.bot, ctx.owner, args.text, {
      channel: args.channel ?? "auto",
      alsoWeb: false,
    });
    if (result.status === "failed") return { ok: false, error: `Couldn't reach the owner on ${channel}: ${result.error}` };
    return {
      ok: true,
      content:
        channel === "web"
          ? "The owner has no other verified channel yet, so it's in their app inbox."
          : `${result.status === "simulated" ? "(Demo: simulated) " : ""}Sent to the owner via ${channel}.`,
      summary: channel,
    };
  },
});
