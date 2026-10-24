/**
 * Approve / Deny buttons pressed in Slack, on the shared app or a bot's own app.
 * Only the bot's owner on Slack can decide.
 */
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Channel } from "@/lib/db/schema";
import { decideApproval, readApprovalButtonToken } from "@/lib/agent/approvals";

export type SlackInteraction = {
  type?: string;
  team?: { id?: string };
  user?: { id?: string };
  actions?: { value?: string }[];
  response_url?: string;
};

/** Slack posts interactions as a form with one field, `payload`, holding JSON. */
export function parseSlackInteraction(raw: string): SlackInteraction {
  try {
    return JSON.parse(new URLSearchParams(raw).get("payload") ?? "{}") as SlackInteraction;
  } catch {
    return {};
  }
}

export async function answerSlackInteraction(db: Db, channel: Channel | null, payload: SlackInteraction): Promise<Response> {
  const value = payload.actions?.[0]?.value ?? "";
  if (payload.type !== "block_actions" || !value.startsWith("ap:")) return new Response("");
  if (!channel?.ownerAddress || payload.user?.id !== channel.ownerAddress) return Response.json({ text: "Only the bot's owner can approve this." });
  const parsed = readApprovalButtonToken(value.slice(3));
  if (!parsed) return Response.json({ text: "That button expired." });
  const [bot] = await db.select().from(schema.bots).where(eq(schema.bots.id, channel.botId)).limit(1);
  if (!bot) return new Response("");
  // Slack wants an answer within 3 seconds, and the approved action can take longer: decide after answering.
  after(async () => {
    const result = await decideApproval(db, { approvalId: parsed.approvalId, ownerId: bot.ownerId, decision: parsed.decision, via: "slack" });
    if (payload.response_url?.startsWith("https://hooks.slack.com/")) {
      await fetch(payload.response_url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ replace_original: false, text: result.ok ? (parsed.decision === "approve" ? "✅ Approved" : "✖ Declined") : result.error }),
      }).catch(() => {});
    }
  });
  return new Response("");
}
