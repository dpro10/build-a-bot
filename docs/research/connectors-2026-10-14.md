# Connector catalog research (2026-10-14)

Backs `src/lib/connectors/catalog.ts`, which lists 180 connectors on top of `BUILTIN_CONNECTORS`. This is research only; nothing here is a decision by Diego.

**How it was checked (all on 2026-10-14):**
- Vendor sites mostly don't resolve from this sandbox.
- MCP URLs and auth come from three kinds of source:
  - the vendor's own GitHub README, read in full;
  - a web search restricted to the vendor's own domain;
  - the official MCP Registry (`registry.modelcontextprotocol.io`), queried live.
- Search-snippet sources are marked "(snippet)". Re-check them on a normal network before relying on exact wording.
- The sibling note `mcp-and-brains-2026-10-14.md` §3 covers many of the same servers, and the two agree.
- Two details below came from that note: Atlassian needs each org admin to allow a new client's domain, and ClickUp may only let allowlisted clients sign in.

## How the catalog uses this

- **`via` order:** an MCP server that a brand-new client can sign up to goes first. That means dynamic or metadata-document registration, or no auth at all.
- **Composio goes first** when the vendor's MCP needs any of these, with the MCP entry kept second:
  - a pre-registered app;
  - an allowlisted client or redirect;
  - an org admin's approval;
  - a waitlist.
- **Counts:**
  - 40 connectors try MCP first.
  - 20 try Composio first and fall back to MCP.
  - 68 use Composio only.
  - 4 use `custom_mcp`.
- **`verified: true`** means the URL and auth method were confirmed from a vendor source above. One entry is `verified: false` (trivago, below).

## Verified MCP endpoints

Auth is what the catalog sets. "Who can sign in" is the reason for the `via` order.

