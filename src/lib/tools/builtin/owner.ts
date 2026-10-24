import { z } from "zod";
import { messageOwner } from "@/lib/channels/outbound";
import { defineTool } from "../types";

export const messageOwnerTool = defineTool({
  name: "message_owner",
  title: "Message you",
  description:
    "Send the owner (the person you work for) a message on another channel (e.g. 'text me when it's done', 'call me with the summary'). channel 'voice' places a phone call that reads the message aloud. It only ever reaches the owner: never use it to email, text or message anyone else, because it can't reach them.",
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
    // Passing on someone else's message never rings the owner's phone: it goes where they read messages.
    const asked = args.channel ?? "auto";
    const { channel, result } = await messageOwner(ctx.db, ctx.bot, ctx.owner, args.text, {
      channel: ctx.fromContact && asked === "voice" ? "auto" : asked,
      alsoWeb: false,
    });
    if (result.status === "failed") return { ok: false, error: `Couldn't reach the owner on ${channel}: ${result.error}` };
    return {
      ok: true,
      content:
        channel === "web"
          ? "The owner has no other verified channel yet, so it's in their app inbox. Only the owner got it: it did not reach anyone else."
          : `${result.status === "simulated" ? "(Demo: simulated) " : ""}Sent to the owner via ${channel}. Only the owner got it: it did not reach anyone else.`,
      summary: channel,
    };
  },
});
