/**
 * Setting up channels from the app: proving the owner is who they say they are on
 * each channel (codes, links), and wiring credentials. In demo mode, codes are shown
 * on screen and deliveries are simulated so the full flow can be tried.
 */
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Bot, Channel, User } from "@/lib/db/schema";
import { appUrl, config, demoMode, live } from "@/lib/env";
import { numericCode, pairingCode } from "@/lib/crypto";
import { isEmail, isUsOrCanadaPhone, newId, normalizePhone, UnreachableError } from "@/lib/utils";
import { botEmailAddress } from "@/lib/tools/builtin";
import { CHANNEL_BY_KIND, channelUsable, comingSoonNote, type ChannelKind } from "./catalog";
import { deliver } from "./outbound";
import { storeCredential } from "./secrets";
import { slackCall } from "./slack";
import { startSlackInstall } from "./slack-app";
import { codeCallTwiml, placeCall, sendSms } from "./twilio";
import { sendEmailRaw } from "./email";
import { connectTelegramToken, startManagedTelegram } from "./telegram-setup";
import { rateLimit, refundRateLimit } from "@/lib/safety/ratelimit";

export type SetupResult = { ok: true; data?: Record<string, unknown> } | { ok: false; error: string; status?: number; code?: string };

/** A delivery that failed, as a setup error (out of credit is a 402 the page can offer "Add credit" for). */
function failedDelivery(res: { error?: string; code?: string }, fallback: string): SetupResult {
  return res.code === "no_credit" ? { ok: false, error: res.error ?? fallback, status: 402, code: "no_credit" } : { ok: false, error: res.error ?? fallback };
}

async function ensureChannel(db: Db, bot: Bot, kind: ChannelKind): Promise<Channel> {
  const [existing] = await db.select().from(schema.channels).where(and(eq(schema.channels.botId, bot.id), eq(schema.channels.kind, kind))).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(schema.channels).values({ id: newId("chn"), botId: bot.id, kind, status: "needs_setup" }).returning();
  return created;
}

async function saveCode(db: Db, owner: User, bot: Bot, channel: Channel, purpose: string, prefix: string, data: Record<string, unknown> = {}) {
  // Discord's /link can't say which bot it's for, so its code is matched against every
  // pending one: it gets a long code (~40 bits, like "K7XQ-29MD") that can't be guessed.
  const code = prefix === "dsc" ? pairingCode() : numericCode(6);
  await db.insert(schema.pairingCodes).values({
    code: `${prefix}_${channel.id}_${prefix === "dsc" ? normalizeLinkCode(code) : code}`,
    purpose,
    ownerId: owner.id,
    botId: bot.id,
    channelId: channel.id,
    data,
    expiresAt: new Date(Date.now() + 30 * 60_000),
  });
  return code;
}

/** Discord link codes as stored and matched: upper case, no dash or spaces. */
export function normalizeLinkCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

/** Wrong guesses allowed per code before it stops working (6 digits, so brute force is hopeless). */
const MAX_CODE_ATTEMPTS = 5;

type UseCodeResult = { ok: true; row: typeof schema.pairingCodes.$inferSelect } | { ok: false; error: string };

/**
 * Check a verification code for this channel. Every wrong guess counts against all of the
 * channel's live codes; after MAX_CODE_ATTEMPTS a code is dead and the owner sends a new one.
 */
async function useCode(db: Db, channel: Channel, purpose: string, prefix: string, code: string): Promise<UseCodeResult> {
  const now = new Date();
  const live = await db
    .select()
    .from(schema.pairingCodes)
    .where(and(eq(schema.pairingCodes.channelId, channel.id), eq(schema.pairingCodes.purpose, purpose), isNull(schema.pairingCodes.usedAt), gt(schema.pairingCodes.expiresAt, now)));
  const usable = live.filter((r) => r.attempts < MAX_CODE_ATTEMPTS);
  if (!usable.length) {
    return { ok: false, error: live.length ? "Too many wrong tries. Send yourself a new code." : "That code expired or was already used. Send yourself a new code." };
  }
  const wanted = `${prefix}_${channel.id}_${code.trim()}`;
  const hit = usable.find((r) => r.code === wanted);
  if (!hit) {
    await db
      .update(schema.pairingCodes)
      .set({ attempts: sql`${schema.pairingCodes.attempts} + 1` })
      .where(inArray(schema.pairingCodes.code, usable.map((r) => r.code)));
    const stillUsable = usable.some((r) => r.attempts + 1 < MAX_CODE_ATTEMPTS);
    return { ok: false, error: stillUsable ? "That code isn't right. Check it and try again." : "Too many wrong tries. Send yourself a new code." };
  }
  const [row] = await db
    .update(schema.pairingCodes)
    .set({ usedAt: now })
    .where(and(eq(schema.pairingCodes.code, hit.code), isNull(schema.pairingCodes.usedAt)))
    .returning();
  if (!row) return { ok: false, error: "That code was already used. Send yourself a new code." };
  // Verified: any other codes still out there for this channel stop working.
  await db
    .update(schema.pairingCodes)
    .set({ usedAt: now })
    .where(and(eq(schema.pairingCodes.channelId, channel.id), eq(schema.pairingCodes.purpose, purpose), isNull(schema.pairingCodes.usedAt)));
  return { ok: true, row };
}

