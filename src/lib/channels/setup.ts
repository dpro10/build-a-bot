/**
 * Setting up channels from the app: proving the owner is who they say they are on
 * each channel (codes, links), and wiring credentials. In demo mode, codes are shown
 * on screen and deliveries are simulated so the full flow can be tried.
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Bot, Channel, User } from "@/lib/db/schema";
import { appUrl, config, demoMode, live } from "@/lib/env";
import { numericCode } from "@/lib/crypto";
import { isEmail, newId, normalizePhone } from "@/lib/utils";
import { getPlan, planAllowsChannel } from "@/lib/billing/plans";
import { botEmailAddress } from "@/lib/tools/builtin";
import { CHANNEL_BY_KIND, type ChannelKind } from "./catalog";
import { deliver } from "./outbound";
import { storeCredential } from "./secrets";
import { slackCall } from "./slack";
import { sendSms } from "./twilio";
import { sendEmailRaw } from "./email";
import { connectTelegramToken, startManagedTelegram } from "./telegram-setup";

export type SetupResult = { ok: true; data?: Record<string, unknown> } | { ok: false; error: string; status?: number };

async function ensureChannel(db: Db, bot: Bot, kind: ChannelKind): Promise<Channel> {
  const [existing] = await db.select().from(schema.channels).where(and(eq(schema.channels.botId, bot.id), eq(schema.channels.kind, kind))).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(schema.channels).values({ id: newId("chn"), botId: bot.id, kind, status: "needs_setup" }).returning();
  return created;
}

async function saveCode(db: Db, owner: User, bot: Bot, channel: Channel, purpose: string, prefix: string, data: Record<string, unknown> = {}) {
  const code = numericCode(6);
  await db.insert(schema.pairingCodes).values({
    code: `${prefix}_${channel.id}_${code}`,
    purpose,
    ownerId: owner.id,
    botId: bot.id,
    channelId: channel.id,
    data,
    expiresAt: new Date(Date.now() + 30 * 60_000),
  });
  return code;
}

async function useCode(db: Db, channel: Channel, prefix: string, code: string) {
  const [row] = await db
    .update(schema.pairingCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.pairingCodes.code, `${prefix}_${channel.id}_${code.trim()}`), isNull(schema.pairingCodes.usedAt), gt(schema.pairingCodes.expiresAt, new Date())))
    .returning();
  return row ?? null;
}

export async function channelAction(
  db: Db,
  owner: User,
  bot: Bot,
  kind: ChannelKind,
  action: string,
  payload: Record<string, unknown>,
): Promise<SetupResult> {
  const def = CHANNEL_BY_KIND[kind];
  if (!def) return { ok: false, error: "Unknown channel" };
  const plan = getPlan(owner.plan);

  if (action === "waitlist") {
    const email = String(payload.email ?? owner.email ?? "");
    if (!isEmail(email)) return { ok: false, error: "Add an email so we can tell you when it's ready." };
    await db.insert(schema.waitlist).values({ id: newId("wl"), email, feature: `channel:${kind}`, userId: owner.id }).onConflictDoNothing();
    return { ok: true, data: { message: `You're on the list for ${def.name}.` } };
  }
  if (def.availability === "waitlist" || def.availability === "soon") return { ok: false, error: `${def.name} isn't available yet.` };
  if (!planAllowsChannel(plan, kind) && !demoMode) return { ok: false, error: `${def.name} is part of ${def.minPlan === "pro" ? "Pro" : "Plus"}.`, status: 402 };

  const channel = await ensureChannel(db, bot, kind);

  if (action === "disable") {
    await db.update(schema.channels).set({ status: "disabled", updatedAt: new Date() }).where(eq(schema.channels.id, channel.id));
    return { ok: true };
  }
  if (action === "enable") {
    const status = channel.ownerVerifiedAt ? "active" : "needs_setup";
    await db.update(schema.channels).set({ status, updatedAt: new Date() }).where(eq(schema.channels.id, channel.id));
    return { ok: true, data: { status } };
  }
  if (action === "test") {
    if (!channel.ownerAddress || channel.status !== "active") return { ok: false, error: "Finish setting this channel up first." };
    const res = await deliver(db, bot, kind, { to: channel.ownerAddress, text: `Hi! It's ${bot.name}, testing ${def.name}. 👋`, toOwner: true }, { owner, channel });
    return res.status === "failed" ? { ok: false, error: res.error ?? "Couldn't send" } : { ok: true, data: { status: res.status } };
  }

  switch (kind) {
    case "telegram": {
      if (action === "managed") {
        const managed = await startManagedTelegram(db, bot, channel);
        if (managed) return { ok: true, data: managed };
        if (demoMode) return { ok: true, data: { demo: true } };
        return { ok: false, error: "One-tap Telegram isn't set up here yet. Paste a BotFather token instead." };
      }
      if (action === "token") {
        const token = String(payload.token ?? "").trim();
        if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token)) return { ok: false, error: "That doesn't look like a BotFather token (123456:ABC...)." };
        try {
          const out = await connectTelegramToken(db, bot, owner, channel, token);
          return { ok: true, data: out };
        } catch (err) {
          return { ok: false, error: (err as Error).message };
        }
      }
      if (action === "demo_connect" && demoMode) {
        const handle = `@${bot.handle.replace(/-/g, "_")}_bot`;
        await db
          .update(schema.channels)
          .set({ status: "active", address: handle, ownerAddress: "demo-telegram-user", ownerVerifiedAt: new Date(), config: { simulated: true } })
          .where(eq(schema.channels.id, channel.id));
        return { ok: true, data: { username: handle, simulated: true } };
      }
      break;
    }
    case "sms":
    case "voice": {
      if (action === "send_code") {
        const phone = normalizePhone(String(payload.phone ?? ""));
        if (!phone) return { ok: false, error: "Enter a valid phone number." };
        const code = await saveCode(db, owner, bot, channel, "phone", "ph", { phone });
        if (live.twilio) {
          await sendSms(config.twilio.phoneNumber!, phone, `Your ${bot.name} verification code is ${code}. Reply STOP to opt out.`);
          return { ok: true, data: { sent: true } };
        }
        if (demoMode) return { ok: true, data: { sent: false, demoCode: code } };
        return { ok: false, error: "Texting isn't set up on this server yet." };
      }
      if (action === "verify") {
        const row = await useCode(db, channel, "ph", String(payload.code ?? ""));
        if (!row) return { ok: false, error: "That code is wrong or expired." };
        const phone = String((row.data as { phone?: string }).phone);
        // Verifying a phone covers both texting and calls.
        for (const k of ["sms", "voice"] as const) {
          const ch = k === kind ? channel : (await db.select().from(schema.channels).where(and(eq(schema.channels.botId, bot.id), eq(schema.channels.kind, k))).limit(1))[0];
          if (!ch) continue;
          await db
            .update(schema.channels)
            .set({ ownerAddress: phone, ownerVerifiedAt: new Date(), status: "active", address: config.twilio.phoneNumber ?? ch.address, config: { ...ch.config, simulated: !live.twilio } })
            .where(eq(schema.channels.id, ch.id));
        }
        return { ok: true, data: { phone, number: config.twilio.phoneNumber ?? null } };
      }
      if (action === "call_me" && kind === "voice") {
        if (!channel.ownerAddress) return { ok: false, error: "Verify your phone first." };
        const res = await deliver(db, bot, "voice", { to: channel.ownerAddress, text: `Just calling to say hi. Call me back at this number anytime.`, toOwner: true }, { owner, channel });
        return res.status === "failed" ? { ok: false, error: res.error ?? "Call failed" } : { ok: true, data: { status: res.status } };
      }
      break;
    }
    case "email": {
      if (action === "send_code") {
        const email = String(payload.email ?? owner.email ?? "").trim().toLowerCase();
        if (!isEmail(email)) return { ok: false, error: "Enter a valid email." };
        const code = await saveCode(db, owner, bot, channel, "email", "em", { email });
        if (live.email) {
          await sendEmailRaw({
            from: botEmailAddress(bot),
            fromName: `${bot.name} (AI assistant)`,
            to: email,
            subject: `Your ${bot.name} code: ${code}`,
            text: `Hi! Enter ${code} in the app to let ${bot.name} email you and read what you forward.\n\nIf you didn't ask for this, ignore it.`,
          });
          return { ok: true, data: { sent: true, botAddress: botEmailAddress(bot) } };
        }
        if (demoMode) return { ok: true, data: { sent: false, demoCode: code, botAddress: botEmailAddress(bot) } };
        return { ok: false, error: "Email isn't set up on this server yet." };
      }
      if (action === "verify") {
        const row = await useCode(db, channel, "em", String(payload.code ?? ""));
        if (!row) return { ok: false, error: "That code is wrong or expired." };
        const email = String((row.data as { email?: string }).email);
        await db
          .update(schema.channels)
          .set({ ownerAddress: email, ownerVerifiedAt: new Date(), status: "active", address: botEmailAddress(bot), config: { ...channel.config, simulated: !live.email } })
          .where(eq(schema.channels.id, channel.id));
        return { ok: true, data: { email, botAddress: botEmailAddress(bot) } };
      }
      break;
    }
    case "slack": {
      if (action === "manifest") {
        const manifest = {
          display_information: { name: bot.name, description: `${bot.name}, your AI assistant`, background_color: "#2a1b75" },
          features: {
            app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
            bot_user: { display_name: bot.name, always_online: true },
          },
          oauth_config: { scopes: { bot: ["chat:write", "im:history", "im:read", "im:write", "users:read"] } },
          settings: {
            event_subscriptions: { request_url: `${appUrl()}/api/webhooks/slack/${channel.id}/events`, bot_events: ["message.im"] },
            interactivity: { is_enabled: true, request_url: `${appUrl()}/api/webhooks/slack/${channel.id}/interactive` },
            org_deploy_enabled: false,
            socket_mode_enabled: false,
            token_rotation_enabled: false,
          },
        };
        return { ok: true, data: { manifestUrl: `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(manifest))}` } };
      }
      if (action === "tokens") {
        const botToken = String(payload.botToken ?? "").trim();
        const signingSecret = String(payload.signingSecret ?? "").trim();
        if (!botToken.startsWith("xoxb-") || signingSecret.length < 16) return { ok: false, error: "Paste the Bot User OAuth Token (xoxb-…) and the Signing Secret." };
        let team = "your workspace";
        if (!demoMode || live.slackOAuth) {
          try {
            const auth = await slackCall<{ team?: string }>(botToken, "auth.test", {});
            team = auth.team ?? team;
          } catch (err) {
            return { ok: false, error: `Slack didn't accept that token: ${(err as Error).message}` };
          }
        }
        const credentialId = await storeCredential(db, { ownerId: owner.id, kind: "bot_token", provider: "slack", secret: JSON.stringify({ botToken, signingSecret }), label: team });
        await db.update(schema.channels).set({ credentialId, address: team, status: "pending", updatedAt: new Date() }).where(eq(schema.channels.id, channel.id));
        const code = await saveCode(db, owner, bot, channel, "slack_owner", "slk");
        return { ok: true, data: { code, instructions: `In Slack, open a DM with ${bot.name} and send: link ${code}` } };
      }
      if (action === "demo_connect" && demoMode) {
        await db.update(schema.channels).set({ status: "active", address: "Demo workspace", ownerAddress: "U_DEMO", ownerVerifiedAt: new Date(), config: { simulated: true } }).where(eq(schema.channels.id, channel.id));
        return { ok: true, data: { simulated: true } };
      }
      break;
    }
    case "discord": {
      if (action === "link") {
        if (!live.discord && !demoMode) return { ok: false, error: "Discord isn't set up on this server yet." };
        const code = await saveCode(db, owner, bot, channel, "discord_owner", "dsc");
        const installUrl = config.discord.applicationId
          ? `https://discord.com/oauth2/authorize?client_id=${config.discord.applicationId}&integration_type=1&scope=applications.commands`
          : null;
        if (!live.discord && demoMode) {
          await db.update(schema.channels).set({ status: "active", address: "Discord (demo)", ownerAddress: "demo-discord-user", ownerVerifiedAt: new Date(), config: { simulated: true } }).where(eq(schema.channels.id, channel.id));
          return { ok: true, data: { code, installUrl, simulated: true } };
        }
        return { ok: true, data: { code, installUrl, instructions: `Add the app to Discord, then type /link code:${code}` } };
      }
      break;
    }
  }
  return { ok: false, error: "That action isn't available for this channel." };
}