| Connector(s) | URL | Auth | Who can sign in / notes | Source |
|---|---|---|---|---|
| GitHub | `https://api.githubcopilot.com/mcp/` | bearer (PAT; token page `github.com/settings/personal-access-tokens/new`) | No self-registration for OAuth; a PAT works for anyone | github.com/github/github-mcp-server |
| Linear | `https://mcp.linear.app/mcp` | oauth | Dynamic registration; API key as Bearer also accepted; `/mcp/readonly` exists | linear.app/docs/mcp (snippet) |
| Notion | `https://mcp.notion.com/mcp` | oauth | OAuth only; `/sse` fallback | developers.notion.com/guides/mcp/get-started-with-mcp (snippet); github.com/makenotion/notion-mcp-server |
| Jira, Confluence, Bitbucket (Loom later) | `https://mcp.atlassian.com/v2/mcp` | oauth | OAuth 2.1, but the org admin must allow the client domain. Bitbucket only works if the workspace is linked to an org. `/v1/sse` ended 2026-06-30 | github.com/atlassian/atlassian-mcp-server |
| Asana | `https://mcp.asana.com/v2/mcp` | oauth | Needs a pre-registered app (no dynamic registration). V1 `/sse` shut down 2026-05-11 | developers.asana.com/docs/connecting-mcp-clients-to-asanas-v2-server (snippet) |
| Sentry | `https://mcp.sentry.dev/mcp` | oauth | OAuth; a Sentry token also works | github.com/getsentry/sentry-mcp |
| Stripe | `https://mcp.stripe.com` | oauth | OAuth | github.com/stripe/ai |
| PayPal | `https://mcp.paypal.com/mcp` | oauth | Registry marks the `Authorization` header as required. Docs describe browser login. Self-registration unconfirmed | registry `com.paypal.mcp/mcp`; developer.paypal.com/ai-tools/mcp-server (snippet) |
| Square | `https://mcp.squareup.com/mcp` | oauth | Beta; Square allowlists OAuth clients. The repo README still lists `/sse` | developer.squareup.com/docs/mcp (snippet); github.com/square/square-mcp-server |
| Intercom | `https://mcp.intercom.com/mcp` (EU `https://mcp.eu.intercom.com/mcp`) | oauth | Self-registers, but non-localhost redirect URIs must be allowlisted by Intercom | developers.intercom.com/docs/guides/mcp (snippet) |
| HubSpot | `https://mcp.hubspot.com` | oauth | Needs a HubSpot "MCP auth app" (pre-registered) with PKCE | developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server (snippet) |
| Webflow | `https://mcp.webflow.com/mcp` | oauth | OAuth with a site picker (repo README still shows `/sse`) | developers.webflow.com/mcp/reference/getting-started (snippet) |
| Wix | `https://mcp.wix.com/mcp` | oauth | OAuth | dev.wix.com/docs/api-reference/articles/ai-tools/wix-mcp/about-the-wix-mcp (snippet) |
| Canva | `https://mcp.canva.com/mcp` | oauth | Waitlist for metadata-document clients. Developer Portal apps use `https://api.canva.com/connect/v1/mcp` | canva.dev/docs/apps/mcp (snippet) |
| Box | `https://mcp.box.com` | oauth | An admin-created client ID and secret; no self-registration | developer.box.com/guides/box-mcp/setup (snippet) |
| Vercel | `https://mcp.vercel.com` | oauth | Only clients Vercel has reviewed and approved | vercel.com/docs/agent-resources/vercel-mcp (snippet) |
| Supabase | `https://mcp.supabase.com/mcp` | oauth | OAuth 2.1. Takes `?project_ref=…&read_only=true&features=…` | github.com/supabase-community/supabase-mcp |
| Cloudflare | `https://mcp.cloudflare.com/mcp` | oauth | Recommended "API" server; also `docs.mcp.cloudflare.com/mcp` and others. `/sse` is an alias | github.com/cloudflare/mcp-server-cloudflare |
| Hugging Face | `https://huggingface.co/mcp?login` (OAuth), `https://huggingface.co/mcp` (Bearer HF token, `huggingface.co/settings/tokens`) | oauth + bearer | Both documented | github.com/huggingface/hf-mcp-server |
| Zapier | `https://mcp.zapier.com/api/v1/connect` | oauth | OAuth by default; a connection token as Bearer is the alternative. Streamable HTTP only | docs.zapier.com/mcp/get-started/connect (snippet) |
| monday.com | `https://mcp.monday.com/mcp` | oauth | OAuth (Bearer API token also shown) | github.com/mondaycom/mcp |
| ClickUp | `https://mcp.clickup.com/mcp` | oauth | OAuth only (no API keys); reported `invalid_client` errors and allowlisting | help.clickup.com, developer.clickup.com (snippet) |
| Airtable | `https://mcp.airtable.com/mcp` | oauth | OAuth or PAT | support.airtable.com/articles/9897799762; airtable.com/developers/agents/mcp/getting-started (snippet) |
| Context7 | `https://mcp.context7.com/mcp` | none | Optional API key (README: Bearer) for higher limits | github.com/upstash/context7 |
| DeepWiki | `https://mcp.deepwiki.com/mcp` | none | Public repos only | docs.devin.ai/work-with-devin/deepwiki-mcp (snippet) |
| Exa | `https://mcp.exa.ai/mcp?login` (OAuth), `https://mcp.exa.ai/mcp` (keyless, rate-limited) | oauth + none | Bearer or `x-api-key` also accepted | github.com/exa-labs/exa-mcp-server |
| Firecrawl | `https://mcp.firecrawl.dev/v2/mcp-oauth` (OAuth), `https://mcp.firecrawl.dev/v2/mcp` (Bearer key, `firecrawl.dev/app/api-keys`) | oauth + bearer | Keyless tier only covers scrape, search and parse | github.com/firecrawl/firecrawl-mcp-server |
| Apify | `https://mcp.apify.com` | oauth | OAuth or a Bearer Apify token | github.com/apify/apify-mcp-server |
| PostHog | `https://mcp.posthog.com/mcp` | oauth | OAuth; a personal API key with the "MCP Server" preset as Bearer is the fallback | posthog.com/docs/model-context-protocol/faq (snippet) |
| PagerDuty | `https://mcp.pagerduty.com/mcp` (EU `mcp.eu.pagerduty.com`) | oauth | OAuth with a static client (pre-registered) or an API token. Local server deprecated 2026-09-04 | developer.pagerduty.com MCP endpoint; support.pagerduty.com/main/docs/pagerduty-mcp-server (snippet) |
| Figma | `https://mcp.figma.com/mcp` | oauth | Allowlisted clients. Starter, View and Collab seats get 6 tool calls a month | github.com/figma/mcp-server-guide |
| Todoist | `https://ai.todoist.net/mcp` | oauth | OAuth | github.com/Doist/todoist-ai |
| Gmail, Google Drive, Google Calendar | `https://gmailmcp.googleapis.com/mcp/v1`, `https://drivemcp.googleapis.com/mcp/v1`, `https://calendarmcp.googleapis.com/mcp/v1` | oauth | Developer preview. Needs our own Google Cloud OAuth client with `gmailmcp`/`drivemcp`/`calendarmcp` enabled. Docs, Sheets, Slides, People and Chat servers exist, but their URLs weren't confirmed | developers.google.com/workspace/guides/configure-mcp-servers (snippet) |
| Slack | `https://mcp.slack.com/mcp` | oauth | Confidential OAuth with our own Slack app; no self-registration. The app must be Marketplace-listed or internal | docs.slack.dev/ai/slack-mcp-server (snippet) |
| Dropbox | `https://mcp.dropbox.com/mcp` | oauth | Self-registration only for a trusted client list (Claude, ChatGPT, Codex, Cursor) | help.dropbox.com/integrations/connect-dropbox-mcp-server (snippet) |
| Calendly | `https://mcp.calendly.com` | oauth | Dynamic registration; no personal tokens | developer.calendly.com/calendly-mcp-server (snippet) |
| Klaviyo | `https://mcp.klaviyo.com/mcp` | oauth | Dynamic registration; Owner, Admin or Manager role | developers.klaviyo.com/en/docs/connect_to_the_klaviyo_mcp_server (snippet) |
| Attio | `https://mcp.attio.com/mcp` | oauth | Dynamic registration | docs.attio.com/mcp/overview; attio.com/engineering/blog/building-the-attio-mcp-server (snippet) |
| Mixpanel | `https://mcp.mixpanel.com/mcp` (EU `mcp-eu.`, IN `mcp-in.`) | oauth | OAuth + PKCE | docs.mixpanel.com/docs/mcp (snippet) |
| Datadog | `https://mcp.datadoghq.com/v1/mcp` (US1 only) | oauth | OAuth; API and app key headers as a fallback | docs.datadoghq.com/mcp_server/setup (snippet) |
| Netlify | `https://netlify-mcp.netlify.app/mcp` | oauth | OAuth | docs.netlify.com/build/build-with-ai/netlify-mcp-server (snippet) |
| GitLab | `https://gitlab.com/api/v4/mcp` | oauth | Dynamic registration; beta since GitLab 18.6 | docs.gitlab.com/user/model_context_protocol/mcp_server (snippet) |
| WordPress.com | `https://public-api.wordpress.com/wpcom/v2/mcp/v1` | oauth | OAuth 2.1 + PKCE with a register endpoint. Paid plans, or the first 30 days of a free site | developer.wordpress.com/docs/mcp (snippet) |
| Granola | `https://mcp.granola.ai/mcp` | oauth | Dynamic registration; free plan covers 30 days of notes, without transcripts | docs.granola.ai/help-center/sharing/integrations/mcp (snippet) |
| Fireflies.ai | `https://api.fireflies.ai/mcp` | oauth | OAuth; an API key as Bearer is the alternative | docs.fireflies.ai/getting-started/mcp-configuration (snippet) |
| Evernote | `https://mcp.evernote.com/mcp` | oauth | Dynamic registration. Evernote's REST API keys are reportedly on hold, so MCP is the way in | dev.evernote.com/mcp/clients/any (snippet) |
| TickTick | `https://mcp.ticktick.com` | oauth | OAuth, or an API token from the web app's settings | help.ticktick.com/articles/7438129581631995904 (snippet) |
| Readwise | `https://mcp2.readwise.io/mcp` | oauth | Covers highlights and Reader. The older `highlights-mcp.readwise.io` doesn't cover Reader | docs.readwise.io/tools/mcp (snippet) |
| Raindrop.io | `https://api.raindrop.io/rest/v2/ai/mcp` | oauth | OAuth 2.1; on the free plan since 2026-06-02 | help.raindrop.io/integrations/mcp (snippet) |
| ElevenLabs | `https://api.elevenlabs.io/v1/mcp` | oauth | OAuth; EU, IN and SG residency hosts exist | elevenlabs.io/docs/eleven-agents/operate/hosted-mcp; changelog 2026-08-22 (snippet) |
| Make | `https://mcp.make.com` | oauth | OAuth recommended; a token-in-URL variant also exists | developers.make.com/mcp-server (snippet) |
| Miro | `https://mcp.miro.com` | oauth | OAuth 2.1 + dynamic registration; beta | developers.miro.com/docs/miro-mcp (snippet) |
| Xero | `https://api.xero.com/mcp/v1` | oauth | Needs our own Xero app (PKCE); Core plan and above | devblog.xero.com/the-xero-remote-mcp-is-now-generally-available (snippet) |
| Shopify stores | `https://catalog.shopify.com/api/ucp/mcp` | none | Anonymous tier (lower limits). Token tier uses Dev Dashboard client credentials | shopify.dev/docs/agents/catalog; shopify.dev/docs/agents/profiles/auth-and-rate-limiting (snippet) |
| Kiwi.com | `https://mcp.kiwi.com` | none | Open; returns booking links | kiwi.com/en/pages/mcp; media.kiwi.com (snippet) |