/**
 * Verification codes cost money when they're really sent (SMS pumping is a known fraud),
 * so they're rate-limited per caller IP, per owner and per destination. Simulated codes
 * (demo mode, shown on screen) only get a loose per-owner limit.
 */
async function codeLimit(db: Db, owner: User, destination: string, reallySent: boolean, ip: string | undefined): Promise<SetupResult | null> {
  // Says when to try again: the limits are hourly windows that reset on the hour.
  const tooMany = (resetAt: Date, what = "Too many codes"): SetupResult => {
    const minutes = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 60_000));
    return { ok: false, error: `${what}. Try again in ${minutes === 1 ? "a minute" : `${minutes} minutes`}.`, status: 429 };
  };
  if (reallySent && ip) {
    const byIp = await rateLimit(db, `code:ip:${ip}`, 10, 3600);
    if (!byIp.ok) return tooMany(byIp.resetAt);
  }
  const byOwner = await rateLimit(db, `code:owner:${owner.id}`, reallySent ? 5 : 20, 3600);
  if (!byOwner.ok) return tooMany(byOwner.resetAt);
  if (reallySent) {
    const byDestination = await rateLimit(db, `code:dest:${destination}`, 3, 3600);
    if (!byDestination.ok) return tooMany(byDestination.resetAt, `Too many codes to that ${destination.startsWith("+") ? "number" : "address"}`);
  }
  return null;
}

/** A code that never went out (the provider refused it) doesn't count against anyone's limits. */
async function refundCodeLimit(db: Db, owner: User, destination: string, ip: string | undefined): Promise<void> {
  const keys = [`code:owner:${owner.id}`, `code:dest:${destination}`, ...(ip ? [`code:ip:${ip}`] : [])];
  await Promise.all(keys.map((key) => refundRateLimit(db, key)));
}

