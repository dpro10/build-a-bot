/**
 * "Add to Slack" in one click: one shared Slack app (SLACK_CLIENT_ID / SECRET / SIGNING_SECRET)
 * that anyone can add to their workspace, instead of each owner making their bot its own app.
 *
 * - Adding it: the owner clicks Add to Slack, picks a workspace and clicks Allow. The flow is
 *   bound to the signed-in owner, so the Slack person who allowed it is the owner on Slack and
 *   no "link CODE" step is needed.
 * - Messages: a DM to the shared app goes to the sender's own bot (routed by workspace and
 *   Slack user). Replies carry the bot's name and face (chat:write.customize).
 * - One bot per person per workspace: adding another bot moves Slack over to it.
 * - Removing the app in Slack (or revoking its token) turns Slack off for every bot in that
 *   workspace.
 *
 * The per-bot app made from a manifest (setup.ts, "manifest" / "tokens") stays as the way to
 * give a bot its own name in Slack's sidebar.
 */
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Bot, Channel, User } from "@/lib/db/schema";
import { appUrl, config } from "@/lib/env";
import { randomToken } from "@/lib/crypto";
import { UnreachableError } from "@/lib/utils";
import { rateLimit } from "@/lib/safety/ratelimit";
import { receipt } from "@/lib/agent/run";
import { deliver, ensureConversation } from "./outbound";
import { channelSecret, replaceCredential, storeCredential } from "./secrets";
import { slackBotToken, slackCall } from "./slack";

/** What the shared app asks for: DMs with the people who add it, nothing else. */
export const SLACK_APP_SCOPES = ["chat:write", "chat:write.customize", "im:history", "im:write"];

export function slackCallbackUrl(): string {
  return `${appUrl()}/api/channels/slack/callback`;
}

/** The shared app's Slack channels in one workspace (optionally: one Slack person's). */
function inWorkspace(teamId: string) {
  return and(eq(schema.channels.kind, "slack"), sql`${schema.channels.config}->>'via' = 'app'`, sql`${schema.channels.config}->>'teamId' = ${teamId}`);
}

/** Start adding the shared app: returns Slack's "Allow" page for this owner and bot. */
export async function startSlackInstall(db: Db, owner: User, bot: Bot, channel: Channel): Promise<string> {
  const state = randomToken(24);
  await db.insert(schema.oauthStates).values({
    id: state,
    ownerId: owner.id,
    botId: bot.id,
    kind: "slack",
    data: { channelId: channel.id },
    redirectTo: `/app/bots/${bot.id}/tools?tab=channels`,
    expiresAt: new Date(Date.now() + 15 * 60_000),
  });
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", config.slack.clientId ?? "");
  url.searchParams.set("scope", SLACK_APP_SCOPES.join(","));
  url.searchParams.set("redirect_uri", slackCallbackUrl());
  url.searchParams.set("state", state);
  return url.toString();
}

type OAuthV2Access = {
  ok?: boolean;
  error?: string;
  access_token?: string;
  token_type?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: { id?: string; name?: string } | null;
  authed_user?: { id?: string };
};

export type SlackInstallResult =
  | { ok: true; redirectTo: string; botName: string; movedFrom: string[] }
  | { ok: false; message: string; redirectTo?: string };