**Unverified entry:** trivago, `https://mcp.trivago.com/mcp`, auth none, `verified: false`.
- trivago's own docs (`mcp.trivago.com/docs`) confirm a keyless hosted server, and the registry lists `com.trivago.mcp/mcp`.
- The exact `/mcp` path comes only from directories and Composio's `trivago_mcp`.

**Verified, but not used in the catalog:**
- Neon (`https://mcp.neon.tech/mcp`): oauth, or a Bearer key.
- Render (`https://mcp.render.com/mcp`): Bearer key.
- Postman (`https://mcp.postman.com/minimal`, `/mcp`): dynamic registration.
- Mercury (`https://mcp.mercury.com/mcp`): dynamic registration; read-only by default.
- Ramp (`https://mcp.ramp.com/mcp`): redirect allowlist.
- Amplitude (`https://mcp.amplitude.com/mcp`).
- Jotform (`https://mcp.jotform.com`).

These were trimmed to keep the catalog at 180. Each is easy to add back.

## Official servers found but deliberately not wired up

- **Browserbase** `https://mcp.browserbase.com/mcp`: the API key goes in a `browserbaseApiKey` query parameter, which `ConnectorVia` can't hold per user. Composio only.
- **Replicate** `https://mcp.replicate.com/sse`: SSE only. Composio only.
- **Zoom:** per-product URLs (`mcp.zoom.us/mcp/{meeting,chat,…}/streamable` per the sibling note) and manual client registration. Composio only.
- **Microsoft 365** (Agent 365 / Work IQ): tenant-scoped URLs with admin consent, work accounts only. Every Microsoft connector uses Composio.
- **Plaid:** `api.dashboard.plaid.com/mcp` is developer-dashboard diagnostics, not a user's bank data. Plaid is "soon".
- **Instacart:** `https://mcp.instacart.com/mcp` (dev: `mcp.dev.instacart.tools/mcp`) authenticates with *our* developer API key. Its tools create shopping-list and recipe pages. "Soon" until we hold a key.
- **Pipedream:** `remote.mcp.pipedream.net` needs developer client credentials plus `x-pd-*` headers. "Soon".
- **Home Assistant** (`<instance>/api/mcp`) and **n8n** (`<instance>/mcp-server/http`): per-user hosts, so `custom_mcp`, "beta".
- **Shopify Storefront MCP** (`{shop}.myshopify.com/api/mcp`): per shop. The global catalog is used instead.
- **QuickBooks:** Intuit ships a Claude connector, but I found no published URL. **Zendesk:** no first-party server found. Both Composio only.
- **Strava** has a personal-use MCP connector, but its API policy forbids commercial or third-party AI use (below).

