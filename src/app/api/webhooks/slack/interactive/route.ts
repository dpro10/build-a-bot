import { getDb } from "@/lib/db";
import { config } from "@/lib/env";
import { verifySlackSignature } from "@/lib/channels/slack";
import { slackAppChannelFor } from "@/lib/channels/slack-app";
import { answerSlackInteraction, parseSlackInteraction } from "@/lib/channels/slack-interactive";

export const maxDuration = 120;

/** Approve / Deny buttons on the shared "Add to Slack" app: the presser's own bot decides. */
export async function POST(req: Request) {
  const signingSecret = config.slack.signingSecret;
  if (!signingSecret) return new Response("not set up", { status: 404 });
  const raw = await req.text();
  if (!verifySlackSignature(signingSecret, raw, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature"))) {
    return new Response("bad signature", { status: 401 });
  }
  const payload = parseSlackInteraction(raw);
  const db = await getDb();
  const channel = payload.team?.id && payload.user?.id ? await slackAppChannelFor(db, payload.team.id, payload.user.id) : null;
  return answerSlackInteraction(db, channel?.status === "active" ? channel : null, payload);
}