/** Slack sent the owner back: swap the code for the workspace's bot token and turn Slack on. */
export async function finishSlackInstall(
  db: Db,
  input: { state: string; code: string | null; error: string | null; userId: string | null },
): Promise<SlackInstallResult> {
  const [row] = input.state ? await db.select().from(schema.oauthStates).where(eq(schema.oauthStates.id, input.state)).limit(1) : [];
  if (!row || row.kind !== "slack" || row.expiresAt.getTime() < Date.now()) return { ok: false, message: "That Slack link expired. Click Add to Slack again." };
  await db.delete(schema.oauthStates).where(eq(schema.oauthStates.id, row.id));
  // Only the person who started it can finish it, in their own browser. Whoever clicks Allow
  // becomes the bot's owner on Slack, so a link sent to someone else must not work for them.
  if (!input.userId || input.userId !== row.ownerId) return { ok: false, message: "Sign in to Build-a-bot as the bot's owner, then click Add to Slack again." };
  const back = row.redirectTo ?? "/app";
  if (input.error || !input.code) {
    return { ok: false, message: input.error === "access_denied" ? "Slack wasn't added: it was canceled in Slack." : "Slack didn't finish adding it. Try again.", redirectTo: back };
  }

  const channelId = String((row.data as { channelId?: unknown }).channelId ?? "");
  const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).limit(1);
  const [bot] = row.botId ? await db.select().from(schema.bots).where(eq(schema.bots.id, row.botId)).limit(1) : [];
  const [owner] = await db.select().from(schema.users).where(eq(schema.users.id, row.ownerId)).limit(1);
  if (!channel || !bot || !owner || channel.botId !== bot.id || channel.kind !== "slack" || bot.ownerId !== owner.id) {
    return { ok: false, message: "That bot isn't there anymore.", redirectTo: "/app" };
  }

  let tok: OAuthV2Access;
  try {
    const res = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${config.slack.clientId}:${config.slack.clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ code: input.code, redirect_uri: slackCallbackUrl() }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    tok = (await res.json().catch(() => ({}))) as OAuthV2Access;
  } catch {
    return { ok: false, message: "Couldn't reach Slack. Try again in a moment.", redirectTo: back };
  }
  const token = tok.access_token;
  const teamId = tok.team?.id;
  const slackUser = tok.authed_user?.id;
  if (!tok.ok || tok.token_type !== "bot" || !token?.startsWith("xoxb-") || !teamId || !slackUser) {
    console.error("[slack] adding the app failed:", tok.error ?? "an unexpected answer from oauth.v2.access");
    return { ok: false, message: "Slack didn't finish adding it. Try again.", redirectTo: back };
  }
  const teamName = tok.team?.name || "your workspace";
  const secret = JSON.stringify({ botToken: token });

  // The workspace's other bots on the shared app: this person's own (one bot per person in a
  // workspace, so Slack moves to this one) and other people's (they get the newest token).
  const others = await db.select().from(schema.channels).where(and(inWorkspace(teamId), ne(schema.channels.id, channel.id)));
  const movedFrom: string[] = [];
  for (const other of others) {
    if (other.ownerAddress === slackUser) {
      await turnOff(db, other);
      const [was] = await db.select({ name: schema.bots.name }).from(schema.bots).where(eq(schema.bots.id, other.botId)).limit(1);
      if (was) movedFrom.push(was.name);
    } else if (other.credentialId) {
      await replaceCredential(db, other.credentialId, secret);
    }
  }

  const credentialId = await storeCredential(db, { ownerId: owner.id, kind: "bot_token", provider: "slack", secret, label: teamName, meta: { via: "app", teamId } });
  if (channel.credentialId) await db.delete(schema.credentials).where(eq(schema.credentials.id, channel.credentialId));
  const [active] = await db
    .update(schema.channels)
    .set({
      status: "active",
      address: teamName,
      ownerAddress: slackUser,
      ownerVerifiedAt: new Date(),
      credentialId,
      config: { via: "app", teamId, appId: tok.app_id ?? null, botUserId: tok.bot_user_id ?? null },
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.channels.id, channel.id))
    .returning();

  const hello = await deliver(
    db,
    bot,
    "slack",
    { to: slackUser, text: `Hi! It's ${bot.name}, your AI assistant 👋 Message me here anytime, like you would a teammate.`, toOwner: true },
    { owner, channel: active },
  );
  if (hello.status === "sent") {
    // The hello says it's an AI, so the first reply doesn't repeat it.
    const conversation = await ensureConversation(db, bot.id, "slack", slackUser);
    await db.update(schema.conversations).set({ lastDisclosureAt: new Date() }).where(eq(schema.conversations.id, conversation.id));
  }
  return { ok: true, redirectTo: back, botName: bot.name, movedFrom };
}

