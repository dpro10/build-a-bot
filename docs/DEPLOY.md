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
| Managed app sign-in | `COMPOSIO_API_KEY` | Without it, only apps with an open MCP server (and custom MCP URLs) can connect for real. |
| MCP servers needing a pre-registered app | `MCP_OAUTH_CLIENTS` | JSON map of issuer/host → client id/secret, once you register Build-a-bot with that vendor. |
| Meeting notes (speech-to-text) | `TRANSCRIBE_API_KEY` (+ `TRANSCRIBE_PROVIDER`, optional `TRANSCRIBE_FALLBACK_*`) | Groq's Whisper large-v3 turbo by default (~$0.04/audio hour). **Use Groq's paid tier**: the free tier allows only 7,200 audio-seconds an hour per organization. Together AI is the suggested fallback. Token Factory has no speech-to-text. |

Own-key (BYOK) and subscription brains need nothing from you.

## 5. Channels

| Channel | Setup |
|---|---|
| **Telegram** | Create a manager bot with @BotFather and turn on Bot Management (Bot Settings). Set `TELEGRAM_MANAGER_BOT_TOKEN`, `TELEGRAM_MANAGER_BOT_USERNAME` and `TELEGRAM_MANAGER_WEBHOOK_SECRET` (required: without it the webhook refuses every update), then point its webhook at us: `curl "https://api.telegram.org/bot$TOKEN/setWebhook?url=$APP_URL/api/webhooks/telegram/manager&secret_token=$SECRET"`. Each owner's own bot gets its webhook automatically. Without a manager bot, owners can still paste a BotFather token. |
| **SMS & calls** | Twilio account + a US/Canada number. `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`. On the number: *A message comes in* → `POST {APP_URL}/api/webhooks/twilio/sms`; *A call comes in* → `POST {APP_URL}/api/webhooks/twilio/voice`. **US texting needs A2P 10DLC (or toll-free) registration before launch.** |
| **Email** | Buy a brand-free domain for bot inboxes (never containing "build-a-bot") and set `BOT_EMAIL_DOMAIN`. Either AgentMail (`AGENTMAIL_API_KEY`, webhook `message.received` → `{APP_URL}/api/webhooks/email/agentmail`, `AGENTMAIL_WEBHOOK_SECRET`) or Resend (`RESEND_API_KEY`, inbound on the domain, webhook `email.received` → `{APP_URL}/api/webhooks/email/resend`, `RESEND_WEBHOOK_SECRET`). `EMAIL_FROM` sends sign-in links. |
| **Slack** | Nothing global: each owner creates their bot's Slack app from a manifest link in the app (events and interactivity URLs are filled in). |
| **Discord** | Create an application. `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`. Interactions Endpoint URL → `{APP_URL}/api/webhooks/discord`. Then `npm run discord:register` to add `/ask` and `/link`. |

## 6. Billing (Stripe)

1. Create two products (Plus, Pro) with monthly and yearly prices; set `STRIPE_PRICE_PLUS_MONTHLY`, `STRIPE_PRICE_PLUS_YEARLY`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY` and `STRIPE_SECRET_KEY`.
2. Webhook → `{APP_URL}/api/webhooks/stripe` with `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`; set `STRIPE_WEBHOOK_SECRET`.
3. Turn on the customer portal (cancel, switch plans, update card).

## 7. Before launch

- [ ] `DEMO_MODE` off in production; `ENCRYPTION_KEY`, `DATABASE_URL`, `CRON_SECRET`, `APP_URL` set.
- [ ] Legal pages reviewed by a lawyer (they're drafts); trademark clearance (see `docs/DECISIONS.md`).
- [ ] Twilio A2P/toll-free registration done; email domain verified (SPF/DKIM/DMARC).
- [ ] Google: Gmail/Drive through Composio's verified app, or your own app with Google's verification (restricted Gmail scopes need a yearly CASA assessment).
- [ ] Support email set (`NEXT_PUBLIC_SUPPORT_EMAIL`); crisis protocol page live (`/safety`).
- [ ] Publish the Bridge so `npx build-a-bot-bridge` works: `cd bridge && npm publish` (until then: `node bridge/bab-bridge.mjs pair CODE --server $APP_URL`).
- [ ] Re-render avatar pictures if characters change: `npm run avatars`.
- [ ] Meeting notes:
  - a lawyer reviews the consent flow and transcript retention;
  - check the speech-to-text provider's data-retention and training terms;
  - sign and notarize the desktop app (Apple Developer Program for Mac, a code-signing certificate for Windows) and publish its downloads. See `desktop/README.md`.
- [ ] Smoke test: build a bot, chat, approve an action, STOP from a channel, a reminder fires, upgrade with a Stripe test card.
