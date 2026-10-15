import { after } from "next/server";
import { getDb } from "@/lib/db";
import { config } from "@/lib/env";
import { verifySlackSignature } from "@/lib/channels/slack";
import { slackAppChannelFor, slackAppNotHere, slackAppRemoved } from "@/lib/channels/slack-app";
import { handleInbound, loadBotAndOwner, seenBefore } from "@/lib/channels/inbound";

export const maxDuration = 300;

type Envelope = {
  type?: string;
  challenge?: string;
  team_id?: string;
  event_id?: string;
  authorizations?: { team_id?: string }[];
  event?: {
    type: string;
    channel_type?: string;
    user?: string;
    text?: string;
    bot_id?: string;
    subtype?: string;
    ts?: string;
    tokens?: { bot?: string[] };
  };
};

/**
 * Events for the shared "Add to Slack" app: DMs (each goes to the sender's own bot), and the
 * app being removed from a workspace.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let body: Envelope;
  try {
    body = JSON.parse(raw) as Envelope;
  } catch {
    return new Response("bad request", { status: 400 });
  }
  const signingSecret = config.slack.signingSecret;
  // Slack checks this URL as soon as the app is created, before its signing secret is in our settings.
  if (!signingSecret) return body.type === "url_verification" ? Response.json({ challenge: body.challenge }) : new Response("not set up", { status: 404 });
  if (!verifySlackSignature(signingSecret, raw, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature"))) {
    return new Response("bad signature", { status: 401 });
  }
  if (body.type === "url_verification") return Response.json({ challenge: body.challenge });
  const ev = body.event;
  const teamId = body.team_id ?? body.authorizations?.[0]?.team_id;
  if (body.type !== "event_callback" || !ev || !teamId) return new Response("ok");

  const db = await getDb();
  if (await seenBefore(db, "slack-app", body.event_id)) return new Response("ok");

  if (ev.type === "app_uninstalled" || (ev.type === "tokens_revoked" && ev.tokens?.bot?.length)) {
    await slackAppRemoved(db, teamId);
    return new Response("ok");
  }
  if (ev.type !== "message" || ev.channel_type !== "im" || ev.bot_id || ev.subtype || !ev.user || !ev.text) return new Response("ok");
  const from = ev.user;
  const text = ev.text;

  // Slack wants an answer within 3 seconds; the bot replies on its own time.
  after(async () => {
    const channel = await slackAppChannelFor(db, teamId, from);
    if (channel?.status !== "active") {
      await slackAppNotHere(db, teamId, from, channel);
      return;
    }
    const loaded = await loadBotAndOwner(db, channel.botId);
    if (!loaded) return;
    // Everyone reaches only their own bot here: the sender is the Slack person who added it.
    await handleInbound({
      db,
      bot: loaded.bot,
      owner: loaded.owner,
      channel,
      kind: "slack",
      threadId: from,
      replyTo: from,
      text,
      isOwner: true,
      from,
      meta: { ts: ev.ts },
    });
  });
  return new Response("ok");
}
