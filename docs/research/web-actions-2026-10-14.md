# Web actions research: which cloud browser, and how (2026-10-14)

Scope: how Build-a-bot's bots browse websites and fill out forms from a serverless Next.js backend, with a preview and the owner's approval before anything is sent. Written for whoever works on web actions next. The provider choice below is Claude's build choice; Diego hasn't confirmed it.

**How this was checked.** The sandbox couldn't open vendor docs: WebFetch failed DNS for docs.browser-use.com, browser-use.com, docs.browserbase.com and docs.stagehand.dev, and the egress proxy refused them too. So claims come from these, best first:
1. **Official SDKs from npm, read as source and type definitions.** These are generated from each vendor's OpenAPI spec, so they show the real endpoints and fields:
   - `browser-use-sdk@3.11.3` (published 2026-09-04): the v2, v3 and v4 clients.
   - `@browserbasehq/sdk@2.21.0` (2026-09-24).
   - `@browserbasehq/stagehand@4.2.1` (2026-10-11) and `@3.7.3`.
   - `steel-sdk@0.18.0` (2026-03-16).
2. **WebSearch summaries** of vendor docs and pricing pages, marked *(secondary)*.

Anything else is marked **UNVERIFIED**.

---

## 1. Decision (Claude; Diego to confirm): Browser Use Cloud, API v2, over plain `fetch`

- **A hosted browser agent.** We send one plain-language task per step; their agent clicks and types in their cloud browser.
  - No Playwright, CDP or model key in our functions, and no new npm dependency.
  - The model cost is in their price.
  - The open-source engine underneath (browser-use) is MIT, so self-hosting stays possible.
- **"Fill now, send after approval" works natively:**
  - A `keepAlive` session keeps the browser open after the fill task.
  - The submit is a follow-up task in the same session (`sessionId` on `POST /tasks`).
  - `persistMemory` lets the follow-up see the fill's context.
- **The safety knobs we need are in v2:**
  - `allowedDomains` keeps the agent on the form's site.
  - `systemPromptExtension` puts our hard rules in the agent's own system prompt.
  - `maxSteps`, `startUrl`.
  - `structuredOutput` (a JSON Schema) gives a machine-checkable report of exactly what was typed.
  - Per-step `screenshotUrl` gives the preview picture, and `liveUrl` a live view.
- **Cost** *(secondary, docs.browser-use.com/cloud/pricing)*:
  - $0.01 per started task plus about $0.006 a step on the default `browser-use-2.0` model, so a 10-step task is about $0.07.
  - Browser time: $0.02–0.06 an hour.
  - The residential proxy is on by default and billed per GB.
- **A second provider isn't built.** The `WebActionsProvider` interface (`src/lib/web-actions/types.ts`) is ready for one; see section 3 for the best candidate.

### Why API v2 and not v3 or v4

Browser Use ships three API generations in the same SDK.

| | v2 (`/api/v2`, tasks + sessions) | v3 (`/api/v3`, "BU agent" sessions) | v4 (`/api/v4`, Hosted Agents: runs) |
|---|---|---|---|
| Follow-up in the same browser | ✓ `sessionId` + `keepAlive` (default true) | ✓ `sessionId` + `keepAlive` (default false) | ✓ `sessionId` (a live browser is reused) |
| Structured output | ✓ `structuredOutput` (schema as a string; `output` comes back as a JSON string) | ✓ `outputSchema` | ✗ (only `result` text) |
| Keep the agent on one site | ✓ `allowedDomains` | ✗ | ✗ |
| Our rules in the agent's system prompt | ✓ `systemPromptExtension` | ✗ | ✗ |
| Screenshot for the preview | ✓ per step (`steps[].screenshotUrl`) | ✓ latest (`screenshotUrl`, presigned, ~5 min) | ✗ |
| Cost cap | `maxSteps` | `maxCostUsd` | `maxCostUsd` |
| Agent scope | browser only | browser plus files, code execution, scheduled tasks, its own email inbox | browser plus workspace |

- The vendor calls v4 "the current API for new integrations" *(secondary, browser-use.com/pricing)*. As of SDK 3.11.3 it lacks four things we rely on: structured output, allowed domains, a start URL and screenshots.
- v3 has defaults that would leak across users in a multi-tenant product. `skills: true` saves learned per-domain skills project-wide, and `agentmail: true` gives the agent an email inbox. A migration to v3 must set both false.
- v2 is still the SDK's root export with an up-to-date model list, so it's maintained. The client is one file, `src/lib/web-actions/browser-use.ts`, with the base URL in `BROWSER_USE_BASE_URL`. If v2 is retired, the change is: v4 runs, ask for JSON in the task text, and the preview falls back to the field list (no screenshot).

