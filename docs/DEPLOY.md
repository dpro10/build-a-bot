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
| Web search & reader | `TAVILY_API_KEY` | 1,000 free credits/month, then $0.008/credit. Each lookup is paid from the owner's credit at $0.008 (there are no plans). |
| Managed app sign-in | `COMPOSIO_API_KEY` | One-click sign-in for about 70 apps (Google, Microsoft, Slack, GitHub, Dropbox, HubSpot, Zoom…). Composio makes each app's auth config on first use. Apps Composio has no OAuth app of its own for (X, Spotify, Shopify, PayPal, Xero…; `src/lib/connectors/composio-auth.ts`) stay "Coming soon" until you register an app with the vendor, add it in Composio and set `COMPOSIO_AUTH_CONFIG_<TOOLKIT>`. **Turn on callback identity verification** (Composio: Settings → General → Configuration, verifier URL `{APP_URL}/api/connectors/composio/verify`): without it, someone could send a person their own sign-in link and attach that person's account to their bot. Consent screens say "Composio"; for launch, register your own Google/Microsoft apps (Google's Gmail scopes need its verification and a CASA assessment). |
| MCP servers needing a pre-registered app | `MCP_OAUTH_CLIENTS` | JSON map of issuer/host → client id/secret, once you register Build-a-bot with that vendor. |
| Meeting notes and voice typing | `NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL` | Both are only in the desktop app, which hears them on the user's computer with NVIDIA Parakeet: no speech-to-text is needed on the server. Until signed downloads are published (§9) and this is `https://build-a-bot.site/download`, a real server shows both as "Coming soon". |
| Server speech-to-text (optional fallback) | `TRANSCRIBE_PROVIDER=nvidia`, `TRANSCRIBE_BASE_URL`, `TRANSCRIBE_API_KEY` (+ optional `TRANSCRIBE_FALLBACK_*`) | Only for computers where Parakeet can't run, or with Private speech off. NVIDIA's open speech models on our own server (`speech/`): deploy its image as a Nebius Serverless AI endpoint (steps and costs in `speech/README.md`; about $190/month for an 8-vCPU CPU machine), then point these at it. Backup: `TRANSCRIBE_FALLBACK_PROVIDER=together` with a Together AI key (NVIDIA Parakeet, $0.0015/audio minute; Whisper for the languages Parakeet doesn't speak). Groq's Whisper also works (`TRANSCRIBE_PROVIDER=groq`, paid tier). Token Factory has no speech-to-text. |

Own-key (BYOK) and subscription brains need nothing from you.

## 5. Channels

| Channel | Setup |
|---|---|
| **Telegram** | Create a manager bot with @BotFather and turn on Bot Management (Bot Settings). Set `TELEGRAM_MANAGER_BOT_TOKEN`, `TELEGRAM_MANAGER_BOT_USERNAME` and `TELEGRAM_MANAGER_WEBHOOK_SECRET` (required: without it the webhook refuses every update), The server points the manager bot's webhook at itself as soon as those keys are live, and checks it every 30 minutes, so a new domain or secret is picked up. Each owner's own bot gets its webhook automatically. Without a manager bot, owners can still paste a BotFather token. |
| **SMS & calls** | Twilio account + a US/Canada number. `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`. On the number: *A message comes in* → `POST {APP_URL}/api/webhooks/twilio/sms`; *A call comes in* → `POST {APP_URL}/api/webhooks/twilio/voice`; *Call status changes* → `POST {APP_URL}/api/webhooks/twilio/voice/status` (that's how a call's minutes are counted and charged). Calls are heard and spoken by Twilio until the voice server takes them (§8). Owners link their phone with a code read out in a call (or texted, once texting is on). **A new number can't text US phones until it's registered** (A2P 10DLC, which needs a paid account, or toll-free verification; either takes days). Until then texting stays off: Text messages shows as coming soon, phone codes come by call, and incoming texts get no reply. Once it's registered, set `TWILIO_TEXTING=1`. |
| **Email** | Buy a brand-free domain for bot inboxes (never containing "build-a-bot") and set `BOT_EMAIL_DOMAIN`. Either AgentMail (`AGENTMAIL_API_KEY`, webhook `message.received` → `{APP_URL}/api/webhooks/email/agentmail`, `AGENTMAIL_WEBHOOK_SECRET`) or Resend (`RESEND_API_KEY`, inbound on the domain, webhook `email.received` → `{APP_URL}/api/webhooks/email/resend`, `RESEND_WEBHOOK_SECRET`). Until the domain and one provider's key and webhook secret are all set, the Email channel and "Its own inbox" show as Coming soon. Bots' mail goes out through that provider. `EMAIL_FROM` sends sign-in links, and `RESEND_API_KEY` on its own only does that. |
| **Slack** | **One click (recommended):** create the shared app from `docs/slack-app-manifest.json` (api.slack.com/apps → Create New App → From a manifest; it uses `https://build-a-bot.site`, so change the URLs if `APP_URL` differs). Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET` from Basic Information, redeploy, then in Slack: Event Subscriptions → Retry if the URL isn't verified yet, and Manage Distribution → Activate Public Distribution so other workspaces can add it. Owners then click **Add to Slack**, pick a workspace and click Allow. Each person reaches only their own bot, which answers with its own name and face. Slack must reach `APP_URL` without a redirect. **Without these keys,** each owner makes their bot its own Slack app from a manifest link in the app. |
| **Discord** | Create an application. `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`. Once those are live, set the Interactions Endpoint URL to `{APP_URL}/api/webhooks/discord` (Discord checks it right away). The server registers `/ask` and `/link` by itself, and again every 6 hours; `npm run discord:register` does it on demand. |

## 6. Credit (Stripe)

There are no plans: people pay for what they use, at cost, from prepaid credit (`docs/DECISIONS.md`). Every account starts with `STARTER_CREDIT_USD` of credit (default 1; 0 turns it off). Adding credit is a one-time Stripe Checkout payment of $5, $10 or $20, with Stripe's fee on top: no products, prices or customer portal to set up.

1. Set `STRIPE_SECRET_KEY` (a restricted key needs write access to Checkout Sessions and Customers).
2. Add a webhook endpoint → `{APP_URL}/api/webhooks/stripe` with the events `checkout.session.completed` and `checkout.session.async_payment_succeeded`; set `STRIPE_WEBHOOK_SECRET` to its signing secret.
3. Try it with a test card (4242 4242 4242 4242) in test mode: Credit & usage → Add $5 → the balance goes up by $5.00 once the webhook lands (a few seconds).

Until `STRIPE_SECRET_KEY` is set, Credit & usage says adding credit is coming soon, and the starter credit is what there is (in demo mode, credit is added for free instead, up to $20 an account).

Refunds are by hand, when someone asks. Refund the credit they haven't used from the Stripe dashboard (Stripe keeps its fee). Then record it so their balance matches, in Supabase's SQL editor (here, $4.50 for the account `usr_…`):

```sql
insert into credits (id, user_id, kind, amount_micros, note)
values ('cr_refund_' || gen_random_uuid(), 'usr_…', 'refund', -4500000, 'refunded in Stripe');
```

A paid Checkout for an account deleted before Stripe confirmed it adds no credit; the server log says `[billing] paid Checkout session … refund it in Stripe`.

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
  - signed, one-click downloads of the desktop app (§9): Apple Developer Program for Mac, Azure Artifact Signing for Windows, the repository public, then `NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL=https://build-a-bot.site/download`. Until it's set, the site shows the desktop app, and with it meeting notes and voice typing, as "Coming soon".
- [ ] Calls (§8): the voice server is up, the Call button works on `APP_URL`, and with Twilio upgraded and `TWILIO_MEDIA_STREAMS=1`, a phone call is answered by the bot's voice.
- [ ] Smoke test: build a bot, chat, approve an action, STOP from a channel, a reminder fires, add credit with a Stripe test card, call the bot.

## 8. Calls (the voice server)

Talking with a bot by phone, or with the **Call** button in the app, goes through the voice server (`voice/`, see its README): NVIDIA Parakeet hears, NVIDIA Magpie speaks, Nemotron 3.5 Lightning holds the conversation, and the bot's own agent does the work. It runs on one Google Compute Engine VM that `.github/workflows/voice.yml` deploys. Without it nothing breaks: the Call button stays hidden, and phone calls use the simpler line (§5), where Twilio hears and speaks.

**What it costs:** the default `c3-highcpu-4` VM (4 Intel Sapphire Rapids vCPUs, 8 GB) is about $0.17 an hour, $124 a month, plus about $7 a month for its disk and IP address. The Google Cloud free trial's $300 (good for 90 days from sign-up) covers about two months of it running all the time. A stopped VM costs only the $7 (below).

**Is it fast enough?** On 4 vCPUs Magpie makes speech at about real time, which is just enough: the server measures its own speed at start, and the deploy log prints it (`speechRate`, also in `/health`). If it says it's under 1, sentences wait a moment before playing so they don't stutter, and answers start later; an 8-vCPU `c3-highcpu-8` (about $0.34 an hour) is about twice as fast. It takes one call at a time (`VOICE_MAX_CALLS`); a second phone call gets the simpler line, a second Call button says the line is busy.

**1. Google Cloud** (5 minutes, in the console with the free-trial account):
1. Create a project, e.g. `build-a-bot-voice`, with the free trial as its billing account. A separate project keeps the voice server apart from anything else in the account.
2. Open Cloud Shell (the `>_` button at the top right) and make the key GitHub deploys with (put your project ID in `P`):
   ```bash
   P=build-a-bot-voice
   gcloud iam service-accounts create voice-deploy --project $P
   for r in compute.admin artifactregistry.admin iam.serviceAccountUser serviceusage.serviceUsageAdmin; do
     gcloud projects add-iam-policy-binding $P --member serviceAccount:voice-deploy@$P.iam.gserviceaccount.com --role roles/$r --condition None
   done
   gcloud iam service-accounts keys create key.json --iam-account voice-deploy@$P.iam.gserviceaccount.com
   cat key.json; rm key.json
   ```
   If gcloud asks to enable an API, say yes. Copy what `cat` printed for the next step. (If key creation is blocked by an organization policy, the workflow can sign in with Workload Identity Federation instead.)

**2. GitHub** (the repository → Settings → Secrets and variables → Actions):
- **Secrets:**
  - `GCP_SA_KEY`: the key from Cloud Shell, all of it.
  - `VOICE_SERVER_SECRET`: a new random string of 32 or more characters (`openssl rand -hex 32` in Cloud Shell). Vercel gets the same one.
  - `TOKEN_FACTORY_API_KEY`: the same Token Factory key as Vercel's.
- **Variables:** `GCP_PROJECT`, the project ID. Optional: `GCP_ZONE` (default `us-central1-a`), `VOICE_MACHINE_TYPE` (default `c3-highcpu-4`), `APP_URL` (default `https://build-a-bot.site`), `VOICE_HOST` (default `<ip>.sslip.io`, a hostname that needs no DNS).

Then Actions → **Voice server** → Run workflow on `main`. The first run takes about half an hour (NVIDIA's engine is built from source twice, and every test runs, including whole calls on the real models). The **deploy** job makes everything in the project (an image registry, a static IP, an HTTPS firewall rule, the VM with Caddy for the certificate) and ends with the server's address: `Voice server is up at https://34-…sslip.io`. After that, each push to `main` that changes `voice/` ships itself in a few minutes; phone calls use the simpler line while the VM restarts.

**3. Vercel:** set `VOICE_SERVER_URL` to that address and `VOICE_SERVER_SECRET` to the same secret, then redeploy. Each bot's header now has a **Call** button (it works on `APP_URL`'s address; the server refuses calls started from other sites).

**Is it working?** After each deploy of the voice server or of the site, the **Live call** workflow (`.github/workflows/live-call.yml`) makes a real call through the site: a browser makes a bot, presses **Call**, waits for the greeting and asks a question out loud. It passes when Parakeet hears the question, a spoken answer comes back and the call is recorded, then it deletes the bot. The run's summary shows what was said and how long the answer took. Run it any time from Actions → **Live call** → Run workflow. Until Vercel has the two settings, it says calls aren't set up and passes.

**4. Phone calls on the voice server:**
1. Twilio as in §5, with all three webhooks on the number. Then Voice → Settings → **Geo permissions**: turn on United States/Canada. New accounts start with outgoing calls off, and without it the bot can't call anyone, phone codes included (Twilio answers "Account not authorized to call").
2. Upgrade the account (Twilio Console → Upgrade: a card and a $20 starting balance). Twilio's free trial (as of 2026) can't run the phone line:
   - its texts and outgoing calls must use Twilio's own templates, so the bot can't send an owner their phone code;
   - only verified numbers can call in, and callers hear a trial notice and must press a key first;
   - `<Stream>` is blocked, so calls would never reach the voice server, and each call allows about ten back-and-forths;
   - it ends after 30 days.
3. Set `TWILIO_MEDIA_STREAMS=1` in Vercel and redeploy. Calls to the number are then answered by the voice server. If it's down or busy, the call goes on on the simpler line by itself.

Who's who on a call: the owner on the app's Call button, or from their own number when the carrier vouches for it (STIR/SHAKEN attestation A); the owner's number without that is unverified until they say or type their phone PIN (Account → Phone PIN); anyone else gets the bot's message-taking manner and nothing done for them.

**Day to day:**
- Stop it when nobody needs it, and start it again: `gcloud compute instances stop build-a-bot-voice --zone us-central1-a --project <P>`, then `… start …`. Meanwhile phone calls use the simpler line, and the Call button says the voice line is down. A deploy leaves a stopped VM stopped.
- Its log (one JSON line per event, never what anyone said): `gcloud compute ssh build-a-bot-voice --zone us-central1-a --project <P> -- sudo journalctl -u voice -u caddy -n 200`, or Logs Explorer in the console.
- A different machine: set `VOICE_MACHINE_TYPE` and run the workflow; the VM is replaced (it keeps nothing). C3, C4 and N4 get the AVX-512 + AMX build, other types the AVX2 one. The free trial allows 8 vCPUs running at once across the account, and no GPUs.
- A nicer address: point an A record (e.g. `voice.build-a-bot.site`) at the static IP `build-a-bot-voice-ip`, set the variable `VOICE_HOST` to it, run the workflow, and update `VOICE_SERVER_URL`.

## 9. The desktop app: signed, one-click downloads

Meeting notes and voice typing live in the desktop app, so the site shows them as "Coming soon" until it can be downloaded. When this section is done, **build-a-bot.site/download** offers it for Mac and Windows. Each installs in one go (the Mac app moves itself into Applications; the Windows installer asks nothing and needs no admin) and keeps itself up to date. CI builds, signs and publishes it (`desktop/README.md` › Packaging and signing); what it needs from you is two accounts that check who you are, and their keys.

**1. Make the repository public**, with a license. The downloads and updates are its releases, and nobody else can download a private repository's. (The hackathon needs it public anyway; see `docs/HACKATHON.md`.)

**2. Mac: the Apple Developer Program** ($99 a year).
1. Enroll at [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/) as an individual, with an Apple ID that has two-factor sign-in. Approval usually takes a day or two.
2. The certificate. On a Mac: Keychain Access → menu **Keychain Access** → **Certificate Assistant** → **Request a Certificate From a Certificate Authority…** → your email and name, **Saved to disk**. Then at [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates/list) → **+** → **Developer ID Application** → upload that request → download the certificate and double-click it.
3. Export it: Keychain Access → **My Certificates** → *Developer ID Application: your name (team ID)* → right-click → **Export…** → a `.p12` with a password. Then `base64 -i Certificates.p12 | pbcopy` and paste it as the secret **`MAC_CERTIFICATE_P12`**; the password is **`MAC_CERTIFICATE_PASSWORD`**.
4. The notarization key: [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Users and Access** → **Integrations** → **App Store Connect API** → **Team Keys** → **+**, access **Developer** → download the `.p8` (only possible once). Its text (`pbcopy < AuthKey_….p8`) is **`APPLE_API_KEY_P8`**, its Key ID **`APPLE_API_KEY_ID`**, and the Issuer ID at the top of that page **`APPLE_API_ISSUER`**.
5. Or, once the certificate is in your Keychain and you have the `.p8`, let a script do 3 and 4: in Terminal, from the repository, `bash desktop/scripts/set-mac-signing-secrets.sh <issuer ID> [path/to/AuthKey_….p8]`. It checks the key with Apple, exports only the Developer ID certificate (macOS asks you to allow it), checks the file, and saves all five secrets in GitHub with `gh`, printing nothing secret.

**3. Windows: Azure Artifact Signing** (formerly Trusted Signing; $9.99 a month; individuals in the US and Canada).
1. [portal.azure.com](https://portal.azure.com) → **Create a resource** → **Artifact Signing** (or Trusted Signing) → a resource group, an account name, a region (East US), the **Basic** plan. Note the account's **URI** (like `https://eus.codesigning.azure.net/`). If Azure asks, register the `Microsoft.CodeSigning` resource provider on the subscription.
2. On the account → **Access control (IAM)** → give yourself the **Identity Verifier** role (*Artifact Signing* or *Trusted Signing Identity Verifier*).
3. **Identity validation** → **New** → **Public** → **Individual** → your legal name and address, then the identity check it sends you (a government ID and a selfie). It takes Microsoft a few business days.
4. Once it says **Completed**: **Certificate profiles** → **Create** → **Public Trust** → a name → that validation.
5. An identity for CI: **Microsoft Entra ID** → **App registrations** → **New registration** → copy its **Application (client) ID** and **Directory (tenant) ID** → **Certificates & secrets** → **New client secret** → copy the value.
6. Back on the signing account → **Access control (IAM)** → **Add role assignment** → **Certificate Profile Signer** (*Artifact Signing* or *Trusted Signing Certificate Profile Signer*) → that app registration.
7. Secrets: **`AZURE_TENANT_ID`**, **`AZURE_CLIENT_ID`**, **`AZURE_CLIENT_SECRET`**. Variables (the **Variables** tab, they aren't secret): **`AZURE_SIGNING_ENDPOINT`** (the account URI), **`AZURE_SIGNING_ACCOUNT`** (the account name), **`AZURE_SIGNING_PROFILE`** (the profile name), **`AZURE_SIGNING_PUBLISHER`** (your name exactly as validated: it's the name on the certificate, and installed apps check updates against it).

Secrets and variables go in GitHub: the repository's **Settings → Secrets and variables → Actions**.

SmartScreen can still warn on a signed app's first downloads, until it has built up a reputation. Signing removes "Unknown publisher" and Smart App Control's block.

**4. Publish:** the next push to `main` that changes `desktop/`, or Actions → **Desktop app** → Run workflow, builds both apps, signs whichever has its keys, and publishes them as the release `desktop-v0.1.<run>`. The run's **Check it** (Mac: notarized Developer ID) and **Check the signature** (Windows) steps show it worked.

**5. Turn it on:** in Vercel, set `NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL=https://build-a-bot.site/download` for Production and Preview, and redeploy. The site then offers the desktop app, and with it meeting notes and voice typing.
