import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { channelSecret } from "@/lib/channels/secrets";
import { verifySlackSignature } from "@/lib/channels/slack";
import { decideApproval, readApprovalButtonToken } from "@/lib/agent/approvals";
import type { RouteCtx } from "@/lib/api";

export const maxDuration = 120;

/** Approve / Deny buttons in Slack. */
export async function POST(req: Request, ctx: RouteCtx<{ channelId: string }>) {
  const { channelId } = await ctx.params;
  const raw = await req.text();
  const db = await getDb();
  const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).limit(1);
  if (!channel) return new Response("not found", { status: 404 });
  const secretJson = await channelSecret(db, channel);
  const creds = secretJson ? (JSON.parse(secretJson) as { signingSecret: string }) : null;
  if (!creds || !verifySlackSignature(creds.signingSecret, raw, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature"))) {
    return new Response("bad signature", { status: 401 });
  }
  const payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "{}") as {
    type?: string;
    user?: { id: string };
    actions?: { value?: string }[];
    response_url?: string;
  };
  const value = payload.actions?.[0]?.value ?? "";
  if (payload.type !== "block_actions" || !value.startsWith("ap:")) return new Response("");
  if (payload.user?.id !== channel.ownerAddress) return Response.json({ text: "Only the bot's owner can approve this." });
  const parsed = readApprovalButtonToken(value.slice(3));
  if (!parsed) return Response.json({ text: "That button expired." });
  const [bot] = await db.select().from(schema.bots).where(eq(schema.bots.id, channel.botId)).limit(1);
  if (!bot) return new Response("");
  const result = await decideApproval(db, { approvalId: parsed.approvalId, ownerId: bot.ownerId, decision: parsed.decision, via: "slack" });
  if (payload.response_url) {
    await fetch(payload.response_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ replace_original: false, text: result.ok ? (parsed.decision === "approve" ? "✅ Approved" : "✖ Declined") : result.error }),
    }).catch(() => {});
  }
  return new Response("");
}
