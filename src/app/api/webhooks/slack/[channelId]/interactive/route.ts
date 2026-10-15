import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { channelSecret } from "@/lib/channels/secrets";
import { verifySlackSignature } from "@/lib/channels/slack";
import { answerSlackInteraction, parseSlackInteraction } from "@/lib/channels/slack-interactive";
import type { RouteCtx } from "@/lib/api";

export const maxDuration = 120;

/** Approve / Deny buttons in a bot's own Slack app. */
export async function POST(req: Request, ctx: RouteCtx<{ channelId: string }>) {
  const { channelId } = await ctx.params;
  const raw = await req.text();
  const db = await getDb();
  const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).limit(1);
  if (!channel) return new Response("not found", { status: 404 });
  const secretJson = await channelSecret(db, channel);
  const creds = secretJson ? (JSON.parse(secretJson) as { signingSecret?: string }) : null;
  if (!creds?.signingSecret || !verifySlackSignature(creds.signingSecret, raw, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature"))) {
    return new Response("bad signature", { status: 401 });
  }
  return answerSlackInteraction(db, channel, parseSlackInteraction(raw));
}