/** The Slack channel a person reaches by DMing the shared app in their workspace. */
export async function slackAppChannelFor(db: Db, teamId: string, slackUser: string): Promise<Channel | null> {
  const [row] = await db
    .select()
    .from(schema.channels)
    .where(and(inWorkspace(teamId), eq(schema.channels.ownerAddress, slackUser)))
    .orderBy(desc(schema.channels.updatedAt))
    .limit(1);
  return row ?? null;
}

/** Slack off for this bot: back to setup, and its copy of the token is deleted. */
async function turnOff(db: Db, channel: Channel) {
  await db
    .update(schema.channels)
    .set({ status: "needs_setup", ownerAddress: null, ownerVerifiedAt: null, credentialId: null, config: {}, error: null, updatedAt: new Date() })
    .where(eq(schema.channels.id, channel.id));
  if (channel.credentialId) await db.delete(schema.credentials).where(eq(schema.credentials.id, channel.credentialId));
}

/**
 * Slack says the app was removed from a workspace, or its token revoked. If the workspace's token
 * really stopped working, Slack is off for every bot there. An old token revoked after someone
 * added the app again, or a late duplicate, changes nothing.
 */
export async function slackAppRemoved(db: Db, teamId: string): Promise<number> {
  const rows = await db.select().from(schema.channels).where(inWorkspace(teamId));
  if (!rows.length) return 0;
  const holder = rows.find((r) => r.credentialId);
  const token = holder ? slackBotToken(await channelSecret(db, holder)) : null;
  if (token) {
    try {
      await slackCall(token, "auth.test", {});
      return 0; // the token still works
    } catch (err) {
      if (err instanceof UnreachableError) {
        console.error("[slack] couldn't check a workspace's token after it was revoked:", err.message);
        return 0;
      }
    }
  }
  const bots = await db.select().from(schema.bots).where(inArray(schema.bots.id, rows.map((r) => r.botId)));
  for (const row of rows) {
    await turnOff(db, row);
    const bot = bots.find((b) => b.id === row.botId);
    if (bot) await receipt(db, bot, "system", "ok", `Removed from Slack (${row.address ?? "a workspace"})`, { channel: "slack" });
  }
  return rows.length;
}

/**
 * Someone DMed the shared app but it doesn't lead to an active bot of theirs: say why, at most
 * once a day per person (never a loop, never a conversation).
 */
export async function slackAppNotHere(db: Db, teamId: string, slackUser: string, channel: Channel | null): Promise<void> {
  if (!(await rateLimit(db, `slack-app-hello:${teamId}:${slackUser}`, 1, 86_400)).ok) return;
  let text: string;
  let token: string | null = null;
  if (channel) {
    const [bot] = await db.select({ name: schema.bots.name }).from(schema.bots).where(eq(schema.bots.id, channel.botId)).limit(1);
    text = `Slack is turned off for ${bot?.name ?? "your bot"}. Turn it back on in Apps & channels: ${appUrl()}/app/bots/${channel.botId}/tools?tab=channels`;
    token = slackBotToken(await channelSecret(db, channel));
  } else {
    text = `Hi! I'm an AI assistant that people make for themselves, and you don't have one here yet. Make your own for free at ${appUrl()}, then add it to Slack.`;
  }
  if (!token) {
    const [any] = await db.select().from(schema.channels).where(and(inWorkspace(teamId), sql`${schema.channels.credentialId} is not null`)).limit(1);
    token = any ? slackBotToken(await channelSecret(db, any)) : null;
  }
  if (!token) return;
  try {
    const open = await slackCall<{ channel: { id: string } }>(token, "conversations.open", { users: slackUser });
    await slackCall(token, "chat.postMessage", { channel: open.channel.id, text });
  } catch (err) {
    console.error("[slack] couldn't answer someone without a bot:", (err as Error).message);
  }
}