## Composio toolkits

**Source:**
- `ComposioHQ/composio`, branch `next`, file `ts/packages/cli/src/generated/toolkit-slugs.ts`. It holds 1,603 slugs and was last refreshed 2026-10-12 by "chore(cli): refresh baked toolkit slugs (#4815)".
- Cross-checked against `docs/public/data/toolkits-list.json` in the same repo.
- `composio.dev` and `docs.composio.dev` don't resolve here.
- The check script confirms every toolkit in the catalog is in that list.

**Toolkits used (123):**
airtable, apify, asana, attio, basecamp, bestbuy, bitbucket, blackboard, box, browserbase_tool, buffer, cal, calendly, canva, canvas, clickup, cloudflare, coinbase, confluence, context7_mcp, datadog, deepwiki_mcp, discord, discordbot, dropbox, elevenlabs, exa, excel, exist, facebook, figma, firecrawl, fireflies, freshdesk, gamma, github, gitlab, gmail, google_analytics, google_chat, google_classroom, google_maps, googleads, googlecalendar, googlecontacts, googledocs, googledrive, googleforms, googlemeet, googlephotos, googlesheets, googleslides, googletasks, granola_mcp, hackernews, hubspot, hugging_face, instagram, intercom, jira, klaviyo, linear, linkedin, mailchimp, make, metaads, microsoft_teams, microsoft_todo, miro, mixpanel, monday, netlify_mcp, notion, one_drive, onenote, openai, outlook, pagerduty, paypal, perplexityai, pinterest, pipedrive, posthog, quickbooks, raindrop, readwise_reader, reddit, replicate, salesforce, semanticscholar, sentry, share_point, shopify, slack, soundcloud, splitwise, spotify, square, stripe, supabase, survey_monkey, telegram, ticketmaster, ticktick, tiktok, todoist, trello, tripadvisor, trivago_mcp, twitter, typeform, vercel, webflow, wise, wix, wolfram_alpha_api, wordpress_com, xero, yelp, ynab, youtube, zendesk, zoom.

