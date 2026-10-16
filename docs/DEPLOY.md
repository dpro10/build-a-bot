# Deploying Build-a-bot

The app is one Next.js project plus a Postgres database. Recommended: **Vercel + Supabase** (or Neon). Every integration is optional; whatever isn't configured stays simulated only when `DEMO_MODE=1`.

## 1. Database

1. Create a Postgres database (Supabase project, Neon, RDS…) and set `DATABASE_URL`.
   - **On Supabase, paste either pooler URL.** The app always uses the transaction pooler (port 6543), which lends a connection per query.
   - Avoid the session pooler on serverless. It allows only as many clients as its pool (15 on the free plan), and every function instance holds its own connections, so it runs out after a few page loads.
   - Migrations run in one transaction under a transaction-level lock, so any pooler works for them.
2. Run migrations once from your machine: `DATABASE_URL=… npm run db:migrate` (the app also migrates on first boot; set `AUTO_MIGRATE=0` to turn that off).
3. Row-level security is enabled on every table with no policies, so Supabase's anon/authenticated API roles can read nothing. Don't add policies unless you mean to expose data.

## 2. Secrets

- `ENCRYPTION_KEY`: `openssl rand -base64 32`. Required in production. It encrypts every stored API key and token. **Never rotate it in place**: existing secrets would become unreadable.
- `CRON_SECRET`: any long random string.
- `APP_URL`: the public URL, e.g. `https://build-a-bot.site` (used for webhooks, OAuth callbacks and email links).

## 3. Vercel

1. Import the repo, framework Next.js, Node 22+.
2. Add the env vars (see `.env.example`). Production should **not** set `DEMO_MODE` (or set it to `0`).
3. **Cron:** `vercel.json` calls `/api/cron/tick` every minute (Vercel sends `Authorization: Bearer $CRON_SECRET`). Per-minute crons need a paid Vercel plan; on Hobby, point any external scheduler (GitHub Actions, cron-job.org, Supabase `pg_cron` + `pg_net`) at `GET {APP_URL}/api/cron/tick` with that header.
4. Domain: add `build-a-bot.site` (DNS is already on Vercel).

**Self-hosting instead:** `npm run build && npm start` on any Node 22 host. The in-process ticker (`src/instrumentation.ts`) runs reminders every 20 s; or run `npm run cron:tick -- --watch` separately and set `DISABLE_INTERNAL_CRON=1`.

## 4. Brains and tools

