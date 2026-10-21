/**
 * Runtime configuration and feature flags.
 *
 * Every integration is optional. With a key set it is live; without one, demo mode
 * (DEMO_MODE=1, or any non-production run) simulates it so the whole product can be
 * clicked through end to end. In production without DEMO_MODE, a missing integration
 * shows as "coming soon" instead of being faked.
 */

const v = (name: string) => {
  let value = process.env[name]?.trim() ?? "";
  // A whole .env line pasted as the value (`NAME=value`, maybe quoted): keep just the value.
  if (value.startsWith(`${name}=`)) value = value.slice(name.length + 1).trim();
  if (/^(["']).+\1$/s.test(value)) value = value.slice(1, -1).trim();
  return value !== "" ? value : undefined;
};

export const isProduction = process.env.NODE_ENV === "production";

export const demoMode = v("DEMO_MODE") === "1" || v("DEMO_MODE") === "true" || (!isProduction && v("DEMO_MODE") !== "0");

/**
 * Scripted speech, in demo mode: with no speech-to-text, a recording "hears" sample lines (voice
 * typing) or a sample meeting (meeting notes). On by default only outside production (running it
 * yourself, tests); a production build needs DEMO_SPEECH=1, which only tests set. A site people
 * use never makes up speech, which would put words in their mouths: without speech-to-text,
 * recordings aren't turned into text there, and the app says so.
 */
export const demoSpeech = demoMode && (v("DEMO_SPEECH") === "1" || v("DEMO_SPEECH") === "true" || (!isProduction && v("DEMO_SPEECH") !== "0"));

export function appUrl(): string {
  const explicit = v("APP_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = v("VERCEL_PROJECT_PRODUCTION_URL") ?? v("VERCEL_URL");
  if (vercel) return `https://${vercel}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export const config = {
  tokenFactory: {
    apiKey: v("TOKEN_FACTORY_API_KEY"),
    baseUrl: v("TOKEN_FACTORY_BASE_URL") ?? "https://api.tokenfactory.nebius.com/v1",
  },
  tavily: { apiKey: v("TAVILY_API_KEY") },
  /**
   * The Library (src/lib/library): files are kept in a private Vercel Blob store. Without it, a
   * local run keeps them on disk under DATA_DIR (demo mode); a real server shows "Coming soon".
   * Photos and scanned pages are read by a vision model on Token Factory (TF_MODEL_VISION).
   */
  library: { blobToken: v("BLOB_READ_WRITE_TOKEN"), visionModel: v("TF_MODEL_VISION") },
  /** Web actions (beta): Browser Use Cloud drives a cloud browser for reading sites and filling forms. */
  browserUse: {
    apiKey: v("BROWSER_USE_API_KEY"),
    baseUrl: v("BROWSER_USE_BASE_URL") ?? "https://api.browser-use.com/api/v2",
    /** Agent model (Browser Use's `llm`); unset = their default. */
    model: v("BROWSER_USE_MODEL"),
    /** Proxy country for the cloud browser ("us", "de"...; "off" = none); unset = their default (US). */
    proxyCountry: v("BROWSER_USE_PROXY_COUNTRY"),
  },
  composio: { apiKey: v("COMPOSIO_API_KEY"), baseUrl: v("COMPOSIO_BASE_URL") ?? "https://backend.composio.dev" },
  /**
   * Meeting notes: speech-to-text for recorded meetings. Any OpenAI-compatible
   * POST /audio/transcriptions endpoint works; TRANSCRIBE_PROVIDER picks sensible defaults.
   */
  transcribe: {
    provider: v("TRANSCRIBE_PROVIDER"),
    apiKey: v("TRANSCRIBE_API_KEY"),
    baseUrl: v("TRANSCRIBE_BASE_URL"),
    model: v("TRANSCRIBE_MODEL"),
    /** Used automatically when the main provider is rate-limited or down. */
    fallback: {
      provider: v("TRANSCRIBE_FALLBACK_PROVIDER"),
      apiKey: v("TRANSCRIBE_FALLBACK_API_KEY"),
      baseUrl: v("TRANSCRIBE_FALLBACK_BASE_URL"),
      model: v("TRANSCRIBE_FALLBACK_MODEL"),
    },
  },
  /**
   * Voice typing's cleanup (fillers out, punctuation, corrections). DICTATION_POLISH picks where it
   * runs: "groq" (with the speech-to-text key, so the words go to one provider), "included" (our
   * Token Factory models) or "off". Unset: Groq when speech-to-text runs on Groq, else included.
   */
  dictation: {
    polish: v("DICTATION_POLISH"),
    model: v("DICTATION_POLISH_MODEL"),
  },
  telegram: {
    /** Our "manager" bot that creates each user's own bot (Managed Bots, Bot API 9.6). */
    managerToken: v("TELEGRAM_MANAGER_BOT_TOKEN"),
    /** Without the "@" (it goes into t.me links), even if it was pasted with one. */
    managerUsername: v("TELEGRAM_MANAGER_BOT_USERNAME")?.replace(/^@/, "") || undefined,
    /** Telegram sends it with every update to the manager bot; without it, updates are refused. */
    managerWebhookSecret: v("TELEGRAM_MANAGER_WEBHOOK_SECRET"),
  },
  twilio: {
    accountSid: v("TWILIO_ACCOUNT_SID"),
    authToken: v("TWILIO_AUTH_TOKEN"),
    /** Shared number for SMS + voice until a bot gets its own (Pro). E.164. */
    phoneNumber: v("TWILIO_PHONE_NUMBER"),
    voice: v("TWILIO_VOICE") ?? "Polly.Joanna-Neural",
    /**
     * Hand calls to the voice server over Twilio Media Streams (<Connect><Stream>). Trial accounts
     * can't stream, so it's off until TWILIO_MEDIA_STREAMS=1 (after upgrading the account).
     */
    mediaStreams: v("TWILIO_MEDIA_STREAMS") === "1" || v("TWILIO_MEDIA_STREAMS") === "true",
    /**
     * The number may text US phones: it's registered (A2P 10DLC for a local number, toll-free
     * verification for a toll-free one). Until then carriers drop its texts, so texting stays off
     * and phone codes come by call.
     */
    texting: v("TWILIO_TEXTING") === "1" || v("TWILIO_TEXTING") === "true",
  },
  email: {
    agentmailKey: v("AGENTMAIL_API_KEY"),
    agentmailWebhookSecret: v("AGENTMAIL_WEBHOOK_SECRET"),
    resendKey: v("RESEND_API_KEY"),
    resendWebhookSecret: v("RESEND_WEBHOOK_SECRET"),
    /** Domain for bots' own inboxes. Brand-free on purpose (rename insurance). No domain, no bot inboxes. */
    botDomain: v("BOT_EMAIL_DOMAIN"),
    from: v("EMAIL_FROM") ?? "Build-a-bot <hello@build-a-bot.site>",
    inboundSecret: v("EMAIL_INBOUND_SECRET"),
  },
  slack: {
    clientId: v("SLACK_CLIENT_ID"),
    clientSecret: v("SLACK_CLIENT_SECRET"),
    signingSecret: v("SLACK_SIGNING_SECRET"),
  },
  discord: {
    applicationId: v("DISCORD_APPLICATION_ID"),
    publicKey: v("DISCORD_PUBLIC_KEY"),
    botToken: v("DISCORD_BOT_TOKEN"),
  },
  /** Stripe, for adding credit (one-time payments: no products or prices to set up). */
  stripe: {
    secretKey: v("STRIPE_SECRET_KEY"),
    webhookSecret: v("STRIPE_WEBHOOK_SECRET"),
  },
  /**
   * The desktop app (desktop/: meeting notes and voice typing): where to get it. The site's own
   * download page, which offers the latest signed builds, unless another address is set.
   */
  desktop: { downloadUrl: v("NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL") ?? "/download" },
  /**
   * The voice server (voice/): calls with a bot, by phone or in the browser, heard and spoken by
   * NVIDIA's open speech models. VOICE_SERVER_URL is its https:// address; the secret is shared
   * with it (it signs its requests to /api/calls/*, the app signs call tokens for it).
   */
  voice: { serverUrl: v("VOICE_SERVER_URL")?.replace(/\/$/, ""), secret: v("VOICE_SERVER_SECRET") },
  cronSecret: v("CRON_SECRET"),
};

/**
 * Who runs bots' own inboxes: the provider takes in mail sent to BOT_EMAIL_DOMAIN (by
 * webhook) and sends the bots' mail. It needs the domain plus the provider's key and
 * webhook secret (docs/DEPLOY.md §5). A Resend key on its own only sends sign-in links.
 */
export function botEmailProvider(
  email: Partial<Pick<typeof config.email, "botDomain" | "agentmailKey" | "agentmailWebhookSecret" | "resendKey" | "resendWebhookSecret">>,
): "resend" | "agentmail" | null {
  if (!email.botDomain) return null;
  if (email.resendKey && email.resendWebhookSecret) return "resend";
  if (email.agentmailKey && email.agentmailWebhookSecret) return "agentmail";
  return null;
}

/** Which integrations are really wired up (keys present). */
export const live = {
  includedBrain: Boolean(config.tokenFactory.apiKey),
  webSearch: Boolean(config.tavily.apiKey),
  browser: Boolean(config.browserUse.apiKey),
  transcription: Boolean(config.transcribe.apiKey),
  composio: Boolean(config.composio.apiKey),
  telegramManaged: Boolean(config.telegram.managerToken && config.telegram.managerUsername && config.telegram.managerWebhookSecret),
  twilio: Boolean(config.twilio.accountSid && config.twilio.authToken && config.twilio.phoneNumber),
  /** Texts: Twilio, and a number registered to text US phones (TWILIO_TEXTING). */
  twilioTexting: Boolean(config.twilio.accountSid && config.twilio.authToken && config.twilio.phoneNumber && config.twilio.texting),
  /** Sign-in links by email (Resend). */
  email: Boolean(config.email.resendKey),
  /** Bots' own inboxes: the Email channel and the "Its own inbox" built-in. */
  botEmail: botEmailProvider(config.email) !== null,
  slackOAuth: Boolean(config.slack.clientId && config.slack.clientSecret && config.slack.signingSecret),
  discord: Boolean(config.discord.applicationId && config.discord.publicKey && config.discord.botToken),
  stripe: Boolean(config.stripe.secretKey),
  /** Signed downloads of the desktop app are published (demo mode shows how to run it from the repo instead). */
  /** The Library: a private Vercel Blob store for the owner's files. */
  library: Boolean(config.library.blobToken),
  /** Voice calls with bots: the voice server's address and its shared secret (32+ characters). */
  voiceServer: Boolean(config.voice.serverUrl && config.voice.secret && config.voice.secret.length >= 32),
};

/** Integration is usable: live, or simulated because we're in demo mode. */
export function available(key: keyof typeof live): boolean {
  return live[key] || demoMode;
}

/**
 * Credit can be added: with Stripe, or without paying in demo mode. Otherwise adding credit is
 * "Coming soon" (and the starter credit is what there is).
 */
export const creditOpen = available("stripe");