export async function channelAction(
  db: Db,
  owner: User,
  bot: Bot,
  kind: ChannelKind,
  action: string,
  payload: Record<string, unknown>,
  /** Caller details for abuse limits (the request's IP). */
  meta: { ip?: string } = {},
): Promise<SetupResult> {
  const def = CHANNEL_BY_KIND[kind];
  if (!def) return { ok: false, error: "Unknown channel" };
  if (action === "waitlist") {
    const email = String(payload.email ?? owner.email ?? "").trim().toLowerCase();
    if (!isEmail(email)) return { ok: false, error: "Add an email so we can tell you when it's ready." };
    // Same email again (say, from a new anonymous account): it's the same person, so the row follows them.
    await db
      .insert(schema.waitlist)
      .values({ id: newId("wl"), email, feature: `channel:${kind}`, userId: owner.id })
      .onConflictDoUpdate({ target: [schema.waitlist.email, schema.waitlist.feature], set: { userId: owner.id } });
    return { ok: true, data: { message: `You're on the list for ${def.name}.` } };
  }
  // Not offered yet, or its service isn't set up on this server (demo mode simulates it).
  if (!channelUsable(def, demoMode, live)) return { ok: false, error: comingSoonNote(def) };

  const channel = await ensureChannel(db, bot, kind);

  if (action === "disable") {
    await db.update(schema.channels).set({ status: "disabled", updatedAt: new Date() }).where(eq(schema.channels.id, channel.id));
    return { ok: true };
  }
  if (action === "enable") {
    // One verified phone covers both texting and calls: adding the other reuses it.
    if (!channel.ownerVerifiedAt && (kind === "sms" || kind === "voice")) {
      const [sibling] = await db
        .select()
        .from(schema.channels)
        .where(and(eq(schema.channels.botId, bot.id), eq(schema.channels.kind, kind === "sms" ? "voice" : "sms")))
        .limit(1);
      if (sibling?.ownerVerifiedAt && sibling.ownerAddress) {
        const simulated = Boolean((sibling.config as { simulated?: boolean }).simulated);
        await db
          .update(schema.channels)
          .set({
            status: "active",
            ownerAddress: sibling.ownerAddress,
            ownerVerifiedAt: sibling.ownerVerifiedAt,
            address: sibling.address ?? channel.address,
            config: { ...channel.config, simulated },
            updatedAt: new Date(),
          })
          .where(eq(schema.channels.id, channel.id));
        return { ok: true, data: { status: "active", reusedPhone: true } };
      }
    }
    const status = channel.ownerVerifiedAt ? "active" : "needs_setup";
    await db.update(schema.channels).set({ status, updatedAt: new Date() }).where(eq(schema.channels.id, channel.id));
    return { ok: true, data: { status } };
  }
  if (action === "test") {
    if (!channel.ownerAddress || channel.status !== "active") return { ok: false, error: "Finish setting this channel up first." };
    const res = await deliver(db, bot, kind, { to: channel.ownerAddress, text: `Hi! It's ${bot.name}, testing ${def.name}. 👋`, toOwner: true }, { owner, channel });
    return res.status === "failed" ? failedDelivery(res, "Couldn't send") : { ok: true, data: { status: res.status } };
  }

  switch (kind) {
    case "telegram": {
      if (action === "managed") {
        const managed = await startManagedTelegram(db, bot, channel);
        if (managed) return { ok: true, data: managed };
        if (demoMode) return { ok: true, data: { demo: true } };
        return { ok: false, error: "One-tap Telegram is coming soon. Paste a BotFather token instead." };
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
      if (action === "start_link") {
        // Pasted-token bot still waiting for its owner's /start: issue a fresh link (the old one isn't stored).
        const username = String((channel.config as { username?: string }).username ?? channel.address?.replace(/^@/, "") ?? "");
        if (!channel.credentialId || channel.ownerAddress || !username) return { ok: false, error: "There's nothing to link yet." };
        const code = numericCode(6);
        await db.insert(schema.pairingCodes).values({
          code: `tgo_${channel.id}_${code}`,
          purpose: "telegram_owner",
          ownerId: owner.id,
          botId: bot.id,
          channelId: channel.id,
          expiresAt: new Date(Date.now() + 24 * 3600_000),
        });
        return { ok: true, data: { username, startLink: `https://t.me/${username}?start=own_${code}` } };
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
        // US & Canada only for now (also what keeps premium-rate texts and calls out).
        if (!isUsOrCanadaPhone(phone)) return { ok: false, error: "Texts and calls work with US and Canada numbers for now." };
        const via = payload.via === "call" ? "call" : "sms";
        if (via === "sms" && live.twilio && !live.twilioTexting) return { ok: false, error: "Texts aren't set up here yet. Use Call me with a code." };
        const limited = await codeLimit(db, owner, phone, live.twilio, meta.ip);
        if (limited) return limited;
        const code = await saveCode(db, owner, bot, channel, "phone", "ph", { phone });
        if (live.twilio) {
          // A new number can't text US phones until it's registered (A2P 10DLC, or toll-free
          // verification), which takes days; a call reading the code works from the start.
          try {
            if (via === "call") await placeCall(config.twilio.phoneNumber!, phone, codeCallTwiml(bot.name, code));
            else await sendSms(config.twilio.phoneNumber!, phone, `Your ${bot.name} verification code is ${code}. Reply STOP to opt out.`);
          } catch (err) {
            await refundCodeLimit(db, owner, phone, meta.ip);
            throw err;
          }
          return { ok: true, data: { sent: true, via } };
        }
        if (demoMode) return { ok: true, data: { sent: false, demoCode: code, via } };
        return { ok: false, error: "Texts and calls are coming soon." };
      }
      if (action === "verify") {
        const used = await useCode(db, channel, "phone", "ph", String(payload.code ?? ""));
        if (!used.ok) return { ok: false, error: used.error };
        const phone = String((used.row.data as { phone?: string }).phone);
        // Verifying a phone covers both texting and calls.
        for (const k of ["sms", "voice"] as const) {
          const ch = k === kind ? channel : (await db.select().from(schema.channels).where(and(eq(schema.channels.botId, bot.id), eq(schema.channels.kind, k))).limit(1))[0];
          if (!ch) continue;
          // The other one gets the verified number too, but stays off if the owner turned it off, or
          // if it can't work here yet (texting before the number is registered).
          const status = k !== kind && (ch.status === "disabled" || ch.status === "waitlist" || !channelUsable(CHANNEL_BY_KIND[k], demoMode, live)) ? ch.status : "active";
          await db
            .update(schema.channels)
            .set({ ownerAddress: phone, ownerVerifiedAt: new Date(), status, address: config.twilio.phoneNumber ?? ch.address, config: { ...ch.config, simulated: !live.twilio } })
            .where(eq(schema.channels.id, ch.id));
        }
        return { ok: true, data: { phone, number: config.twilio.phoneNumber ?? null } };
      }
      if (action === "call_me" && kind === "voice") {
        if (!channel.ownerAddress) return { ok: false, error: "Verify your phone first." };
        const res = await deliver(db, bot, "voice", { to: channel.ownerAddress, text: `Just calling to say hi. Call me back at this number anytime.`, toOwner: true }, { owner, channel });
        return res.status === "failed" ? failedDelivery(res, "Call failed") : { ok: true, data: { status: res.status } };
      }
      break;
    }
    case "email": {
      const botAddress = botEmailAddress(bot);
      if (!botAddress) return { ok: false, error: "Email is coming soon." };
      if (action === "send_code") {
        const email = String(payload.email ?? owner.email ?? "").trim().toLowerCase();
        if (!isEmail(email)) return { ok: false, error: "Enter a valid email." };
        const limited = await codeLimit(db, owner, email, live.botEmail, meta.ip);
        if (limited) return limited;
        const code = await saveCode(db, owner, bot, channel, "email", "em", { email });
        if (live.botEmail) {
          try {
            await sendEmailRaw({
              from: botAddress,
              fromName: `${bot.name} (AI assistant)`,
              to: email,
              subject: `Your ${bot.name} code: ${code}`,
              text: `Hi! Enter ${code} in the app to let ${bot.name} email you and read what you forward.\n\nIf you didn't ask for this, ignore it.`,
            });
          } catch (err) {
            await refundCodeLimit(db, owner, email, meta.ip);
            throw err;
          }
          return { ok: true, data: { sent: true, botAddress } };
        }
        if (demoMode) return { ok: true, data: { sent: false, demoCode: code, botAddress } };
        return { ok: false, error: "Email is coming soon." };
      }
      if (action === "verify") {
        const used = await useCode(db, channel, "email", "em", String(payload.code ?? ""));
        if (!used.ok) return { ok: false, error: used.error };
        const email = String((used.row.data as { email?: string }).email);
        await db
          .update(schema.channels)
          .set({ ownerAddress: email, ownerVerifiedAt: new Date(), status: "active", address: botAddress, config: { ...channel.config, simulated: !live.botEmail } })
          .where(eq(schema.channels.id, channel.id));
        return { ok: true, data: { email, botAddress } };
      }
      break;
    }
    case "slack": {
      if (action === "install") {
        // One click: the shared Build-a-bot app (slack-app.ts).
        if (!live.slackOAuth) return { ok: false, error: "One-click Slack is coming soon. Give it its own Slack app instead." };
        return { ok: true, data: { installUrl: await startSlackInstall(db, owner, bot, channel) } };
      }
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
            return { ok: false, error: err instanceof UnreachableError ? err.message : `Slack didn't accept that token: ${(err as Error).message}` };
          }
        }
        const credentialId = await storeCredential(db, { ownerId: owner.id, kind: "bot_token", provider: "slack", secret: JSON.stringify({ botToken, signingSecret }), label: team });
        if (channel.credentialId) await db.delete(schema.credentials).where(eq(schema.credentials.id, channel.credentialId));
        // Its own app now (not the shared one): the owner proves it's them with "link CODE".
        await db
          .update(schema.channels)
          .set({ credentialId, address: team, status: "pending", ownerAddress: null, ownerVerifiedAt: null, config: { via: "own" }, updatedAt: new Date() })
          .where(eq(schema.channels.id, channel.id));
        const code = await saveCode(db, owner, bot, channel, "slack_owner", "slk");
        return { ok: true, data: { code, instructions: `In Slack, open a DM with ${bot.name} and send: link ${code}` } };
      }
      if (action === "new_code") {
        // Tokens are in, but the owner hasn't sent "link CODE" yet: a fresh code (the old one isn't stored).
        if (!channel.credentialId || channel.ownerAddress) return { ok: false, error: "Paste your Slack app's keys first." };
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
        if (!live.discord && !demoMode) return { ok: false, error: "Discord is coming soon." };
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