| What | Env | Notes |
|---|---|---|
| Included open models | `TOKEN_FACTORY_API_KEY` | Nebius Token Factory. If Token Factory renames a model, override with `TF_MODEL_*` without a deploy. |
| Web search & reader | `TAVILY_API_KEY` | 1,000 free credits/month, then $0.008/credit. Searches are metered per plan. |
| Managed app sign-in | `COMPOSIO_API_KEY` | One-click sign-in for about 70 apps (Google, Microsoft, Slack, GitHub, Dropbox, HubSpot, Zoom…). Composio makes each app's auth config on first use. Apps Composio has no OAuth app of its own for (X, Spotify, Shopify, PayPal, Xero…; `src/lib/connectors/composio-auth.ts`) stay "Coming soon" until you register an app with the vendor, add it in Composio and set `COMPOSIO_AUTH_CONFIG_<TOOLKIT>`. **Turn on callback identity verification** (Composio: Settings → General → Configuration, verifier URL `{APP_URL}/api/connectors/composio/verify`): without it, someone could send a person their own sign-in link and attach that person's account to their bot. Consent screens say "Composio"; for launch, register your own Google/Microsoft apps (Google's Gmail scopes need its verification and a CASA assessment). |
| MCP servers needing a pre-registered app | `MCP_OAUTH_CLIENTS` | JSON map of issuer/host → client id/secret, once you register Build-a-bot with that vendor. |
| Meeting notes and voice typing | `NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL` | Both are only in the desktop app, which hears them on the user's computer with NVIDIA Parakeet: no speech-to-text is needed on the server. Until signed downloads are published (this URL), a real server shows both as "Coming soon". |
| Server speech-to-text (optional fallback) | `TRANSCRIBE_PROVIDER=nvidia`, `TRANSCRIBE_BASE_URL`, `TRANSCRIBE_API_KEY` (+ optional `TRANSCRIBE_FALLBACK_*`) | Only for computers where Parakeet can't run, or with Private speech off. NVIDIA's open speech models on our own server (`speech/`): deploy its image as a Nebius Serverless AI endpoint (steps and costs in `speech/README.md`; about $190/month for an 8-vCPU CPU machine), then point these at it. Backup: `TRANSCRIBE_FALLBACK_PROVIDER=together` with a Together AI key (NVIDIA Parakeet, $0.0015/audio minute; Whisper for the languages Parakeet doesn't speak). Groq's Whisper also works (`TRANSCRIBE_PROVIDER=groq`, paid tier). Token Factory has no speech-to-text. |

Own-key (BYOK) and subscription brains need nothing from you.

## 5. Channels

| Channel | Setup |
|---|---|
| **Telegram** | Create a manager bot with @BotFather and turn on Bot Management (Bot Settings). Set `TELEGRAM_MANAGER_BOT_TOKEN`, `TELEGRAM_MANAGER_BOT_USERNAME` and `TELEGRAM_MANAGER_WEBHOOK_SECRET` (required: without it the webhook refuses every update), The server points the manager bot's webhook at itself as soon as those keys are live, and checks it every 30 minutes, so a new domain or secret is picked up. Each owner's own bot gets its webhook automatically. Without a manager bot, owners can still paste a BotFather token. |
| **SMS & calls** | Twilio account + a US/Canada number. `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`. On the number: *A message comes in* → `POST {APP_URL}/api/webhooks/twilio/sms`; *A call comes in* → `POST {APP_URL}/api/webhooks/twilio/voice`. **US texting needs A2P 10DLC (or toll-free) registration before launch.** |
| **Email** | Buy a brand-free domain for bot inboxes (never containing "build-a-bot") and set `BOT_EMAIL_DOMAIN`. Either AgentMail (`AGENTMAIL_API_KEY`, webhook `message.received` → `{APP_URL}/api/webhooks/email/agentmail`, `AGENTMAIL_WEBHOOK_SECRET`) or Resend (`RESEND_API_KEY`, inbound on the domain, webhook `email.received` → `{APP_URL}/api/webhooks/email/resend`, `RESEND_WEBHOOK_SECRET`). Until the domain and one provider's key and webhook secret are all set, the Email channel and "Its own inbox" show as Coming soon. Bots' mail goes out through that provider. `EMAIL_FROM` sends sign-in links, and `RESEND_API_KEY` on its own only does that. |
| **Slack** | **One click (recommended):** create the shared app from `docs/slack-app-manifest.json` (api.slack.com/apps → Create New App → From a manifest; it uses `https://build-a-bot.site`, so change the URLs if `APP_URL` differs). Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET` from Basic Information, redeploy, then in Slack: Event Subscriptions → Retry if the URL isn't verified yet, and Manage Distribution → Activate Public Distribution so other workspaces can add it. Owners then click **Add to Slack**, pick a workspace and click Allow. Each person reaches only their own bot, which answers with its own name and face. Slack must reach `APP_URL` without a redirect. **Without these keys,** each owner makes their bot its own Slack app from a manifest link in the app. |
| **Discord** | Create an application. `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`. Once those are live, set the Interactions Endpoint URL to `{APP_URL}/api/webhooks/discord` (Discord checks it right away). The server registers `/ask` and `/link` by itself, and again every 6 hours; `npm run discord:register` does it on demand. |

## 6. Billing (Stripe)

1. Create two products (Plus, Pro) with monthly and yearly prices; set `STRIPE_PRICE_PLUS_MONTHLY`, `STRIPE_PRICE_PLUS_YEARLY`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY` and `STRIPE_SECRET_KEY`.
2. Webhook → `{APP_URL}/api/webhooks/stripe` with `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`; set `STRIPE_WEBHOOK_SECRET`.
3. Turn on the customer portal (cancel, switch plans, update card).

Until `STRIPE_SECRET_KEY` is set, Plus and Pro say "Coming soon" everywhere (pricing, the home page, Plan & usage) and offer a waitlist (`plan:plus` / `plan:pro` in the admin dashboard's Waitlists). Someone at the Free bot limit is told before the builder's first step.

## 7. Before launch

- [ ] `DEMO_MODE` off in production; `ENCRYPTION_KEY`, `DATABASE_URL`, `CRON_SECRET`, `APP_URL` set.
- [ ] Legal pages reviewed by a lawyer (they're drafts); trademark clearance (see `docs/DECISIONS.md`).
- [ ] Twilio A2P/toll-free registration done; email domain verified (SPF/DKIM/DMARC).
- [ ] Google: Gmail/Drive through Composio's verified app, or your own app with Google's verification (restricted Gmail scopes need a yearly CASA assessment).
- [ ] Support email set (`NEXT_PUBLIC_SUPPORT_EMAIL`); crisis protocol page live (`/safety`).
- [ ] The Bridge needs nothing published. Before each build, `scripts/pack-bridge.mjs` packs `bridge/` into `public/downloads/`, and the app tells owners to run `npx -y {APP_URL}/downloads/build-a-bot-bridge-<version>.tgz`. Don't set `BRIDGE_CLI` in production unless you mean to override that.
- [ ] Re-render avatar pictures if characters change: `npm run avatars`.
- [ ] Meeting notes and voice typing:
  - a lawyer reviews the consent flow and transcript retention;
  - if server speech-to-text is set up as a fallback, check that provider's data-retention and training terms;
  - sign and notarize the desktop app (Apple Developer Program for Mac, a code-signing certificate for Windows) and publish its downloads. See `desktop/README.md`. Then set `NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL` to the download page: until it's set, the site shows the desktop app, and with it meeting notes and voice typing, as "Coming soon".
- [ ] Smoke test: build a bot, chat, approve an action, STOP from a channel, a reminder fires, upgrade with a Stripe test card.
