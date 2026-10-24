import { after } from "next/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { channelSecret } from "@/lib/channels/secrets";
import { verifySlackSignature } from "@/lib/channels/slack";
import { handleInbound, loadBotAndOwner, seenBefore } from "@/lib/channels/inbound";
import { rateLimit } from "@/lib/safety/ratelimit";
import type { RouteCtx } from "@/lib/api";

export const maxDuration = 300;

type SlackCreds = { botToken: string; signingSecret: string };

export async function POST(req: Request, ctx: RouteCtx<{ channelId: string }>) {
  const { channelId } = await ctx.params;
  const raw = await req.text();
  let body: { type?: string; challenge?: string; event_id?: string; event?: { type: string; channel_type?: string; user?: string; text?: string; bot_id?: string; subtype?: string; channel?: string; ts?: string } };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad request", { status: 400 });
  }
  const db = await getDb();
  const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).limit(1);
  if (!channel || channel.kind !== "slack") return new Response("not found", { status: 404 });

  const secretJson = await channelSecret(db, channel);
  const parsed = secretJson ? (JSON.parse(secretJson) as Partial<SlackCreds>) : null;
  // A bot on the shared "Add to Slack" app has no signing secret of its own: its events come to /api/webhooks/slack/events.
  const creds = parsed?.botToken && parsed.signingSecret ? (parsed as SlackCreds) : null;

  // Slack checks the URL before the owner has pasted the signing secret: echo the challenge.
  if (body.type === "url_verification") {
    if (creds && !verifySlackSignature(creds.signingSecret, raw, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature"))) {
      return new Response("bad signature", { status: 401 });
    }
    return Response.json({ challenge: body.challenge });
  }
  if (!creds) return new Response("not set up", { status: 409 });
  if (!verifySlackSignature(creds.signingSecret, raw, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature"))) {
    return new Response("bad signature", { status: 401 });
  }
  // Turned off in the app: the bot doesn't answer anyone here.
  if (channel.status === "disabled") return new Response("ok");
  if (await seenBefore(db, `slack-${channelId}`, body.event_id)) return new Response("ok");
  const ev = body.event;
  // A message with a file attached comes as "file_share": its words still get an answer.
  if (!ev || ev.type !== "message" || ev.channel_type !== "im" || ev.bot_id || (ev.subtype && ev.subtype !== "file_share") || !ev.user) return new Response("ok");
  if (!ev.text?.trim()) ev.text = "(I sent you a file.)";

  after(async () => {
    const loaded = await loadBotAndOwner(db, channel.botId);
    if (!loaded) return;
    const link = /^link\s+(\d{6})$/i.exec(ev.text!.trim());
    // A typed 6-digit code: only so many tries an hour, so it can't be guessed.
    if (link && !channel.ownerAddress && (await rateLimit(db, `slack-link:${channel.id}`, 10, 3600)).ok) {
      const [code] = await db
        .select()
        .from(schema.pairingCodes)
        .where(and(eq(schema.pairingCodes.code, `slk_${channel.id}_${link[1]}`), isNull(schema.pairingCodes.usedAt), gt(schema.pairingCodes.expiresAt, new Date())))
        .limit(1);
      if (code) {
        await db.update(schema.pairingCodes).set({ usedAt: new Date() }).where(eq(schema.pairingCodes.code, code.code));
        await db.update(schema.channels).set({ ownerAddress: ev.user!, ownerVerifiedAt: new Date(), status: "active" }).where(eq(schema.channels.id, channel.id));
        channel.ownerAddress = ev.user!;
        ev.text = "Hi! I just linked you on Slack. Say hello.";
      }
    }
    await handleInbound({
      db,
      bot: loaded.bot,
      owner: loaded.owner,
      channel,
      kind: "slack",
      threadId: ev.user!,
      replyTo: ev.user!,
      text: ev.text!,
      isOwner: channel.ownerAddress === ev.user,
      from: ev.user!,
      contactLabel: `Slack user ${ev.user}`,
      meta: { ts: ev.ts },
    });
  });
  return new Response("ok");
}