### v2 endpoints we use (from the SDK's generated types)

```
Base:  https://api.browser-use.com/api/v2      Auth: X-Browser-Use-API-Key: <key>
POST  /sessions           { keepAlive, persistMemory, startUrl, proxyCountryCode } → { id, status: active|stopped, liveUrl }
GET   /sessions/{id}      → { status, liveUrl, tasks[] }
PATCH /sessions/{id}      { action: "stop" }
POST  /tasks              { task, llm?, startUrl, sessionId?, maxSteps (default 100), structuredOutput, allowedDomains,
                            systemPromptExtension, highlightElements, metadata, sessionSettings? } → { id, sessionId }
GET   /tasks/{id}/status  → { status: created|started|finished|failed|stopped, output, isSuccess, cost }  (cheap poll)
GET   /tasks/{id}         → { …, steps: [{ number, url, screenshotUrl, actions[] }], output, cost }
PATCH /tasks/{id}         { action: "stop" | "stop_task_and_session" }
Errors: JSON { detail } — 404 SessionNotFound, SessionStoppedError, SessionHasRunningTaskError, 429 TooManyConcurrentActiveSessions, InsufficientCredits.
```

**UNVERIFIED (check with the first live key):**
1. How long a v2 keep-alive session idles before it closes. The follow-up-tasks docs say 15 minutes of inactivity, with a 4-hour maximum *(secondary)*. We assume 15 minutes, and also check the session's status before sending.
2. Whether `allowedDomains` accepts `*.example.com`. browser-use's own matcher does. We send `["example.com", "*.example.com"]`.
3. Screenshot format and size. We keep only PNG, JPEG or WebP (checked by magic bytes), up to 1.5 MB.

## 2. How it's wired

| Tool | Effect / risk | Policy |
|---|---|---|
| `web_browse` (url, task) | read / low, taints the run | Runs at every level (Look only too). |
| `web_form_fill` (url, fields[], instructions?) | write / medium, taints the run | The site is the recipient (`kind: "website"`), so the new-recipient and prompt-injection rules apply. Typing into a page already reveals the values to that site's scripts. |
| `web_form_submit` (session_id?) | send / high, `alwaysAsk` | Always asks the owner, at every trust level, and an owner "allow" rule can't skip it (new policy reason `always_ask`). |

- **Flow:**
  1. The fill stops before the send button and stores a one-shot "web session" (`pairing_codes`, purpose `web_session`). It holds what was typed, a screenshot, and the provider's session id. It expires with the browser.
  2. The submit's approval card is built from that record, never from the model's arguments: a title, a field list, `args.preview`, and an expiry equal to the browser's.
  3. On approve, the record is claimed atomically, so nothing sends twice. A follow-up task re-checks the values on the page, presses submit once, and reports the site's confirmation.
- **Rules enforced in code before any browser opens** (`src/lib/web-actions/safety.ts`):
  - Public http(s) only (`assertPublicUrl`).
  - No checkout, cart or payment pages, payment intents, card numbers (Luhn), IBANs, or bank fields.
  - No password, PIN or one-time-code fields, and no login pages.
  - No secrets or SSNs.
  - The same checks run again on what the browser reports it typed.
  - The agent gets the same rules in `systemPromptExtension` (`src/lib/web-actions/prompts.ts`), but isn't relied on.
- **The owner's own details:** values may use `{{my_name}}`, `{{my_first_name}}`, `{{my_last_name}}` and `{{my_email}}`. The server fills them from the account, so the model needn't know them. A fill approval shows, and pins, the filled-in values.
- **Limits:**
  - 40 live browser tasks per bot per day.
  - Steps: 20 to read, 30 to fill, 12 to send.
  - Timeouts: 110 s to read, 150 s to fill, 75 s to send. The send runs inside the 120 s approval request, which also writes the bot's follow-up.
