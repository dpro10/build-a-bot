/**
 * Runtime configuration and feature flags.
 *
 * Every integration is optional. With a key set it is live; without one, demo mode
 * (DEMO_MODE=1, or any non-production run) simulates it so the whole product can be
 * clicked through end to end. In production without DEMO_MODE, a missing integration
 * shows as "coming soon" instead of being faked.
 */

const v = (name: string) => {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
};

export const isProduction = process.env.NODE_ENV === "production";

export const demoMode = v("DEMO_MODE") === "1" || v("DEMO_MODE") === "true" || (!isProduction && v("DEMO_MODE") !== "0");

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
  telegram: {
    /** Our "manager" bot that creates each user's own bot (Managed Bots, Bot API 9.6). */
    managerToken: v("TELEGRAM_MANAGER_BOT_TOKEN"),
    managerUsername: v("TELEGRAM_MANAGER_BOT_USERNAME"),
  },
  twilio: {
    accountSid: v("TWILIO_ACCOUNT_SID"),
    authToken: v("TWILIO_AUTH_TOKEN"),
    /** Shared number for SMS + voice until a bot gets its own (Pro). E.164. */
    phoneNumber: v("TWILIO_PHONE_NUMBER"),
    voice: v("TWILIO_VOICE") ?? "Polly.Joanna-Neural",
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
  stripe: {
    secretKey: v("STRIPE_SECRET_KEY"),
    webhookSecret: v("STRIPE_WEBHOOK_SECRET"),
    prices: {
      plus_monthly: v("STRIPE_PRICE_PLUS_MONTHLY"),
      plus_yearly: v("STRIPE_PRICE_PLUS_YEARLY"),
      pro_monthly: v("STRIPE_PRICE_PRO_MONTHLY"),
      pro_yearly: v("STRIPE_PRICE_PRO_YEARLY"),
    },
  },
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
  telegramManaged: Boolean(config.telegram.managerToken && config.telegram.managerUsername),
  twilio: Boolean(config.twilio.accountSid && config.twilio.authToken && config.twilio.phoneNumber),
  /** Sign-in links by email (Resend). */
  email: Boolean(config.email.resendKey),
  /** Bots' own inboxes: the Email channel and the "Its own inbox" built-in. */
  botEmail: botEmailProvider(config.email) !== null,
  slackOAuth: Boolean(config.slack.clientId && config.slack.clientSecret && config.slack.signingSecret),
  discord: Boolean(config.discord.applicationId && config.discord.publicKey && config.discord.botToken),
  stripe: Boolean(config.stripe.secretKey),
};

/** Integration is usable: live, or simulated because we're in demo mode. */
export function available(key: keyof typeof live): boolean {
  return live[key] || demoMode;
}
