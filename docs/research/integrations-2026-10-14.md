# Integrations research: code-ready notes (2026-10-14)

Scope: the nine integrations Build-a-bot needs (brain, search, channels, email, payments, tools). Written for whoever implements them. Nothing here is a decision by Diego.

**How this was checked (read this first).** The sandbox could not open web pages directly: WebFetch failed with DNS errors for every host, and the container's own network blocks most vendors. So every claim comes from one of these, best first:
1. **Primary artifacts read directly.** These were official docs repos cloned from GitHub (discord/discord-api-docs, ComposioHQ/composio docs, nebius/token-factory-cookbook, the stripe-node CHANGELOG and wiki) and official SDK source or type definitions from npm or GitHub (twilio-node 6.2.0, @grammyjs/types 5.0.0, which mirrors the Bot API docs, the TDLib `td_api.tl` schema, @slack/web-api 8.2.0, bolt-js, agentmail 0.5.45, resend 6.32.1, postmark 5.1.0, stripe 23.0.0, @composio/core 0.23.0 and @composio/client 2.0.0-rc.11, @tavily/core 0.7.14, @ai-sdk/openai-compatible 3.0.68). The Token Factory model list comes from a live capture of `GET /v1/models?verbose=true` made on 2026-10-05, committed as evidence in a hackathon repo (github.com/aiambo08/nebiusxnvidia_hackathon, PR #1).
2. **Catalogs:** models.dev (commit 2026-10-13) and LiteLLM's price table, both checked against item 1.
3. **WebSearch summaries** of official pages, used mainly for prices. These are marked *(secondary)*.

Anything else is marked **UNVERIFIED**. The "date checked" is 2026-10-14 unless noted.

---

## 0. The most important facts and surprises

1. **Token Factory:** the default base URL `https://api.tokenfactory.nebius.com/v1/` serves every model. On 2026-10-05, `/v1/models` listed 25 models.
   - `nvidia/Nemotron-3_5-Lightning` costs $0.06/$0.24 per million tokens, with a 1,048,576-token context.
   - It is served from **eu-north1 (Finland)**; Super and Ultra are served from us-central1. Expect extra latency from the US, which matters for voice.
2. **Nemotron thinks by default.** A live test on 2026-10-05 showed the cost:
   - Thinking on: Nano used all 1,200 output tokens on reasoning and returned empty content after 16 to 18 seconds.
   - Thinking off: about 160 tokens in about 2.5 seconds.
   - Turn thinking off with `chat_template_kwargs: {"enable_thinking": false}` (verified on Nano and Super) or `reasoning_effort: "none"` (verified on Lightning and Ultra).
3. **Token Factory dropped image generation.** FLUX was turned off on 2026-04-13. It has no speech models. It does have embeddings: `Qwen/Qwen3-Embedding-8B` at $0.01 per million tokens.
4. **Llama 3.3 70B on Token Factory was deprecated on 2026-08-31** (Nebius's August 2026 deprecation notice, *secondary*). Nebius names Nemotron 3.5 Lightning as the replacement. Token Factory does not reroute requests for deprecated model IDs, and it wasn't in the 2026-10-05 `/v1/models` list.
5. **Telegram one-tap creation works.**
   - The link `https://t.me/newbot/{manager}/{suggested_username}?name={name}` opens a confirmation dialog.
   - After the user confirms, the manager bot gets a `managed_bot` update and calls `getManagedBotToken(user_id)`.
   - The new bot can be locked to its owner with `setManagedBotAccessSettings`.
   - `sendMessageDraft` streams a reply while it is generated.
6. **Stripe:** use stripe@23.0.0 with API version **`2026-09-30.endive`**.
   - `payment_method_types` was **removed** from Checkout Session create; use `allowed_payment_method_types` or dynamic payment methods.
   - Node 20 or later is required.
   - From v22, call `new Stripe()` (it is a real class) and stop using callbacks.
7. **Slack: rate limits for apps outside the Marketplace.**
   - Apps outside the Slack Marketplace get 1 call a minute (15 objects per call) for `conversations.history` and `conversations.replies`. This hit existing installs on 2026-03-03.
   - "Internal customer-built" apps are exempt. **Idea:** each user creates their own app from our manifest URL (one click). This exemption reasoning for such apps is UNVERIFIED.
8. **Discord: HTTP covers commands and buttons only.** Plain DMs to a bot still need the Gateway WebSocket; no webhook event delivers DM messages.
9. **Twilio voice on Vercel:** a `<Gather input="speech">` webhook loop works on serverless functions. ConversationRelay ($0.07 a minute plus voice minutes) needs a WebSocket server. Vercel's WebSocket support has been in public beta since 2026-06-22, and connections close when the function hits its maximum duration.
10. **Twilio SMS needs registration first:** A2P 10DLC or toll-free verification. Toll-free verification has required a business registration number (EIN) since 2026-02-17; sole proprietors are exempt.
11. **Resend can receive email now.** It sends an `email.received` webhook with metadata only, then you fetch the body with `GET /emails/receiving/{id}`. Any address on a receiving (sub)domain lands there, so a single brand-neutral domain can give every bot an address at no per-inbox cost.
12. **Composio:**
    - The current API is **`/api/v3.1/...`** with an `x-api-key` header.
    - Manual tool execution needs a toolkit `version`; the SDK throws on `latest` unless you pass a skip flag.
    - Composio has no managed OAuth for **twitter, spotify or shopify**. Twitter's was removed on 2026-02-12.

---

## 1. Nebius Token Factory (brain)

**Endpoint and auth.** Verified from the cookbook, models.dev and a live run on 2026-10-05.

```
Base URL: https://api.tokenfactory.nebius.com/v1/   (global; served all regions in the 2026-10-05 live test)
Regional: https://api.tokenfactory.us-central1.nebius.com/v1/   (cookbook's "recommended endpoint" for Nemotron Ultra)
Auth:     Authorization: Bearer <key>          (cookbook env var name: NEBIUS_API_KEY)
Routes:   POST /chat/completions · POST /embeddings · GET /models · GET /models?verbose=true (prices, context, regions, features)
Public catalog (no key): https://tokenfactory.nebius.com/api/public/models_info · https://tokenfactory.nebius.com/model-catalog.md
```

**Models.** These are the exact `model` IDs from `GET /v1/models?verbose=true`, captured live on 2026-10-05. Prices are dollars per million tokens, input/output. Model IDs are case-sensitive.

| Model ID | In / Out | Context | Features (API) | Region | Reasoning, and how to control it |
|---|---|---|---|---|---|
| `nvidia/Nemotron-3_5-Lightning` | 0.06 / 0.24 | 1,048,576 | tools, reasoning | eu-north1 | On by default. `reasoning_effort` none/high (none = off, verified live 2026-08-29 by models.dev) |
| `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | 0.06 / 0.24 | 262,144 | tools, reasoning | eu-north1 | On by default. `chat_template_kwargs.enable_thinking=false` (verified live 2026-10-05). Cookbook says "not currently featured" and models.dev dropped it 2026-09-02: **likely being retired**, so prefer Lightning |
| `nvidia/nemotron-3-super-120b-a12b` | 0.30 / 0.90 | 262,144 | tools, reasoning | us-central1 | On by default. `enable_thinking=false` verified live 2026-10-05 |
| `nvidia/Nemotron-3-Ultra-550b-a55b` | 1.00 / 3.00 | 1,048,576 | tools, reasoning | us-central1 | On by default. `reasoning_effort` none/high |
| `openai/gpt-oss-120b` | 0.15 / 0.60 | 131,072 | tools, json, structured, reasoning | eu-north1 | `reasoning_effort` low/medium/high (can't turn off) |
| `Qwen/Qwen3-235B-A22B-Instruct-2507` | 0.20 / 0.60 | 262,144 | tools, json, structured | eu-north1 | Non-reasoning |
| `Qwen/Qwen3-30B-A3B-Instruct-2507` | 0.10 / 0.30 | 262,144 | tools, json, structured | eu-north1 | Non-reasoning (cheap, fast) |
| `Qwen/Qwen3.5-397B-A17B` | 0.60 / 3.60 | 262,144 | tools, reasoning | us-central1 | Toggle (`enable_thinking`) |
| `Qwen/Qwen3.8-27B` | 0.45 / 3.00 | 262,144 | tools, reasoning; image input in catalog, but rejected live | us-central1 | `reasoning_effort` none/low/medium/xhigh (none = off) |
| `deepseek-ai/DeepSeek-V4-Flash-0731` | 0.14 / 0.28 | 1,024,000 | tools, json, structured, reasoning | us-central1 | `reasoning_effort` none/low/high/max |
| `deepseek-ai/DeepSeek-V4.1-Flash` | 0.30 / 1.20 | 1,048,000 | **none listed** (test tools before use) | us-north1 | none/low/high/max |
| `deepseek-ai/DeepSeek-V4-Pro` | 1.75 / 3.50 | 1,048,576 | tools, json, structured, reasoning | uk-south1 | none/low/high/max; default is non-thinking |
| `deepseek-ai/DeepSeek-V4-Pro-0813` | 1.32 / 3.96 | 979,000 | tools, reasoning | us-north1 | none/low/high/max |
| `moonshotai/Kimi-K3` | 3.00 / 15.00 | 1,024,000 | tools, reasoning; image input | eu-west2 | none/low/medium/high/max; **output capped at about 8,000 tokens** (models.dev) |
| `moonshotai/Kimi-K2.7-Code` | 0.95 / 4.00 | 262,144 | tools, reasoning | us-central1 | Output about 8,000 tokens |
| `moonshotai/Kimi-K2.6` | 0.95 / 4.00 | 262,144 | tools, reasoning; image input | us-central1 | |
| `zai-org/GLM-5.3` | 1.40 / 4.40 | 1,024,000 | tools, reasoning | us-north1 | low/high/max; **can't turn off** |
| `zai-org/GLM-5.3-Flash` | 0.15 / 0.50 | 1,024,000 | tools, reasoning; image input | us-north1 | low/high/max; can't turn off |
| `zai-org/GLM-5.2` / `zai-org/GLM-5.1` | 1.40 / 4.40 | 1,048,576 / 202,752 | tools, reasoning | uk-south1 / eu-north1 | low/medium/high |
| `MiniMaxAI/MiniMax-M3` | 0.30 / 1.20 | 1,048,576 | tools, reasoning | us-central1 | |
| `NousResearch/Hermes-4-405B` | 1.00 / 3.00 | 131,072 | tools, json, structured, reasoning | eu-north1 | |
| `google/gemma-3-27b-it` | 0.10 / 0.30 | 110,000 | tools | eu-north1 | Non-reasoning |
| `openbmb/MiniCPM-V-4_5` | 0.658 / 1.11 | 32,000 | json (no tools); vision | eu-north1 | Rejects `reasoning_effort` (cookbook) |
| `Qwen/Qwen3-Embedding-8B` | 0.01 / – | 40,960 | embeddings | eu-north1 | |

- **Not on Token Factory (2026-10-05):**
  - Any Llama: Llama-3.3-70B was deprecated on 2026-08-31 with Lightning as the replacement, and a `-fast` variant was shut down on 2026-04-13.
  - gpt-oss-20b, Mistral and Gemma 4. Older LiteLLM rows for these are stale.
- **Deprecation notices:** docs.tokenfactory.nebius.com publishes them (March, June and August 2026). A June batch removed DeepSeek-V3.2, Kimi-K2.5, GLM-5 and several `-fast` models on 2026-06-22. Read `/v1/models` daily and alert when a configured ID disappears.

**Reasoning output and controls.**
- **Where the reasoning goes:**
  - The thinking text comes back in `message.reasoning_content` and, when streaming, in `delta.reasoning_content`.
  - Kimi uses `reasoning` instead, per the cookbook's server code.
  - When Nemotron Nano runs out of `max_tokens` mid-thought, `content` is `null` and the partial text is in `reasoning` (nebius/token-factory-cookbook issue #74).
  - Read both: `delta.reasoning_content ?? delta.reasoning`.
- **Thinking counts against `max_tokens`.** With thinking on, give at least 4k to 16k tokens. With it off, 1k to 2k is plenty for chat.
- **How to switch it off:**
  - Option A (host-documented): `"reasoning_effort": "none"`. Accepted values differ by model; see the table.
  - Option B (chat template): `"chat_template_kwargs": {"enable_thinking": false}`. DeepSeek-style templates use `{"thinking": false}`.
  - The cookbook sends both and retries without them if it gets a 400 that mentions `reasoning_effort`, `chat_template_kwargs` or `thinking`. MiniCPM is one model that rejects them.
  - `/no_think` in the system prompt is the NVIDIA convention for older Nemotron Nano v2 and Llama-Nemotron models. It is **UNVERIFIED** for Nemotron 3.x on Token Factory; don't rely on it.
- **Usage in streams:** `stream_options: {"include_usage": true}` is supported; Nebius's own cookbook sends it (fun/nebius-realtime-webcam/server.js). The usage arrives in the final chunk with `choices: []`.
- **Compatibility notes from the cookbook's pi and Zed recipes:**
  - Use the `system` role, not `developer`.
  - `max_tokens` is safest. The Zed recipe says `max_completion_tokens` is also accepted.
  - There is a stateless Responses-compatible surface, but stick to Chat Completions.
- **Streaming tool calls:** every chat model above reports `tools`, and the API is the standard OpenAI-compatible one. Streamed `delta.tool_calls` behaviour is **UNVERIFIED** model by model. Test Lightning, Super and Qwen3-30B before launch. Zed's recipe turns `parallel_tool_calls` off.
- **Rate limits:** `per_request_limits` in `/v1/models` shows 1e10 (meaning none are exposed). Real account limits are **UNVERIFIED**.

**Request (thinking off, tools, streaming):**
```http
POST https://api.tokenfactory.nebius.com/v1/chat/completions
Authorization: Bearer $TOKEN_FACTORY_API_KEY
Content-Type: application/json

{ "model": "nvidia/Nemotron-3_5-Lightning",
  "messages": [{"role":"system","content":"You are Ava..."},{"role":"user","content":"What's new with SpaceX?"}],
  "tools": [{"type":"function","function":{"name":"web_search","description":"Search the web",
     "parameters":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}}}],
  "tool_choice": "auto", "stream": true, "stream_options": {"include_usage": true},
  "max_tokens": 2048, "temperature": 0.6,
  "reasoning_effort": "none", "chat_template_kwargs": {"enable_thinking": false} }
```
The stream is standard SSE: `data: {"choices":[{"delta":{"content":"Hi"}}]}`, then deltas carrying `delta.tool_calls[{index,id,function:{name,arguments}}]`, then `data: {"choices":[],"usage":{...}}`, then `data: [DONE]`.

**Vercel AI SDK, if adopted.** The current packages are `ai@7.0.139` and `@ai-sdk/openai-compatible@3.0.68`; their source was read. The provider maps `providerOptions.<name>.reasoningEffort` to `reasoning_effort` and **passes any other keys straight into the request body**. It reads `reasoning_content ?? reasoning`, and adds `stream_options` when `includeUsage` is set.
```ts
const tf = createOpenAICompatible({ name: 'tokenfactory', baseURL: 'https://api.tokenfactory.nebius.com/v1',
  apiKey: process.env.TOKEN_FACTORY_API_KEY, includeUsage: true });
streamText({ model: tf('nvidia/Nemotron-3_5-Lightning'), messages, tools, maxOutputTokens: 2048,
  providerOptions: { tokenfactory: { reasoningEffort: 'none', chat_template_kwargs: { enable_thinking: false } } } });
```

**Other model types:**
- **Embeddings:** `POST /v1/embeddings` with `{"model":"Qwen/Qwen3-Embedding-8B","input":["..."]}`.
- **Images:** text-to-image (`black-forest-labs/flux-schnell`, `flux-dev`) was retired; the API and UI were disabled on 2026-04-13 (deprecation notice, March 2026, *secondary*).
- **Speech (speech-to-text or text-to-speech):** none listed in `/v1/models`. Use Twilio's built-in speech, Deepgram or ElevenLabs.
- **Vision:** Kimi-K3, Kimi-K2.6, Qwen3.8-27B (rejected image input in a live test), GLM-5.3-Flash, DeepSeek-V4.1-Flash and MiniCPM accept image input per the catalog.

**Sources:**
- github.com/nebius/token-factory-cookbook (commit 2026-10-07): models/nemotron/*.md, integrations/pi/README.md, coding/zed/README.md, fun/nebius-realtime-webcam/server.js
- github.com/aiambo08/nebiusxnvidia_hackathon PR #1 (docs/evidence/f0/models-2026-10-05.json, ADR-002)
- github.com/sst/models.dev providers/nebius (2026-10-13)
- BerriAI/litellm model_prices_and_context_window.json
- docs.tokenfactory.nebius.com/august-2026-deprecation-notice and /june-2026-deprecation-notice (*secondary*)
- Checked 2026-10-14.

---

## 2. Tavily (web search)

```
POST https://api.tavily.com/search      POST https://api.tavily.com/extract
Authorization: Bearer tvly-...          Content-Type: application/json
```
- **Auth:** the official SDK (@tavily/core 0.7.14, 2026-10-06) sends a Bearer header plus `X-Client-Source`. Putting `api_key` in the body is the legacy style; whether it still works is **UNVERIFIED**, so use the header.
- **Keyless mode:** with no key, the SDK sends `X-Tavily-Access-Mode: keyless`. It covers search and extract only, under a shared rate cap, and throws `TavilyKeylessLimitError` with `retryAfter`. That's handy for demos and useless for production.
- **Optional headers:** `X-Project-ID` (usage per project), `X-Session-Id` and `X-Human-Id`.

**Search parameters** (from the SDK types; defaults are applied by the server):

| Param | Values |
|---|---|
| `query` | string (required) |
| `search_depth` | `basic` (default) \| `advanced` \| `fast` \| `ultra-fast` |
| `topic` | `general` (default) \| `news` \| `finance` |
| `max_results` | 1–20, default 5 *(secondary)* |
| `include_answer` | `true`/`"basic"` \| `"advanced"` (an LLM-written answer) |
| `include_raw_content` | `false` \| `"markdown"` \| `"text"` |
| `time_range` | `day`/`week`/`month`/`year` (or `d`/`w`/`m`/`y`); also `start_date` and `end_date` (YYYY-MM-DD) |
| `include_domains` / `exclude_domains` | string[]; `include_domains_mode`: `restrict` \| `prefer` |
| `chunks_per_source` | 1–3, advanced only |
| `country` | Boosts results from one country (general topic) |
| `auto_parameters` | Lets Tavily choose topic and depth. This may switch to advanced, which costs 2 credits (**UNVERIFIED**) |
| `include_usage` | `true` puts `usage.credits` in the response |
| Others | `include_images`, `include_favicon`, `exact_match`, `max_age_hours`, `language` |

**Search response:**
```json
{ "query":"...", "answer":"...", "images":[], "response_time":1.12, "request_id":"...", "usage":{"credits":1},
  "results":[{ "title":"...", "url":"https://...", "content":"snippet", "score":0.83, "raw_content":null,
               "published_date":"...(news topic)", "favicon":"..." }] }
```

**Extract:**
- Request: `{"urls":["https://a","https://b"], "extract_depth":"basic"|"advanced", "format":"markdown"|"text", "include_images":false, "query":"optional rerank", "chunks_per_source":3, "timeout":30, "include_usage":true}`.
- Response: `{"results":[{"url","title","raw_content","images","favicon"}], "failed_results":[{"url","error"}], "response_time", "usage":{"credits"}, "request_id"}`.
- The maximum number of URLs per call is **UNVERIFIED** (believed to be 20).

**Credits** *(secondary, consistent across several 2026 sources)*:
- Search: basic, fast and ultra-fast cost 1 credit; advanced costs 2.
- Extract: basic costs 1 credit per 5 successful URLs; advanced costs 2 per 5. Failed URLs are free.
- Map: 1 credit per 10 pages, or 2 with instructions. Crawl costs map plus extract.

**Pricing:**
- Free plan ("Researcher"): **1,000 credits a month**, no card needed. This is confirmed by the Nebius cookbook and the tavily-python README.
- Pay as you go: $0.008 per credit.
- Plans: Project $30 for 4,000 credits, Bootstrap $100 for 15k, Startup $220 for 38k, Growth $500 for 100k *(secondary)*.
- Rate limits (100 requests a minute for a dev key, 1,000 for production) are **UNVERIFIED**.

**Sources:**
- github.com/tavily-ai/tavily-js src/{utils,search,extract,types}.ts (commit 2026-10-06)
- tavily-ai/tavily-python README
- WebSearch summaries of docs.tavily.com/documentation/api-credits (*secondary*)

---

## 3. Telegram Bot API

### 3a. Managed Bots: one-tap "make my own bot"

- **History:** introduced in **Bot API 9.6 (2026-04-03)**. Bot API 10.0 (2026-05-08) added the access-settings methods (*secondary*: go-telegram/bot issues #279 and #280).
- **Sources for the flow below:**
  - @grammyjs/types 5.0.0 (2026-08-25), whose doc comments are copied from core.telegram.org/bots/api.
  - TDLib's official `td_api.tl` and `LinkManager.cpp` (commit 2026-10-09).

**Setup (once):**
1. Create the manager bot.
2. In the **@BotFather Mini App**, open the bot's settings and turn on **"Bot Management Mode"**. After that, `getMe` returns `can_manage_bots: true`.

**Ways to start creation:**
- **A link (works anywhere, even if the user has never opened the manager bot):**
  - `https://t.me/newbot/{manager_bot_username}/{suggested_bot_username}?name={suggested_bot_name}`
  - Without a suggested username: `https://t.me/newbot/{manager}?name=...`
  - App scheme: `tg://newbot?manager=...&username=...&name=...`
- **What the user sees:** Telegram shows a confirmation dialog. The user can edit the name and username, and has to approve it.
- **Username rule:** a suggested username that doesn't end in "bot" has "bot" appended by the client. Usernames not ending in "bot" are allowed only for Telegram Premium users, as a secondary username.
- **Name:** 1 to 64 characters.
- **Limit:** a user who already owns the maximum number of bots (option `owned_bot_count_max`) gets `BOT_CREATE_LIMIT_EXCEEDED` (TDLib). Send them to `https://t.me/BotFather?start=deletebot`.
- **Alternative inside the manager bot's private chat:** a reply-keyboard button, `{"text":"Create my bot","request_managed_bot":{"request_id":1,"suggested_name":"Ava","suggested_username":"ava_helper_bot"}}`. It works in private chats only.

**After the user confirms:**
- The manager receives `Update.managed_bot`, a `ManagedBotUpdated` object: `{ user: User /* creator */, bot: User /* new bot */ }`.
- The same update arrives when a managed bot's token or owner changes.
- With the keyboard button, there is also a service message whose `message.managed_bot_created.bot` holds the new bot.
- Whether `managed_bot` arrives without listing it in `allowed_updates` is **UNVERIFIED**, so list it explicitly.

**Methods (called with the manager's token):**

| Method | Params | Returns |
|---|---|---|
| `getManagedBotToken` | `user_id` (the managed **bot's** id) | token string |
| `replaceManagedBotToken` | `user_id` | new token (the old one is revoked) |
| `getManagedBotAccessSettings` | `user_id` | `{is_access_restricted, added_users?}` |
| `setManagedBotAccessSettings` | `user_id`, `is_access_restricted`, `added_user_ids?` (up to 10) | `true`. "The bot's owner can always access it." |

**Then, with the new bot's own token:**
- `setWebhook`
- `setMyName` (0 to 64 characters), `setMyDescription` (0 to 512), `setMyShortDescription` (0 to 120)
- `setMyProfilePhoto({photo:{type:"static",photo:"attach://f"}})`. Profile photos can't be reused, so upload a new file with multipart.
- `setMyCommands` (up to 100 commands)

**Constraints and gotchas:**
- The user owns the new bot (they can revoke or transfer it in BotFather). We only hold its token.
- A bot cannot message a user who hasn't started it. After creation, show "Open @AvaHelperBot" as `https://t.me/{new_bot}?start={nonce}`; when `/start {nonce}` arrives, the bot greets them. That this rule applies to managed bots too is **UNVERIFIED**, but assume it does.
- Keep "build-a-bot" out of suggested usernames (the rename-insurance rule).

### 3b. Webhooks, messages, buttons

- **setWebhook:** `POST https://api.telegram.org/bot<TOKEN>/setWebhook` with:
  - `url` (HTTPS; ports 443, 80, 88 or 8443)
  - `secret_token` (1 to 256 characters, `A-Z a-z 0-9 _ -`). Telegram then sends header **`X-Telegram-Bot-Api-Secret-Token: <secret>`** on every update.
  - `allowed_updates`, `drop_pending_updates`, `max_connections`
  - Use a **different secret per bot** and route on it, or on a `/api/telegram/{botId}` path. Compare it in constant time.
  - While a webhook is set, `getUpdates` is disabled.
- **sendMessage:** `{chat_id, text (1 to 4096 characters after entity parsing), parse_mode: "HTML"|"MarkdownV2"|"Markdown", reply_markup, link_preview_options, reply_parameters}`. Prefer **HTML** for model output: escape `& < >` and you're done. MarkdownV2 needs about 18 characters escaped.
- **Inline keyboard:** `reply_markup: {"inline_keyboard":[[{"text":"Approve","callback_data":"ap:7f3c"},{"text":"Cancel","callback_data":"no:7f3c"}]]}`. `callback_data` is **1 to 64 bytes**, so store a short id and keep the payload server-side.
- **answerCallbackQuery:** `{callback_query_id, text? (0 to 200 characters), show_alert?}`. Always call it, because the client shows a spinner until you do. Then edit the message with `editMessageText` or `editMessageReplyMarkup`.
- **sendChatAction:** `{chat_id, action:"typing"}`. It lasts at most 5 seconds and clears when the bot sends a message, so repeat it every 4 to 5 seconds during long runs.
- **Streaming:**
  - `sendMessageDraft {chat_id (private chats), draft_id (non-zero), text (0 to 4096; empty shows a "Thinking…" placeholder), parse_mode?, can_stop?, keep_on_stop?}`.
  - Drafts are an **ephemeral preview that lasts about 30 seconds**; finish with `sendMessage`.
  - With `can_stop`, the user can press stop, which sends a `stopped_message_generation` update.
  - `sendRichMessageDraft` and `sendRichMessage` (rich blocks, added 2026-08-24) are optional.
- **Deep links:** `https://t.me/<bot>?start=<payload>`. The payload is **up to 64 characters**, `A-Z a-z 0-9 _ -`; use base64url for anything else (TDLib checks base64url characters; the 64 limit is from Telegram's docs via aiogram, *secondary*). The bot receives the text `/start <payload>`.
- **Rate limits** (from Telegram's bot FAQ, **UNVERIFIED** this pass): about 1 message a second per chat and about 30 a second overall per bot.

**Sources:**
- npm @grammyjs/types@5.0.0: methods.d.ts, update.d.ts, manage.d.ts, markup.d.ts
- github.com/tdlib/td: td/generate/scheme/td_api.tl and td/telegram/LinkManager.cpp (2026-10-09)
- core.telegram.org/bots/api-changelog (*secondary*)

---

## 4. Twilio (SMS and voice)

**Inbound SMS webhook.** Twilio sends `POST application/x-www-form-urlencoded` with `MessageSid, AccountSid, MessagingServiceSid, From, To (E.164), Body, NumMedia, MediaUrl0..N, MediaContentType0..N, NumSegments`, plus optional geo fields like `FromCity` and `ToZip`.

**Reply options:**
- **TwiML in the response:** `Content-Type: text/xml` and `<Response><Message>Hi from Ava</Message></Response>`. An empty `<Response/>` sends no reply.
- **REST, better for slow LLM replies.** Acknowledge with an empty TwiML first, then send:
```http
POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
Authorization: Basic base64(AccountSid:AuthToken)        (or an API Key SID:Secret)
Content-Type: application/x-www-form-urlencoded

To=%2B15125550100&From=%2B15125550199&Body=Hello            (or MessagingServiceSid=MG..., MediaUrl=...)
```

**X-Twilio-Signature check.** This follows the twilio-node 6.2.0 `src/webhooks/webhooks.ts` algorithm.
- The signed string is the **exact URL Twilio called** (scheme, host, path, query) followed by each POST parameter **sorted by name**, as `name + value`. Repeated keys are deduplicated, sorted, and each appended as `name+value`.
- The signature is HMAC-SHA1 of that string with the Auth Token, encoded as base64.
- twilio-node tries the URL as received, then with and without `:443`/`:80`, then with `new URL()` normalisation.
- JSON-body webhooks instead carry a `bodySHA256` query parameter: sign the URL only, then check `sha256hex(body)`.
```ts
import crypto from 'node:crypto';
export function twilioSig(authToken: string, url: string, params: Record<string, string | string[]>) {
  const data = Object.keys(params).sort().reduce((acc, k) => {
    const v = params[k];
    return acc + (Array.isArray(v) ? [...new Set(v)].sort().map((x) => k + x).join('') : k + v);
  }, url);
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}
// valid = timingSafeEqual(Buffer.from(req.headers['x-twilio-signature']), Buffer.from(twilioSig(token, publicUrl, form)))
// On Vercel, rebuild publicUrl from x-forwarded-proto + host, or use a fixed APP_BASE_URL. Or call twilio.validateRequest(...).
```

**Voice: inbound call.**
- The phone number's Voice URL receives a POST with the standard fields `CallSid, AccountSid, From, To, CallStatus, Direction`. These field names are standard but weren't re-read this pass.
- Respond with TwiML:
```xml
<Response>
  <Gather input="speech" action="/api/voice/turn?bot=b_123" method="POST" speechTimeout="auto"
          speechModel="phone_call" enhanced="true" language="en-US" actionOnEmptyResult="true"
          hints="Ava, reminder, tomorrow" profanityFilter="false">
    <Say voice="Google.en-US-Chirp3-HD-Aoede">Hi, it's Ava. What can I do?</Say>
  </Gather>
</Response>
```

**`<Gather>` attributes** (from the twilio-node `GatherAttributes` type): `action, actionOnEmptyResult, bargeIn, debug, enhanced, finishOnKey, hints, input (dtmf|speech), language, maxSpeechTime, method, numDigits, partialResultCallback, partialResultCallbackMethod, profanityFilter, speechModel (string), speechTimeout ("auto" or seconds), timeout`.
- **`speechModel` values in 2026** *(secondary, Twilio Gather docs)*:
  - `default`, `numbers_and_commands`, `phone_call` (`enhanced="true"` only applies to `phone_call`), `experimental_conversations`, `experimental_utterances`
  - Google STT v2: `googlev2_long`, `googlev2_short`, `googlev2_telephony`, `googlev2_telephony_short`, `googlev2_chirp_3`
  - Deepgram: `deepgram_nova-2`, `deepgram_nova-3` (any Deepgram model name is accepted). `language="multi"` works only with `deepgram_nova-3`.
  - Whether `speechTimeout="auto"` works with each model is **UNVERIFIED**; test it, or use `speechTimeout="2"`.
- **What the action URL receives:** `SpeechResult` (the transcript) and `Confidence` (0.0 to 1.0, **not guaranteed**), or `Digits`, plus the standard fields.
- **Empty input:** without `actionOnEmptyResult="true"`, the call falls through to the next TwiML verb.
- **Next turn:** reply with `<Say>answer</Say>` and a new `<Gather>`.

**`<Say>` voices** (all present in the twilio-node `SayVoice` enum):
- Amazon Polly: `Polly.Joanna-Neural`, `Polly.Matthew-Neural`, `Polly.Ruth-Neural`, `Polly.Danielle-Neural`, `Polly.Gregory-Neural`, `Polly.Stephen-Neural`, plus `-Generative` versions of Joanna, Matthew, Ruth, Danielle and Stephen.
- Google: `Google.en-US-Neural2-A`…`J`, `Google.en-US-Wavenet-*`, `Google.en-US-Chirp3-HD-{Aoede,Charon,Fenrir,Kore,Leda,Orus,Puck,Zephyr}`.
- What each costs per character is **UNVERIFIED**.

**Outbound call.** Use `Twiml` for inline TwiML or `Url` for a TwiML URL; both confirmed in twilio-node call.ts.
```http
POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Calls.json
To=+15125550100&From=+15125550199&Twiml=<Response><Say>Your reminder: call mom.</Say></Response>&StatusCallback=https://.../api/voice/status
```

**ConversationRelay** (`<Connect><ConversationRelay url="wss://..." welcomeGreeting="Hi"/></Connect>`):
- **What it does:** Twilio runs speech-to-text and text-to-speech and talks to **your WebSocket server**, sending text in and receiving text back.
- **Attributes** (twilio-node type): `url, welcomeGreeting, welcomeGreetingInterruptible, language, ttsLanguage, ttsProvider, voice, transcriptionLanguage, transcriptionProvider, speechModel, interruptible, interruptSensitivity, preemptible, dtmfDetection, hints, partialPrompts, reportInputDuringAgentSpeech, profanityFilter, speechtimeout, backgroundnoisereduction, deepgramsmartformat, ignorebackchannel, elevenlabsTextNormalization, intelligenceService, events, debug`.
- **Messages from Twilio** *(secondary)*:
  - `setup` (callSid, from, to, customParameters)
  - `prompt` with `voicePrompt`, `lang`, `last`; speechTimeout is 600 to 5000 ms
  - `interrupt` with `utteranceUntilInterrupt` and `durationUntilInterruptMs`
  - `dtmf` and `error`
- **Messages you send:** `{"type":"text","token":"Hello ","last":false}` as tokens stream, then `{"type":"text","token":"","last":true}`. Optional fields are `interruptible` and `preemptible`. Don't trim tokens. The other outbound types (`play`, `sendDigits`, `language`, `end`) are **UNVERIFIED**.
- **Price:** $0.07 a minute on top of voice minutes (Twilio conversational-AI pricing page, *secondary*). Media Streams, for raw audio, is about $0.0044 a minute *(secondary)*.

**Prices (US)** *(secondary)*:
- **SMS:** $0.0083 per segment in or out (some sources say $0.0079). Outbound carrier fees add about $0.003 to $0.005 per segment.
- **Numbers:** a local number is $1.15 a month; a toll-free number is about $2.15.
- **Voice:** inbound local about $0.0085 a minute, outbound about $0.014, toll-free inbound about $0.022.
- **Gather speech recognition** (Twilio US pricing page, "current as of August 2026"): $0.02 per use with the default provider, **$0.025 per use with Deepgram Nova or Google v2**, and $0.035 to $0.04 with legacy Google v1.

**Messaging compliance (US):**
- Unregistered 10DLC traffic and unverified toll-free traffic are blocked.
- **A2P 10DLC:** brand registration (a one-time fee of about $4 to $4.50) plus a campaign (monthly fee of about $1.50 to $10, *secondary*). Review takes about 10 to 15 days (earlier research).
- **Sole-proprietor 10DLC** (no EIN; public beta): one number, low daily caps (about 1,000 a day on T-Mobile).
- **Toll-free verification:** about 3 to 5 days. **A business registration number has been required since 2026-02-17**; sole proprietors without an EIN can declare that instead. Misclassification triggers error 30915.
- **Operations:** you need an opt-in flow, HELP and STOP handling (Advanced Opt-Out), and a sample of AI-generated content.

**Sources:**
- github.com/twilio/twilio-node (2026-10-12): src/webhooks/webhooks.ts, src/twiml/VoiceResponse.ts, src/rest/api/v2010/account/{call,message}.ts
- twilio.com/docs/voice/twiml/gather, /voice/conversationrelay/websocket-messages, /en-us/voice/pricing/us, /changelog/business-registration-numbers-required-for-toll-free-messaging-p (all *secondary*)

---

## 5. Email for agents

### 5a. AgentMail (inboxes made by API)
```
Base: https://api.agentmail.to   (EU: https://api.agentmail.eu; real-time WebSocket: wss://ws.agentmail.to)
Auth: Authorization: Bearer $AGENTMAIL_API_KEY
```

| Action | Call | Body (wire, snake_case) |
|---|---|---|
| Create inbox | `POST /v0/inboxes` | `{"username":"ava.k7","domain":"agentmail.to","display_name":"Ava","client_id":"bot_123"}`. Every field is optional; the username is random if omitted. `client_id` is your own id; AgentMail documents it as making retries safe for calendar events, and the same for inboxes is UNVERIFIED. Returns `{inbox_id, email, display_name, pod_id, created_at…}`. `inbox_id` is the address |
| Send | `POST /v0/inboxes/{inbox_id}/messages/send` | `{"to":["a@b.com"],"subject":"…","text":"…","html":"…","cc":[],"bcc":[],"reply_to":[],"labels":[],"attachments":[],"headers":{}}` |
| Reply | `POST /v0/inboxes/{inbox_id}/messages/{message_id}/reply` (also `/reply-all`) | `{"text":"…","html":"…"}`; threading is handled for you |
| Get message | `GET /v0/inboxes/{inbox_id}/messages/{message_id}` | Also `/raw`, `/attachments/{id}` |
| Webhook | `POST /v0/webhooks` (or a webhook per inbox: `POST /v0/inboxes/{id}/webhooks`) | `{"url":"https://…/api/email/agentmail","event_types":["message.received"],"inbox_ids":["…"],"client_id":"…"}`. The response contains `secret` (`whsec_…`) |

- **Events:**
  - Messages: `message.received` (also `.spam`, `.blocked`, `.unauthenticated`), `message.security.completed`, `message.sent`, `message.delivered`, `message.bounced`, `message.complained`, `message.rejected`, `message.opened`
  - Domain: `domain.verified`
  - Calendar: `calendar.event.{created,updated,deleted,responded,starting,ending}`
- **Payload:** `{"type":"event","event_type":"message.received","event_id":"…","message":{inbox_id, thread_id, message_id, from, to, cc, subject, text, html, extracted_text, extracted_html, attachments, in_reply_to, headers, timestamp, size, labels, agent_armor?…},"thread":{…}}`.
  - Use **`extracted_text`**: it is the new text with quoted history stripped.
  - Payloads over about 1 MB may omit text and html, so fetch the message *(secondary)*.
- **Signature:** Svix headers `svix-id`, `svix-timestamp`, `svix-signature` (`v1,<b64>`). Verify with the `svix` library and the webhook `secret` (*secondary*: docs.agentmail.to/webhook-verification).
- **Local development:** "webhooks polling" endpoints (`/v0/webhooks/polling`) and a WebSocket let you receive without a public URL.
- **Custom domains:** `domains` resources; the inbox `domain` must be verified. Subdomains are allowed if enabled.
- **Pricing** *(secondary, Oct 2026)*:
  - Free: 3 inboxes, 3,000 emails a month (100 a day), 3 GB, no custom domain, and a "Sent via AgentMail" footer.
  - Developer, $20 a month: 10 inboxes, 10k emails, 10 domains.
  - Startup, $200 a month: 150 inboxes, 150k emails.
  - Add-ons: about $2 for each extra inbox, domain, or 1k emails.
- **Sources:** npm agentmail@0.5.45 (Fern-generated: environments.js, api/resources/**) and the WebSearch summaries above. Checked 2026-10-14.

### 5b. Resend (sending, and now receiving)

**Send:**
- `POST https://api.resend.com/emails` with `Authorization: Bearer re_…` and an optional `Idempotency-Key` header.
- Body: `{"from":"Ava <ava@mail.example.com>","to":["x@y.com"],"subject":"…","text":"…","html":"…","reply_to":"…","headers":{},"attachments":[],"tags":[],"scheduled_at":"…"}`.
- Response: `{"id":"…"}`.

**Receiving is supported:**
- **Where mail can arrive:** any address on a **verified receiving domain** (put the MX record on a subdomain, e.g. `in.example.com`, and everything sent to `*@in.example.com` goes to Resend), or the account's `<id>.resend.app` subdomain.
- **Webhook:** event **`email.received`**, metadata only: `{"type":"email.received","created_at":"…","data":{email_id, created_at, from, to[], cc[], bcc[], received_for[], message_id, subject, attachments:[{id, filename, content_type, content_disposition, content_id}]}}`.
- **Body:** `GET /emails/receiving/{email_id}` (SDK: `resend.emails.receiving.get(id)`) returns `{id, to, from, subject, html, text, headers, message_id, received_for, reply_to, raw:{download_url, expires_at}, attachments}`. Add `?html_format=cid` to keep `cid:` images.
- **Attachments:** `GET /emails/receiving/{id}/attachments`.
- **Webhook signature:** Svix-style. The SDK's `resend.webhooks.verify({payload: rawBody, headers:{id, timestamp, signature}, webhookSecret})` maps the headers onto `webhook-id/timestamp/signature`. Resend sends them as `svix-id`, `svix-timestamp` and `svix-signature` (*secondary*).
- **Pricing** *(secondary)*: received mail counts toward the same quota as sent mail. Free is 3,000 a month (100 a day); Pro is $20 for 50k.
- **Sources:** npm resend@6.32.1 (dist/index.d.mts, index.mjs); resend.com/docs/dashboard/receiving/introduction and resend.com/docs/knowledge-base/how-do-i-avoid-conflicting-with-my-mx-records (*secondary*).

### 5c. Postmark inbound (fallback)

The inbound webhook is a JSON POST shaped like this (postmark@5.1.0 `InboundWebhook` type):
```json
{ "From":"a@b.com","FromName":"A","FromFull":{"Email":"a@b.com","Name":"A","MailboxHash":""},
  "To":"bot+123@in.example.com","ToFull":[{"Email":"…","Name":"","MailboxHash":"123"}], "Cc":"","CcFull":[],"Bcc":"","BccFull":[],
  "ReplyTo":"","OriginalRecipient":"…","Subject":"…","Date":"…","MailboxHash":"123","MessageID":"…","MessageStream":"inbound",
  "TextBody":"…","HtmlBody":"…","StrippedTextReply":"only the new reply text (replies only)","Headers":[{"Name":"…","Value":"…"}],
  "Attachments":[{"Name":"…","Content":"base64","ContentType":"…","ContentLength":123}], "RawEmail":"(optional)" }
```
- **Security:** Postmark has **no HMAC signature**. Use basic auth in the webhook URL (`https://user:pass@…`) or allowlist Postmark's IP addresses *(secondary)*.
- **Routing:** `MailboxHash` (the `+tag` part) is handy for routing to a bot.
- **Plans:** whether inbound is included in each plan is disputed between sources (*secondary*; check postmarkapp.com/pricing).

---

## 6. Slack

**Create an app from a URL:**
- `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(manifest))}`. There is also `manifest_yaml=`. Confirmed by docs.slack.dev/app-manifests/configuring-apps-with-app-manifests, *secondary*.
- The user picks a workspace, reviews and creates the app, then clicks **Install** and copies the **Bot User OAuth Token (`xoxb-…`)** and the **Signing Secret** (Basic Information page) into our app.
- How long a URL can be before it breaks is **UNVERIFIED**; keep the manifest small.
- A programmatic route exists, `apps.manifest.create`, but it needs an app *configuration* token, so it isn't for consumers.

**Minimal manifest for a bot you can DM.** The field names were checked against @slack/web-api 8.2.0 `types/request/manifest.d.ts`.
```json
{ "display_information": { "name": "Ava", "description": "Your assistant", "background_color": "#1f2937" },
  "features": {
    "app_home": { "home_tab_enabled": false, "messages_tab_enabled": true, "messages_tab_read_only_enabled": false },
    "bot_user": { "display_name": "Ava", "always_online": true } },
  "oauth_config": { "scopes": { "bot": ["chat:write","im:history","im:read","im:write","app_mentions:read","users:read"] } },
  "settings": {
    "event_subscriptions": { "request_url": "https://build-a-bot.site/api/slack/events/b_123", "bot_events": ["message.im","app_mention"] },
    "interactivity": { "is_enabled": true, "request_url": "https://build-a-bot.site/api/slack/interactive/b_123" },
    "org_deploy_enabled": false, "socket_mode_enabled": false, "token_rotation_enabled": false } }
```
- `im:write` is needed for `conversations.open` (the bot messages first). `users:read` is optional.
- The new AI surfaces are `features.agent_view` (`agent_description` up to 300 characters, `suggested_prompts` up to 4, `actions`) and `features.assistant_view`. They need extra scopes such as `assistant:write`, which is **UNVERIFIED**.

**Events API:**
- **url_verification:** the body `{"type":"url_verification","challenge":"…","token":"…"}` must be answered with HTTP 200 and `{"challenge":"…"}` (as bolt-js does).
  - **Gotcha:** with per-user apps, Slack sends this as soon as the app is created, **before** the user has given us the signing secret. Answer url_verification without the signature check (it only echoes the challenge) and verify every other request.
- **Event envelope:** `{"type":"event_callback","team_id","api_app_id","event_id","event_time","event":{"type":"message","channel_type":"im","user":"U…","text":"…","ts":"…","channel":"D…"}}`. Ignore events that carry `bot_id` or a `subtype`, so the bot doesn't answer its own messages.
- **Request signing.** This is bolt-js `verifySlackRequest`:
  - Base string: `v0:${X-Slack-Request-Timestamp}:${rawBody}`.
  - HMAC-SHA256 it with the signing secret, as hex, and compare it to `X-Slack-Signature` (`v0=<hex>`) using `tsscmp` or `timingSafeEqual`.
  - Reject requests whose timestamp is more than **5 minutes** old.
- **Retries:**
  - You must answer with 200 within **3 seconds**.
  - Retries arrive with the `X-Slack-Retry-Num` and `X-Slack-Retry-Reason` headers; dedupe on `event_id`.
  - Sending the `X-Slack-No-Retry: 1` response header stops retries (**UNVERIFIED** this pass).

**Posting a message:**
```http
POST https://slack.com/api/chat.postMessage
Authorization: Bearer xoxb-…   Content-Type: application/json; charset=utf-8
{"channel":"D0123…","text":"fallback","thread_ts":"…",
 "blocks":[{"type":"section","text":{"type":"mrkdwn","text":"Send this email?"}},
           {"type":"actions","elements":[{"type":"button","text":{"type":"plain_text","text":"Approve"},"style":"primary","action_id":"approve","value":"act_7f3c"}]}]}
```
- The response is `{ok, channel, ts, message}`. Check `ok`, because errors come back with HTTP 200.
- Streaming methods are available: `chat.startStream`, `chat.appendStream`, `chat.stopStream` (in @slack/web-api 8.2.0), plus `assistant.threads.setStatus`.

**Button clicks (interactivity):**
- Slack sends a form-encoded POST whose `payload` field is JSON: `{"type":"block_actions","user":{"id"},"team":{"id"},"channel":{"id"},"container":{…},"trigger_id","response_url","message":{…},"actions":[{"type":"button","action_id":"approve","block_id","value":"act_7f3c","action_ts"}]}`.
- Verify the signature over the **raw form body** and acknowledge within 3 seconds. Update the message with `chat.update` or `response_url`.

**Rate limits:**
- For commercially distributed apps not in the Marketplace, created after 2025-05-29, and for **existing installs from 2026-03-03**: `conversations.history` and `conversations.replies` are limited to **1 request a minute and at most 15 objects** (docs.slack.dev changelog 2025-05-29, *secondary*).
- **Internal customer-built apps are exempt.**
- Keep the conversation history in our own DB. The `message.im` events already carry the text.
- `chat.postMessage` is limited to about 1 message a second per channel (**UNVERIFIED** this pass).
- Charging inside Slack needs a Marketplace listing (earlier research).

**Sources:**
- github.com/slackapi/bolt-js src/receivers/{verify-request,HTTPModuleFunctions,HTTPReceiver}.ts (2026-10-09)
- npm @slack/web-api@8.2.0
- docs.slack.dev (*secondary*)

---

## 7. Discord

All of this is verified in the discord/discord-api-docs repo (commit 2026-10-09). The API base is `https://discord.com/api/v10`.

**Interactions endpoint (HTTP, so it works on serverless):**
1. **PING:** Discord POSTs `{"type":1}`; reply with 200 and `{"type":1}` (PONG). A valid `Content-Type` is required.
2. **Signature:** every request carries `X-Signature-Ed25519` (hex) and `X-Signature-Timestamp`. Verify Ed25519 over `timestamp + rawBody` with the app's **public key** (hex). If it fails, return **401**; Discord tests this before it will save the URL.
```ts
import { verifyKey } from 'discord-interactions'; // v4.4.0: async, WebCrypto
const ok = await verifyKey(rawBody, req.headers.get('x-signature-ed25519')!, req.headers.get('x-signature-timestamp')!, process.env.DISCORD_PUBLIC_KEY!);
```
3. **Interaction types:** 1 PING, 2 APPLICATION_COMMAND, 3 MESSAGE_COMPONENT, 4 AUTOCOMPLETE, 5 MODAL_SUBMIT.
4. **Response types:**
   - 1 PONG
   - 4 CHANNEL_MESSAGE_WITH_SOURCE
   - **5 DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE** (shows a loading state)
   - 6 DEFERRED_UPDATE_MESSAGE (components)
   - 7 UPDATE_MESSAGE
   - 8 autocomplete result
   - 9 MODAL
5. **Timing:** the initial response must be sent **within 3 seconds**. The interaction token then stays valid for **15 minutes**.
   - `POST /interactions/{id}/{token}/callback` with `{"type":5}`, or just return that JSON as the HTTP response.
   - Then `PATCH /webhooks/{application_id}/{token}/messages/@original` with `{"content":"…","components":[…]}`.
   - Follow-up messages: `POST /webhooks/{application_id}/{token}`.
   - Neither call needs a bot token.

**Registering global commands** (user-installable, usable in DMs):
```http
PUT https://discord.com/api/v10/applications/{APP_ID}/commands      Authorization: Bot <BOT_TOKEN>
[{ "name":"ask","description":"Ask your bot","type":1,
   "options":[{"type":3,"name":"prompt","description":"What to ask","required":true}],
   "integration_types":[0,1], "contexts":[0,1,2] }]
```
- **`integration_types`:** 0 = GUILD_INSTALL, 1 = USER_INSTALL.
- **`contexts`:** 0 = GUILD, 1 = BOT_DM, 2 = PRIVATE_CHANNEL. PRIVATE_CHANNEL (group DMs, and DMs with someone other than the bot) only matters with USER_INSTALL.
- `dm_permission` is deprecated.
- `POST` to the same route upserts a command by name. Limit: 100 global CHAT_INPUT commands.
- Command names must match `^[-_\p{L}\p{N}…]{1,32}$` (lowercase).
- Since 2026-09-11, string options support multi-line input.

**Plain DMs need the Gateway:**
- Webhook events (`/developers/events/webhook-events`) cover only APPLICATION_AUTHORIZED and DEAUTHORIZED, ENTITLEMENT_*, QUEST_USER_ENROLLMENT, LOBBY_MESSAGE_* and GAME_DIRECT_MESSAGE_*. GAME_DIRECT_MESSAGE_* are Social SDK sessions only. **There is no MESSAGE_CREATE.**
- Free-form DM chat therefore needs a long-lived Gateway connection with the DIRECT_MESSAGES intent. DM content arrives without the privileged MESSAGE_CONTENT intent ("Content in DMs with the app" is an exception).
- So: HTTP-only gives slash commands, buttons and modals; a chat-style DM bot needs a Gateway worker (Fly, Railway or similar, not Vercel functions).
- Opening a DM: `POST /users/@me/channels {"recipient_id":"…"}`. Discord warns that DMs "should generally be initiated by a user action". Whether a user-installed app can DM its installer first is **UNVERIFIED**.

**Components:**
- Buttons go in an action row, **up to 5 per row**. `custom_id` is **1 to 100 characters**. Styles are 1 to 5, and 6 is premium.
- The default upload limit is 20 MiB (since 2026-09-03).
- Components V2 (containers, sections and so on) need message flag `1 << 15` (IS_COMPONENTS_V2), and that can't be undone on the message.

**Install links:**
- Discord-provided link: `https://discord.com/oauth2/authorize?client_id={APP_ID}`. It uses the Default Install Settings configured on the app.
- User install: `https://discord.com/oauth2/authorize?client_id={APP_ID}&integration_type=1&scope=applications.commands`.
- Server install: `&integration_type=0&scope=applications.commands+bot&permissions=…`.

**Sources:**
- discord-api-docs: developers/interactions/{overview,receiving-and-responding,application-commands}.mdx, components/reference.mdx, events/webhook-events.mdx, events/gateway.mdx, resources/{application,user}.mdx, topics/oauth2.mdx, change-log.mdx
- npm discord-interactions@4.4.0

---

## 8. Stripe

**Versions:**
- **stripe npm 23.0.0** (2026-09-30), the latest. It **pins API `2026-09-30.endive`**.
- Earlier pins: v22.6 `2026-08-26.dahlia`; v21 and v22.0 `2026-03-25.dahlia`; v20 `2025-11-17.clover`; v19 `2025-09-30.clover`.
- Stripe says later Endive versions will be additive.

**Breaking changes that touch our code, v19 to v23** (stripe-node CHANGELOG and the migration guides for v21, v22 and v23):
- **v23 / endive:**
  - **`payment_method_types` was removed** from `checkout.sessions.create`, PaymentIntents and SetupIntents. Passing it returns 400 `payment_method_types_no_longer_supported`.
  - Use dynamic payment methods, the new **`allowed_payment_method_types`** (which filters incompatible types instead of erroring), or `excluded_payment_method_types`.
  - **Node 20 or later.**
  - `stripe.webhooks.signature.verifyHeader` and `verifyHeaderAsync` now apply DEFAULT_TOLERANCE (300 s) when you omit `tolerance`; passing `tolerance=0` to `constructEvent` now **skips** the check.
  - `stripe.constructEventWithoutVerification` was removed (use `stripe.webhooks.…`). The `Stripe.ErrorType` namespace was removed (use `Stripe.errors`).
  - Truncated responses now throw `StripeConnectionError`.
- **v22:**
  - The client is a real ES6 class: **`new Stripe(key)`** is required.
  - Callbacks were removed; await instead.
  - A plain API key can't be passed as a method argument; use `{ apiKey }` in RequestOptions.
  - Params come first, options second.
  - The CJS build no longer exports `.default` or `.Stripe`.
  - `Stripe.StripeContext` became the type `StripeContextType`.
- **v21:**
  - Node 18 or later.
  - Using the wrong webhook parser (classic `constructEvent` versus v2 event notifications) **throws**.
  - `decimal_string` fields (for example `unit_amount_decimal`, `currency_conversion.fx_rate`) are now `Stripe.Decimal`.
- **v19:** `parseThinEvent` was renamed `parseEventNotification`; v2 namespace moves.

**Code:**
```ts
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!); // uses the pinned 2026-09-30.endive

const customer = await stripe.customers.create({ email, name, metadata: { userId } });
const session = await stripe.checkout.sessions.create({
  mode: 'subscription', customer: customer.id,
  line_items: [{ price: process.env.STRIPE_PRICE_PLUS!, quantity: 1 }],
  success_url: `${base}/billing/success?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${base}/billing`,
  client_reference_id: userId, allow_promotion_codes: true, subscription_data: { metadata: { userId } },
  // no payment_method_types (removed in endive)
}); // redirect to session.url
const portal = await stripe.billingPortal.sessions.create({ customer: customer.id, return_url: `${base}/settings` }); // portal.url

// Next.js route handler (raw body!)
const body = await req.text();
const event = await stripe.webhooks.constructEventAsync(body, req.headers.get('stripe-signature')!, process.env.STRIPE_WEBHOOK_SECRET!);
// On edge runtimes pass Stripe.createSubtleCryptoProvider() as the 5th arg; Node runtime works without it.
```
- **Gotcha:** event payloads follow the **webhook endpoint's** API version, not the SDK's pin. Create the endpoint (Dashboard or API) with `2026-09-30.endive` so the TS types match *(secondary)*.

**Webhook events for the subscription lifecycle:**
- `checkout.session.completed`: provision, and store `customer` and `subscription`.
- `customer.subscription.created`, `customer.subscription.updated` (status, plan, `cancel_at_period_end`, pause) and `customer.subscription.deleted`.
- `customer.subscription.trial_will_end`.
- `invoice.paid`: extend access. `invoice.payment_failed`: dunning and a UI warning. `invoice.payment_action_required`: 3DS.
- Optional: `customer.subscription.paused` and `customer.subscription.resumed`. Subscription pausing and Trial Offers became GA around endive *(secondary)*.
- Make handlers idempotent on `event.id`.

**Usage add-ons (Billing Meters):**
- Create a Meter once, for example `event_name: "voice_minutes"` with sum aggregation, then a metered Price attached to it.
- Report usage: `POST /v1/billing/meter_events` (SDK: `stripe.billing.meterEvents.create`) with `{ event_name: "voice_minutes", payload: { stripe_customer_id: "cus_…", value: "3" }, identifier: "<uuid>", timestamp: <unix> }`.
  - `identifier` is deduplicated for at least 24 hours.
  - `timestamp` must fall within the past 35 days, or up to 5 minutes in the future.
  - Payload values are strings.
- For high volume, use the v2 meter-event stream (`stripe.v2.billing.meterEventStream`). Its limits are **UNVERIFIED**.
- Error events: `v1.billing.meter.error_report_triggered` and `no_meter_found` (event notifications).

**Sources:**
- github.com/stripe/stripe-node CHANGELOG.md (to 23.0.0) and wiki Migration-guide-for-v21, v22 and v23
- npm stripe@23.0.0: esm/apiVersion.js, Webhooks.d.ts, resources/Checkout/Sessions.d.ts, resources/Billing/MeterEvents.d.ts
- docs.stripe.com/changelog/endive/2026-09-30/remove-payment-method-types-checkout-sessions (*secondary*)

---

## 9. Composio (managed OAuth and 1,000+ tools)

```
Base: https://backend.composio.dev/api/v3.1/   (the current SDK @composio/core 0.23.0 uses v3.1; some docs still show /api/v3/)
Auth: x-api-key: <project API key>             (user/org keys use x-user-api-key; not needed here)
```

| Step | Call | Body / notes |
|---|---|---|
| (a) Auth config with Composio-managed OAuth (once per toolkit) | `POST /api/v3.1/auth_configs` | `{"toolkit":{"slug":"gmail"},"auth_config":{"type":"use_composio_managed_auth"}}`. Returns the auth config id (`ac_…`). Custom app: `{"type":"use_custom_auth","authScheme":"OAUTH2","credentials":{"client_id","client_secret"}}` |
| (b) Connect a user | `POST /api/v3.1/connected_accounts/link` | `{"auth_config_id":"ac_…","user_id":"bot_123","callback_url":"https://build-a-bot.site/connect/done"}`. Returns `{redirect_url, connected_account_id}`. Send the user to `redirect_url` (a hosted Connect Link). The SDK refuses a second ACTIVE account per user and config unless `allowMultiple` is set |
| (c) Status | `GET /api/v3.1/connected_accounts/{id}` (list: `GET /api/v3.1/connected_accounts?user_ids=…&toolkit_slugs=…`) | `status` is one of `INITIALIZING, INITIATED, ACTIVE, FAILED, EXPIRED, INACTIVE, REVOKED`. The SDK's `waitForConnection` polls with a 60 s default. Also `/refresh`, `/revoke` |
| (d) Tools and schemas | `GET /api/v3.1/tools?toolkit_slug=gmail&toolkit_versions=latest` (one tool: `GET /api/v3.1/tools/{TOOL_SLUG}`) | Items carry `slug` (e.g. `GMAIL_SEND_EMAIL`, `{TOOLKIT}_{ACTION}`), `description`, `input_parameters` (JSON Schema), `output_parameters` |
| (e) Execute | `POST /api/v3.1/tools/execute/{TOOL_SLUG}` | `{"user_id":"bot_123","arguments":{…},"version":"20261010_00"}` (or `connected_account_id`). Returns `{data, error, successful, log_id}`. **A pinned `version` is required for manual execution**; the SDK throws `ComposioToolVersionRequiredError` on `latest` unless `dangerouslySkipVersionCheck` is set. Pin per toolkit, e.g. env `COMPOSIO_TOOLKIT_VERSION_GMAIL` |
| Proxy | `POST /api/v3.1/tools/execute/proxy` | Raw API calls against the same domain, with credentials injected |

**Sessions ("Tool Router"), the simpler path:**
- `POST /api/v3.1/tool_router/session` with `{user_id, toolkits, auth_configs, manage_connections}` returns a session with `session_id` and a **hosted MCP endpoint** (`mcp.url`, with headers). It has meta-tools for searching tools, executing them and handling auth inline.
- In TypeScript: `const session = await composio.create('bot_123'); const tools = await session.tools();` together with `@composio/vercel` (0.12.1). That turns the tools into AI SDK tools that execute themselves; `new VercelProvider({ strict: true })` is available for strict schemas.
- This is the least code for an agent loop. Direct execution suits curated tools that get approval gates (our safety rule 1).

**Security:** turn on **callback identity verification**, which defends against OAuth session fixation. It is under project Settings → General. Composio redirects to our endpoint with `session_uri`; we confirm the `user_id` server-side.

**Toolkit slugs.** All of these were confirmed in `docs/public/data/toolkits.json` (1,603 toolkits; version stamps 2026-07 to 2026-10). "Managed" means Composio provides the OAuth app.

| Slug | Managed? | | Slug | Managed? | | Slug | Managed? |
|---|---|---|---|---|---|---|---|---|
| gmail | yes | | twitter | **no** (removed 2026-02-12) | | salesforce | yes |
| googlecalendar | yes | | linkedin | yes | | shopify | **no** |
| googledrive | yes | | reddit | yes | | stripe | yes (also API key) |
| googledocs | yes | | youtube | yes | | zoom | yes |
| googlesheets | yes | | discord | yes | | calendly | yes |
| outlook | yes | | trello | yes (OAuth1) | | figma | yes |
| slack | yes | | asana | yes | | jira | yes |
| notion | yes | | clickup | yes | | confluence | yes |
| github | yes | | todoist | yes | | one_drive | yes (**not** `onedrive`) |
| linear | yes | | airtable | yes | | microsoft_teams | yes |
| dropbox | yes | | hubspot | yes | | whatsapp | yes |
| spotify | **no** | | instagram, facebook | yes | | Also: googlemeet, googletasks, google_maps | yes |

**Managed-auth caveats** (Composio docs: authentication/custom-app-vs-managed-app):
- Consent screens say **"Composio wants to access your account"**.
- Quotas are shared, triggers poll no more often than every 15 minutes, and default scopes are fixed.
- For production, bring your own OAuth apps. Google's restricted scopes still need CASA; see the 10-13 research.

**Pricing** *(secondary, conflicting)*:
- Free tier: 100k tool calls and 50k triggers a month for signups from 2026-08-15; older listings say 20k.
- $29 a month for 200k calls (then $0.299 per 1k); $229 a month for 2M calls (then $0.249 per 1k).
- "Premium" tools such as search, sandboxes and inference bill at 3 times the rate.
- Sandboxes are not billed yet.

**Sources:**
- npm @composio/core@0.23.0 (dist/index.mjs) and @composio/client@2.0.0-rc.11 (generated-operations)
- github.com/ComposioHQ/composio (2026-10-14): docs/api-overviews/{tools,connected-accounts,tool-router}.mdx, docs/content/docs/providers/vercel.mdx, docs/content/changelog/02-12-26-twitter-managed-credentials-removal.mdx, docs/public/data/toolkits.json

---

## 10. Implementation notes for Build-a-bot (proposals, not decisions)

1. **Brain defaults:**
   - Use `nvidia/Nemotron-3_5-Lightning` with **thinking off** for chat turns: `reasoning_effort:"none"` plus `chat_template_kwargs.enable_thinking:false`, and `max_tokens` around 2048.
   - Turn thinking on only for "deep" tasks, on `nvidia/nemotron-3-super-120b-a12b` or `nvidia/Nemotron-3-Ultra-550b-a55b`, with `max_tokens` of 8k to 16k.
   - Use `Qwen/Qwen3-30B-A3B-Instruct-2507` ($0.10/$0.30, non-reasoning) as a fast fallback.
   - Always read `content`, then `reasoning_content ?? reasoning`. Never show reasoning by default. If `content` is empty and `finish_reason` is `length`, retry once with thinking off.
   - Run a daily cron on `GET /v1/models?verbose=true` to refresh prices, detect removed IDs, and alert.
2. **Telegram one-tap, step by step:**
   1. Screen 3 shows "Create on Telegram". The link is `t.me/newbot/{MANAGER}/{slug(name)}_{rand}bot?name={Name}`. Keep it brand-free.
   2. Our manager bot's webhook receives `managed_bot` with `{user, bot}`. Match the Telegram `user` to our signup with a `/start <nonce>` that the user sent the manager beforehand (from a "Continue in Telegram" button), or match `bot.username` to the pending suggestion.
   3. Call `getManagedBotToken({user_id: bot.id})` and store the token **encrypted** (same rules as user API keys).
   4. With the child token: `setWebhook({url: …/api/telegram/{botId}, secret_token: random32, allowed_updates:["message","callback_query"]})`, then `setMyName`, `setMyDescription`, `setMyProfilePhoto` (avatar PNG, multipart) and `setMyCommands`.
   5. With the manager token: `setManagedBotAccessSettings({user_id: bot.id, is_access_restricted: true})`. This means only the owner can talk to it, which is safety rule 2 enforced by Telegram.
   6. Show the "Say hi to Ava" button (`t.me/{bot}?start=hello`). On `/start` the bot sends the first message. Stream with `sendMessageDraft`, then finish with `sendMessage`.
   7. On a `managed_bot` update for an existing bot (token rotated or owner changed), call `getManagedBotToken` again.
3. **Voice on Vercel functions:**
   - For v1, use the **`<Gather input="speech">` loop**. Each turn is one stateless POST: SpeechResult in, then the LLM with thinking off and a short answer, then `<Say>` and a new `<Gather>`.
   - Keep each turn under about 5 seconds. Twilio's webhook timeout of about 15 s is **UNVERIFIED**.
   - Lightning is served in eu-north1; measure the round trip from US callers. Qwen3-30B (eu-north1) or a us-central1 model may be faster.
   - **ConversationRelay** needs a WebSocket server. Put it on Fly.io or Cloudflare (Durable Objects) rather than on the Vercel WebSocket beta, whose connections close at the function's maximum duration.
4. **SMS:** postpone. It needs toll-free verification (with a business registration number) or 10DLC, which takes weeks. Telegram and email cover "text it" for v1.
5. **Email addresses bots own:**
   - Recommendation: **Resend inbound on a brand-neutral receiving subdomain** (e.g. `bots.<neutral-domain>`). Every bot gets `name.x7@…` with no per-inbox fee. Route on `to`/`received_for`, fetch the body with `GET /emails/receiving/{id}`, and send through Resend from the same domain.
   - Use **AgentMail** instead if per-inbox threads, reply-all, "extracted_text", built-in screening and a no-domain start matter more. The free tier has 3 inboxes; plan on about $2 per inbox per month at scale.
   - Either way: verify Svix signatures, treat every inbound body as untrusted (prompt injection), and require approval before replying to anyone but the owner.
6. **Slack:**
   - The one-click "create your own Slack app" URL with our manifest, per bot, is the simplest path. It avoids the Marketplace, likely counts as an internal app (**UNVERIFIED**), and the bot keeps its own name and avatar.
   - The user pastes `xoxb-` and the signing secret. Our endpoint answers url_verification before it has the secret.
   - Later, one distributed app with `chat:write.customize` could set a persona name and icon per message.
7. **Discord:**
   - v1 should be HTTP interactions only: user-install (`integration_type=1`), a `/ask` command with `contexts [0,1,2]`, a deferred response (type 5), then a PATCH to `@original`. Buttons handle approvals.
   - Free-form DMs need a Gateway worker outside Vercel; defer it.
8. **Fast acknowledgement for every webhook:**
   - Acknowledge right away: Slack and Discord within 3 s; Telegram quickly, since slow responses get retried; Twilio well under its timeout.
   - Finish the work in `waitUntil()` (`@vercel/functions`) or a queue. Dedupe on `event_id`, `update_id`, `MessageSid` or the interaction id.
9. **Stripe:** use stripe@23.0.0 as installed. Don't send `payment_method_types`; set the webhook endpoint's API version to `2026-09-30.endive`; use `constructEventAsync(await req.text(), …)`. Meters suit add-ons such as voice minutes, premium-model tokens and SMS.
10. **Composio:**
    - Start with managed auth for gmail, googlecalendar, notion, github, slack and linear, through **Sessions** plus `@composio/vercel`, or direct `/tools/execute` for curated tools behind our approval gate.
    - Turn on callback identity verification. Pin toolkit versions.
    - Plan our own OAuth apps before launch so consent screens show our name; the Google ones need Google verification.

**Environment variables:**

| Integration | Vars |
|---|---|
| Token Factory | `TOKEN_FACTORY_API_KEY` (cookbook name: `NEBIUS_API_KEY`), optional `TOKEN_FACTORY_BASE_URL=https://api.tokenfactory.nebius.com/v1` |
| Tavily | `TAVILY_API_KEY`, optional `TAVILY_PROJECT_ID` |
| Telegram | `TELEGRAM_MANAGER_BOT_TOKEN`, `TELEGRAM_MANAGER_BOT_USERNAME`, `TELEGRAM_MANAGER_WEBHOOK_SECRET`; child-bot tokens and secrets go in the DB, encrypted with `TOKEN_ENCRYPTION_KEY` |
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (signature checks need the Auth Token even if REST uses `TWILIO_API_KEY_SID`/`TWILIO_API_KEY_SECRET`), `TWILIO_PHONE_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_RELAY_WSS_URL` (if ConversationRelay) |
| AgentMail | `AGENTMAIL_API_KEY`, `AGENTMAIL_WEBHOOK_SECRET` (`whsec_…`) |
| Resend | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_INBOUND_DOMAIN`, `EMAIL_FROM_DOMAIN` |
| Postmark (fallback) | `POSTMARK_SERVER_TOKEN`, `POSTMARK_INBOUND_BASIC_AUTH` |
| Slack | Per-user apps: none global; the `xoxb` token and signing secret are stored per bot (encrypted). Distributed app: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` |
| Discord | `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN` |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_<PLAN>`, `STRIPE_METER_<NAME>` (optional), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (only for Elements) |
| Composio | `COMPOSIO_API_KEY`, `COMPOSIO_AUTH_CONFIG_<TOOLKIT>` (`ac_…`), `COMPOSIO_TOOLKIT_VERSION_<TOOLKIT>` |
| Shared | `APP_BASE_URL=https://build-a-bot.site` (to rebuild signed URLs for Twilio and to build webhook URLs) |

**Still UNVERIFIED and worth a 30-minute live test with real keys:**
- Streamed `tool_calls` on Lightning and Super.
- Whether `reasoning_effort:"none"` works on Nano and Super.
- Whether the Telegram `managed_bot` update arrives without being listed in `allowed_updates`, and whether a new managed bot can message its owner before `/start`.
- Which Gather `speechModel` values work with `speechTimeout="auto"`.
- Whether a per-user Slack app counts as "internal" for the rate-limit exemption.
- Tavily's limit on URLs per extract call.
- Composio's current free-tier size.