**Slugs that are easy to get wrong:**
`one_drive`, `share_point`, `excel`, `microsoft_teams`, `microsoft_todo`, `google_maps`, `google_analytics`, `google_classroom`, `google_chat`, `googleforms`, `googleads`, `survey_monkey`, `perplexityai`, `hugging_face`, `cal` (Cal.com), `canvas` (Canvas LMS), `wordpress_com`, `readwise_reader`, `wolfram_alpha_api`, `bestbuy`, `metaads`, `hackernews`.

**`*_mcp` toolkits:**
- Composio-hosted wrappers of a vendor's MCP server (for example `granola_mcp`, `context7_mcp`).
- I skipped `alltrails_mcp`, `viator_mcp` and `taskrabbit_mcp`, because the registry only shows unofficial community servers for those brands.

**No Composio toolkit exists for:**
- Health: Strava, Fitbit, Oura, Withings, Whoop, Garmin.
- Notes: Evernote (it has an official MCP), Obsidian.
- Automation: Zapier, n8n, IFTTT, Pipedream.
- Shopping and travel: Amazon, eBay, Etsy, Instacart, DoorDash, Uber, Airbnb, Expedia, Booking.com.
- Reading and social: Feedly, Medium, Substack, Bluesky, Mastodon, Threads.
- Smart home: Philips Hue, SmartThings, Home Assistant.
- Other: Front, Smartsheet, Microsoft Word, Microsoft PowerPoint.

**Shared toolkits:**
- `outlook` serves both Outlook and Outlook Calendar.
- `one_drive` serves both OneDrive and Microsoft Word.
- `src/lib/connectors/composio.ts` loads tools per toolkit, so each of those pairs gets the same tools.

## simple-icons 16.35.0 gaps

**Not in the package, so the catalog uses a letter tile:**
- Microsoft: Outlook, Teams, OneDrive, Word, Excel, SharePoint, OneNote, To Do.
- Slack, LinkedIn, Canva, OpenAI, Salesforce.
- Amazon (and Alexa).
- Pipedrive, Attio, monday.com, Klaviyo, Freshdesk.
- Plaid, Splitwise, YNAB.
- Exa, Firecrawl, Apify, Browserbase, Context7, DeepWiki.
- Granola, Fireflies, Gamma, Exist, Oura, Withings, Readwise, Raindrop.io, Blackboard.
- Best Buy, Kiwi.com, OpenTable, Pipedream.
- Google Contacts, Google Flights (Google Flights uses the `google` glyph instead).

Also missing: Whoop, MyFitnessPal, Garmin Connect (only `garmin` exists), DocuSign, Zoho Mail/CRM (only `zoho`), Ahrefs, Eventbrite, Twilio, Heroku, Mercury, Ramp.

**Slug gotchas:**
- `kit` is kit.co, not ConvertKit's Kit.
- `canvas` is Canvas LMS (sourced from Instructure).
- Hacker News uses `ycombinator`.
- Wolfram|Alpha uses `wolfram`.
- Apple Notes, Reminders and Health use `apple`.
- X is `x`; `twitter` no longer exists.