- **Demo mode** (no key): a simulated browser (`src/lib/web-actions/demo.ts`) gives believable answers and draws an SVG of the filled form with "Preview · not sent yet". The whole read → fill → approve → send flow works without accounts.
- **Env:** `BROWSER_USE_API_KEY` (turns it on), `BROWSER_USE_BASE_URL`, `BROWSER_USE_MODEL` (Browser Use's `llm`; unset uses their default), `BROWSER_USE_PROXY_COUNTRY` (`off` for no proxy).

## 3. The alternatives

**Browserbase** (sessions, a hosted Stagehand API, and an Agents API):
- **Sessions:** `keepAlive`, timeouts up to 6 hours *(secondary)*, and a live debugger view (`GET /v1/sessions/{id}/debug` → `debuggerFullscreenUrl`). Keep-alive needs a paid plan *(secondary)*.
- **Hosted Stagehand API** (`api.stagehand.browserbase.com/v1`, from stagehand@3.7.3's client):
  - Calls: `/sessions/start`, then `/sessions/{id}/navigate | act | extract | observe | agentExecute | end`.
  - Headers: `x-bb-api-key`, `x-bb-project-id`, `x-model-api-key`.
  - Responses stream (SSE).
  - Per-field `act("type … into …")` gives precise control, but we'd bring and pay for our own model key.
- **Agents API** (`POST /v1/agents/runs`, @browserbasehq/sdk 2.21.0):
  - Fields: `task`, `resultSchema`, `variables` (placeholders whose values aren't stored), `browserSettings`, and **`pauseWhen`**. With `pauseWhen`, the agent can pause the run (status `PAUSED`) to wait for input "e.g. … an approval". That is a native fit for "show a preview, wait for a tap".
  - **UNVERIFIED:** the resume endpoint isn't in SDK 2.21.0, and agent-run pricing isn't public *(secondary: Developer plan $20/mo with 15 agent runs)*.
- **Best second provider:** the Agents API with `pauseWhen`, once resume is documented, behind the same `WebActionsProvider` interface.

**Stagehand** (README's first pick: MIT, TypeScript):
- v4 is an SDK that drives a browser over CDP from our own process: `act`, `observe`, `extract`, with schema-checked data.
- It needs a model key and about 3.5 MB plus OpenTelemetry dependencies.
- It needs a long-lived CDP connection from a serverless function.
- Good later for exact per-field typing against a cloud browser (Browser Use's or Browserbase's CDP URL). Not needed for v1.

**Steel** (steel-sdk 0.18.0):
- Sessions over CDP, a low-level `/v1/sessions/{id}/computer` API (click, type, screenshot), and one-shot scrape, screenshot and PDF.
- No hosted natural-language agent, so filling forms would need our own agent loop.
- Cheap browser hours ($0.05–0.10/h, docs 2025-05 *(secondary)*).
- A fit for cheap page reads and screenshots, not forms.

**Not considered further:**
- Skyvern (AGPL; ideas only, see `docs/DECISIONS.md`).
- Running a browser inside Vercel functions (cold starts, size limits; and never the owner's own browser).

## 4. Open items

1. **Ten real forms** (README): run them with a live key to pick the model by success rate and cost (default `browser-use-2.0` vs `claude-sonnet-5`). Browser Use doesn't offer Nemotron. Testing Nemotron as the driver means self-hosting browser-use or Stagehand against a cloud browser.
2. **Approval timing:** a live fill's approval expires with its browser (about 15 minutes). If owners often approve later, options are:
   - re-fill at approval time, compare the new field report with the approved one in code, and send only if they match; or
   - move to a provider whose sessions last hours (Browserbase).
3. **Denied or expired approvals** leave the browser idling until its timeout (about $0.005). A deny hook could close it right away (`provider.discard`).
4. **Multi-page forms:** the fill may press Next or Continue, but stops before the final button. The screenshot shows only the last page; the field list covers every page.
5. **Logins and payments** are out of scope for v1 by design. Later, the owner might sign in themselves through a live view or a profile; we would still never type their passwords.
6. **Second provider:** see Browserbase above.

## Sources

- npm packages (read as source): [browser-use-sdk](https://www.npmjs.com/package/browser-use-sdk), [@browserbasehq/sdk](https://www.npmjs.com/package/@browserbasehq/sdk), [@browserbasehq/stagehand](https://www.npmjs.com/package/@browserbasehq/stagehand), [steel-sdk](https://www.npmjs.com/package/steel-sdk).
- *(secondary)* [Browser Use follow-up tasks](https://docs.browser-use.com/cloud/agent/follow-up-tasks), [Browser Use pricing docs](https://docs.browser-use.com/cloud/pricing), [Browser Use pricing](https://browser-use.com/pricing), [Browser Use changelog 2026-04-03](https://browser-use.com/changelog/3-4-2026).
- *(secondary)* [Browserbase keep alive](https://docs.browserbase.com/features/keep-alive), [Browserbase timeouts](https://docs.browserbase.com/features/timeouts), [Browserbase allowed domains](https://docs.browserbase.com/platform/browser/security/allowed-domains.md), [Browserbase run-an-agent](https://docs.browserbase.com/reference/api/run-an-agent.md), [Browserbase pricing (Capterra)](https://www.capterra.com/p/10050160/Browserbase/pricing/), [Browserbase pricing (TinyFish)](https://www.tinyfish.ai/blog/browserbase-pricing).
- *(secondary)* [Steel pricing](https://docs.steel.dev/overview/pricing).