**Letter tiles with no known brand color:**
- Granola, Fireflies, Context7, DeepWiki, Gamma, Pipedrive, Freshdesk, YNAB, Exist.
- Withings, Klaviyo, Exa, Firecrawl, Apify, Browserbase, Blackboard, Readwise, Raindrop.io, Pipedream.
- I found no official hex for these, so `BrandTile` falls back to `#64748B`.

## Facts behind "soon", "beta" and the notes

**Checked this session:**
- **Strava:** the 2026 API Policy §5.3 bars using API data in any AI application, including putting it in a context window. Its MCP connector is personal-use only. Sources: strava.com/legal/api_policy, press.strava.com (snippet).
- **Google Fit:** the APIs are supported until the end of 2026, with no new sign-ups since 2024-05-01. Omitted from the catalog. Source: developers.google.com/fit (snippet).
- **Fitbit:** the legacy Web API loses support 2026-09-30 and switches off 2026-10-30; Google says to move to the Google Health API. Source: developers.google.com/health/migration (snippet).
- **Pocket:** shut down 2025-07-08. Omitted. Source: support.mozilla.org/kb/future-of-pocket (snippet).
- **Spotify:** 2026 Development Mode needs a Premium owner, caps each client ID at 5 users and drops some endpoints; extended-quota apps are unaffected. Marked "beta". Source: developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide (snippet).
- **Google Photos:** since 2025-03-31 the Library API only sees media the app created, and user picks go through the Picker API. Marked "beta". Source: developers.google.com/photos/support/updates (snippet).
- **Google Keep:** the API is built for enterprise admins and needs domain-wide delegation. Source: developers.google.com/workspace/keep/api/guides (snippet).
- **Medium:** no new integration tokens, and the API is unsupported. Source: help.medium.com/hc/en-us/articles/213480228 (snippet).
- **Monzo:** the developer API covers your own account only. Source: community.monzo.com (snippet; community posts, not an official page).
- **WhatsApp:** the repo README says WhatsApp bans general-purpose assistants in the US.

**From prior knowledge, not re-checked this session:**
- Venmo, Revolut personal accounts, Substack, Goodreads, Khan Academy, Duolingo, Signal, iMessage: no public API.
- Things, Apple Notes, Apple Reminders: no cloud API.
- Apple Health: data stays on the device.
- Amazon, DoorDash, Uber, Airbnb, Booking.com, Expedia, OpenTable: partner-only or no API.
- Alexa: no control API.
- Google Home: the APIs are mobile-only.
- YouTube Music: no official API.
- LinkedIn: apps can post and read your profile, but not your feed or messages.
- Instagram: business and creator accounts only. Facebook: Pages only.

## Runtime gaps to know about (no type changes made)

1. **Registration needs per vendor.** Twenty connectors put Composio first because their MCP needs our own app, an allowlist or a waitlist:
   - Gmail, Calendar and Drive (Google);
   - Slack, Dropbox, Box, Asana, HubSpot, Xero, PagerDuty;
   - Vercel, Figma, ClickUp, Square, Intercom;
   - Canva, PayPal;
   - Jira, Confluence and Bitbucket (Atlassian).

   An optional field on the mcp `via`, such as `registration?: "dynamic" | "preregistered" | "allowlist" | "waitlist"`, would let the runtime skip those entries until we hold credentials.
2. **One toolkit or server, several connectors.** Tools load per Composio toolkit or MCP server, and each maps to the connector's first capability with the same effect. That causes three problems:
   - **Outlook Calendar** exposes Outlook mail tools. A mail-sending tool would fall under its `invite_people` permission.
   - **Microsoft Word** exposes all of OneDrive.
   - **Atlassian's MCP**, used as a fallback, exposes Jira and Confluence tools under any of those connectors. This is why Loom is "soon".

   An optional `tools?: string[]` (or a slug prefix) on `ConnectorVia` would fix all three.
3. **Regions.** Intercom, Mixpanel, PagerDuty, Datadog and ElevenLabs have EU or other regional hosts. The catalog uses the US or global URL.
4. **Capability ids** match `demo-tools.ts` where it names them:
   - email: `read_email`, `draft_email`, `send_email`;
   - calendar: `read_events`, `create_event`;
   - GitHub: `read_repos`, `create_issue`, `comment`;
   - files: `read_files`, `share_files`.
