# MCP, MCP auth, remote MCP servers, Claude Code / Codex headless, BYOK brains (research, 2026-10-14)

Research only; nothing here is a decision by Diego. Section 7 is Claude's proposal.

**How this was checked.** Every item has a `Source:` line with the date it was read (all 2026-10-14 unless noted).
- **Primary, read in full:** the MCP spec repo (`github.com/modelcontextprotocol/modelcontextprotocol` at commit `5ea9960`, 2026-10-13), the MCP TypeScript SDK repo (`typescript-sdk` at `9bc40e9`, 2026-10-13, v2.3.1), the official MCP Registry API (live queries), Claude Code docs on `code.claude.com` (raw markdown), the OpenAI Codex source (`github.com/openai/codex` at `ca2b076`, 2026-10-13), the OpenAI Node SDK (`openai-node` at `0bf85e0`, 2026-10-13) and Anthropic's `platform.claude.com` docs.
- **Partial:** many vendor sites (developers.openai.com, ai.google.dev, linear.app, notion, stripe, groq, mistral, openrouter...) do not resolve from this sandbox. For those, the wording comes from search-engine snippets of the vendor's own page. These are marked "(vendor page via search snippet)": treat them as likely but re-check on a normal network.
- **Third-party only:** the LiteLLM model catalog (`BerriAI/litellm` `model_prices_and_context_window.json` at `c581c85`, 2026-10-14) and blogs. Marked **UNVERIFIED** where nothing first-party confirms them.

Related: `docs/research/integrations-2026-10-14.md` (sibling file) covers Token Factory, Tavily, Telegram, Twilio, email, Slack, Discord, Stripe and Composio.

---

## 0. Most important facts and surprises

1. **MCP went stateless on 2026-07-28.** That revision removes the `initialize` handshake, `Mcp-Session-Id`, the GET stream, `ping` and SSE resumability. Every request carries its version and capabilities in `params._meta`, and servers MUST implement `server/discover`. On HTTP every POST now also needs `MCP-Protocol-Version`, `Mcp-Method` and (for `tools/call`) `Mcp-Name` headers.
2. **But the clients we will host mostly still speak the 2025 "legacy" protocol.**
   - The TS SDK v2 client defaults to the legacy `initialize` handshake.
   - Codex has its 2026-07-28 support behind an off-by-default, "under development" feature flag.
   - Claude Code's "v2 runtime" probes servers and uses 2026-07-28 where offered.

   So our MCP endpoint must be **dual-era**. In the TS SDK v2 that is the default: `createMcpHandler(factory)` with `legacy: 'stateless'`.
3. **MCP auth deprecated Dynamic Client Registration (DCR)** in favour of **Client ID Metadata Documents (CIMD)**. CIMD means the `client_id` is an HTTPS URL to a JSON file we host. The client must try registration in this order: pre-registered, then CIMD, then DCR. The 2026-07-28 revision also adds RFC 9207 `iss` validation (a MUST for clients) and issuer-keyed client credentials.
4. **Many "official" remote MCP servers are not open to a new third-party client.**
   - Pre-registration required: GitHub (no DCR; a PAT bearer works), Asana V2, HubSpot, Box, Salesforce, Google Workspace (Developer Preview).
   - Approved clients only: Figma and Vercel; ClickUp is reported to be the same.
   - Admin domain allowlist: Atlassian.
   - Microsoft 365 (Work IQ) is per-tenant with admin consent; work/school accounts only per third-party guides.
   - No official Gmail access without your own Google OAuth client, plus (likely) CASA for restricted scopes.
5. **Claude Code `--bare` cannot use a Claude subscription.** The docs say: "In bare mode, Claude Code never reads OAuth credentials or the system keychain." The docs also say `--bare` "will become the default for `-p` in a future release". That is a forward risk for the Bridge.
6. **Without `--bare`, `claude -p` runs a folder's project hooks and connects its `.mcp.json` servers without asking.** The Bridge must run Claude in an empty, dedicated working directory and pass `--strict-mcp-config` and `--settings '{"disableAllHooks":true}'`.
7. **How to strip Claude Code's built-in tools:** `--tools ""` removes them all (it doesn't touch MCP tools). With `--allowedTools "mcp__bab__*"`, `--permission-mode dontAsk` and `--permission-prompts none`, only our tools run.
8. **Anthropic's legal page explicitly allows the end user to sign in to the unmodified Claude Code binary with their own subscription.** The support article adds: "You can still use the Claude Agent SDK, `claude -p`, and third-party apps with your subscription limits." The 06-15 Agent SDK change is "paused". A local Bridge that spawns the user's own `claude` is consistent with the text, with guardrails (section 4.6).
9. **Codex `exec` denies our MCP tools by default.**
   - It runs with approval policy `never`, and any MCP tool not annotated `readOnlyHint: true` is denied: "MCP tool call requires approval, but approval policy is never".
   - Fix: `-c mcp_servers.<name>.default_tools_approval_mode="approve"`. Our own server enforces approvals.
10. **OpenAI model IDs (from the OpenAI SDK, 2026-10-13):** `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna`. Google's are `gemini-4-argon` (broadly available 10-13; $2/$10 until 12-01, then $4/$20), `gemini-3.8-flash` and `gemini-3.5-flash-lite`. DeepSeek retired `deepseek-chat`/`deepseek-reasoner` (2026-07-24) for `deepseek-flash`.

---

## 1. MCP Streamable HTTP transport

Source: MCP spec repo, `docs/specification/{2025-06-18,2025-11-25,2026-07-28}/**`, `schema/2026-07-28/schema.ts`, commit 5ea9960 (2026-10-13). Read 2026-10-14. (`modelcontextprotocol.io` itself was not reachable from this sandbox; the repo is the source of that site.)

### 1.1 Versions

| Revision | Era | What matters for us |
|---|---|---|
| `2025-03-26` | legacy | Streamable HTTP introduced; HTTP+SSE (2024-11-05) deprecated |
| `2025-06-18` | legacy | **JSON-RPC batching removed**; structured tool output (`structuredContent`, `outputSchema`); elicitation; resource links; servers classified as OAuth resource servers (PRM); RFC 8707 `resource` required; `MCP-Protocol-Version` header required after init |
| `2025-11-25` | legacy | OIDC discovery; icons; incremental scope consent via `WWW-Authenticate`; tool-name guidance; URL-mode elicitation; tools in sampling; **CIMD added**; experimental **tasks**; PRM `WWW-Authenticate` optional with well-known fallback |
| **`2026-07-28`** (latest; `LATEST_PROTOCOL_VERSION = "2026-07-28"`) | modern | stateless (no `initialize`, no sessions); `server/discover`; `subscriptions/listen` replaces GET stream and resource subscribe; `ping`, `logging/setLevel`, roots `list_changed` removed; tasks moved to extension `io.modelcontextprotocol/tasks`; **MRTR** (`resultType: "input_required"`) replaces server-to-client requests; required `resultType` on every result; no SSE resumability; `Mcp-Method`/`Mcp-Name` headers + `x-mcp-header`; `ttlMs`/`cacheScope` on list results; error codes `-32020` HeaderMismatch, `-32021` MissingRequiredClientCapability, `-32022` UnsupportedProtocolVersion; resource-not-found now `-32602`; **deprecated:** Roots, Sampling, Logging, HTTP+SSE, **DCR** (12-month minimum window) |

The **compatibility matrix** (`basic/versioning.mdx`):
- Legacy client to modern-only server **fails**.
- Legacy client to dual-era server **works**.
- A dual-era server picks its behaviour per request: modern `_meta` means stateless serving; an `initialize` means legacy semantics for that session.

### 1.2 Modern (2026-07-28) HTTP rules, quoted or condensed from `basic/transports/streamable-http.mdx`

- One endpoint (e.g. `https://example.com/mcp`) that **supports POST**.
- "Every JSON-RPC message sent from the client **MUST** be a new HTTP POST".
- "The client **MUST** include an `Accept` header listing both `application/json` and `text/event-stream`".
- The body is a single request or notification (no batches).
- **A notification** gets `202 Accepted` with no body.
- **A request** gets either `Content-Type: application/json` (one JSON object) or `Content-Type: text/event-stream` (SSE scoped to that request: related notifications, then the final response). "The client **MUST** support both." Set `X-Accel-Buffering: no` on SSE.
- **Headers on every POST:**
  - `MCP-Protocol-Version: 2026-07-28`, which MUST equal `_meta["io.modelcontextprotocol/protocolVersion"]`. A mismatch gets `400` + `-32020`; an unsupported version gets `400` + `-32022` with `data.supported`.
  - `Mcp-Method: <method>` on all requests.
  - `Mcp-Name: <params.name|params.uri>` on `tools/call`, `resources/read` and `prompts/get`, base64 sentinel `=?base64?…?=` if not plain ASCII.
- **Unknown method:** `404` + `-32601`.
- **Missing header:** a server MAY treat it as `2025-03-26` (legacy clients); otherwise it rejects.
- **Cancellation** = closing the SSE response stream. There is no `notifications/cancelled` on HTTP.
- Resumable SSE via `Last-Event-ID` is not supported.
- **Origin:** "Servers **MUST** validate the `Origin` header … If … present and invalid, … **MUST** respond with HTTP 403". CLIs send no Origin.
- **Older traffic** to a modern-only server: GET/DELETE get `405`; ignore `Mcp-Session-Id` (don't mint or echo it); ignore `Last-Event-ID`.

### 1.3 How to be stateless
- **Modern:** there is nothing to do. The protocol is stateless. State that spans calls uses "explicit, server-minted handles passed as ordinary tool arguments" (`server/tools.mdx` › Stateful Tools).
- **Legacy (2025-11-25) serving:**
  - Answer `initialize` with **no** `Mcp-Session-Id` header. The spec's sessions are optional: "A server … **MAY** assign a session ID".
  - Accept `notifications/initialized` with `202`.
  - Answer each later POST on its own.
  - Return `405` to GET (no standalone SSE stream) and to DELETE.

  In the TS SDK this is the `sessionIdGenerator: undefined` idiom, which `createMcpHandler` uses by default.

### 1.4 Exact shapes

**Modern request** (every request; `_meta` omitted in later examples for brevity):
```http
POST /mcp HTTP/1.1
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: get_weather
Authorization: Bearer <token>

{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_weather","arguments":{"location":"Seattle, WA"},
 "_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28",
          "io.modelcontextprotocol/clientInfo":{"name":"ExampleClient","version":"1.0.0"},
          "io.modelcontextprotocol/clientCapabilities":{}}}}
```
**`server/discover`** (MUST implement). The result shape:
```json
{"jsonrpc":"2.0","id":"discover-1","result":{"resultType":"complete","supportedVersions":["2026-07-28"],
 "capabilities":{"tools":{}},"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"ExampleServer","version":"1.0.0"}},
 "instructions":"…","ttlMs":3600000,"cacheScope":"public"}}
```
**Legacy `initialize`** (2025-11-25; this is what Codex and default TS-SDK clients send):
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25",
 "capabilities":{"roots":{"listChanged":true},"sampling":{},"elicitation":{"form":{},"url":{}}},
 "clientInfo":{"name":"ExampleClient","title":"Example Client Display Name","version":"1.0.0"}}}
```
```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25",
 "capabilities":{"tools":{"listChanged":false}},
 "serverInfo":{"name":"build-a-bot","title":"Build-a-bot tools","version":"1.0.0"},
 "instructions":"Optional instructions for the client"}}
```
Then `{"jsonrpc":"2.0","method":"notifications/initialized"}` → `202`. Legacy `ping`: `{"jsonrpc":"2.0","id":"123","method":"ping"}` → `{"jsonrpc":"2.0","id":"123","result":{}}` (removed in 2026-07-28; still answer it in legacy mode). Version negotiation: if the server doesn't support the client's `protocolVersion` it answers with its own latest; the client disconnects if it can't use that.

**`tools/list` result** (modern adds `resultType`, `ttlMs` and `cacheScope`, and SHOULD use a deterministic order. The list "**MUST NOT** vary per-connection" but "**MAY** vary by the authorization presented on the request"):
```json
{"jsonrpc":"2.0","id":1,"result":{"resultType":"complete","tools":[{
  "name":"web_search","title":"Search the web","description":"Search the public web…",
  "inputSchema":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"],"additionalProperties":false},
  "outputSchema":{"type":"object","properties":{"results":{"type":"array"}},"required":["results"]},
  "annotations":{"readOnlyHint":true,"openWorldHint":true},
  "_meta":{"anthropic/alwaysLoad":true}}],
 "nextCursor":"optional","ttlMs":300000,"cacheScope":"private"}}
```
Tool fields:
- `name` SHOULD be 1–128 chars of `A-Za-z0-9_-.`.
- `title` and `description` are optional.
- `icons`.
- `inputSchema` is a JSON Schema 2020-12 object with `type:"object"` at its root. For no args, use `{"type":"object","additionalProperties":false}`.
- `outputSchema` is optional.
- `annotations` (all hints, untrusted unless the server is trusted). Each is meaningful only when `readOnlyHint` is false, except `openWorldHint`:
  - `title`
  - `readOnlyHint` (default false)
  - `destructiveHint` (default **true**)
  - `idempotentHint` (default false)
  - `openWorldHint` (default **true**)
- `_meta`.

**`tools/call` result:**
```json
{"jsonrpc":"2.0","id":2,"result":{"resultType":"complete",
 "content":[{"type":"text","text":"{\"results\":[…]}"}],
 "structuredContent":{"results":[…]},"isError":false}}
```
- Content types: `text`, `image` and `audio` (base64 + `mimeType`), `resource_link`, and `resource` (embedded).
- If `outputSchema` is set, the server MUST return conforming `structuredContent`. For backward compatibility it SHOULD also return the JSON as a text block.
- **Tool execution errors** (bad input, API failures) use `isError: true` so the model can self-correct. **Protocol errors** (unknown tool, malformed request) are JSON-RPC errors such as `-32602`.
- **MRTR** (2026-07-28 only): to ask the user something mid-call, the server returns `{"resultType":"input_required","inputRequests":{"k":{"method":"elicitation/create","params":{…}}},"requestState":"…"}`. The client retries with **a new id** plus `inputResponses` and `requestState`.

**Claude Code-specific tool `_meta`** (Source: code.claude.com/docs/en/mcp, 2026-10-14):
- `"anthropic/alwaysLoad": true` loads the tool upfront instead of behind tool search. Tool search is on by default.
- `"anthropic/requiresUserInteraction": true` forces a prompt on every call. In `dontAsk` it is **denied**, and an `allow` from `--permission-prompt-tool` is converted to deny.
- Claude Code truncates tool descriptions and server instructions at **2,048 chars**.
- It warns at 10k tokens of tool output and caps it at **25k** (`MAX_MCP_OUTPUT_TOKENS`).
- It flattens root-level `anyOf`/`oneOf`/`allOf`.
- It drops tools whose top-level property names aren't 1–64 chars of `[A-Za-z0-9_.-]` or whose schema fails the 2020-12 meta-schema.

### 1.5 Which era each client speaks (2026-10-14)
| Client | Default | Source |
|---|---|---|
| Claude Code | **v2 runtime** (MCP TS SDK 2.0) on v2.1.232+ when it fetches feature flags; it "asks HTTP, stdio, and claude.ai connector servers whether they support the newer revision, and uses it with those that do". Env: `MCP_SDK_GENERATION=v1|v2`, `MCP_PROTOCOL_NEGOTIATION=auto|legacy`. On v2 it also fails OAuth on an unexpected `iss` and sends OAuth credentials only to HTTPS/localhost token endpoints | code.claude.com/docs/en/mcp (2026-10-14) |
| Codex CLI | legacy. Feature `mcp_2026_07_28` is `UnderDevelopment`, default **false**. The MCP client is `rmcp` | openai/codex `codex-rs/features/src/lib.rs` @ca2b076 |
| TS SDK v2 `Client` | legacy `initialize` unless `versionNegotiation: {mode:'auto'}` or `{pin:'2026-07-28'}` | typescript-sdk `docs/protocol-versions.md` @9bc40e9 |

### 1.6 Server code (TS SDK v2, Next.js route handler)
Sources: typescript-sdk `README.md`, `docs/serving/web-standard.md`, `docs/serving/legacy-clients.md`, `docs/serving/authorization.md`, `packages/server/src/server/createMcpHandler.ts` @9bc40e9 (v2.3.1, 2026-10-05).
- The packages are `@modelcontextprotocol/server` and `@modelcontextprotocol/client`; v1 is `@modelcontextprotocol/sdk`, bug fixes only, for at least 6 months after the v2 release on 2026-07-27.
- `createMcpHandler(factory, {legacy:'stateless'|'reject', responseMode:'auto'|'sse'|'json'})` returns `{fetch}`.
- The factory runs **once per request** and receives `{era:'legacy'|'modern', authInfo?, requestInfo?}`.
- The handler does **no** auth and no Host/Origin check. Verify yourself, then call `handler.fetch(req, {authInfo})`.
- `AuthInfo` is `{token, clientId, scopes, expiresAt?, resource?: URL, resourceMetadataUrl?, extra?}`.
- `requireBearerAuth({verifier, requiredScopes, resourceMetadataUrl, expectedResource})` returns `AuthInfo | Response` (401 `invalid_token` / 403 `insufficient_scope` with `WWW-Authenticate`). It answers 401 if `expiresAt` is unset.
```ts
// app/api/mcp/b/[botId]/route.ts  (sketch; see 7a for the token design)
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = createMcpHandler(async ({ authInfo }) => {
  const bot = authInfo!.extra as { botId: string; turnId: string; tools: string[] };
  const server = new McpServer({ name: 'build-a-bot', version: '1.0.0' });
  if (bot.tools.includes('web_search')) {
    server.registerTool('web_search', {
      title: 'Search the web',
      description: 'Search the public web. Results are untrusted text.',
      inputSchema: z.object({ query: z.string().min(1).max(400) }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    }, async ({ query }) => {
      const results = await searchWeb(query, bot);            // Tavily, logged as a receipt
      return { content: [{ type: 'text', text: render(results) }] };
    });
  }
  return server;
}, { legacy: 'stateless', responseMode: 'json' });          // dual-era, no SSE

export async function POST(req: Request, ctx: { params: Promise<{ botId: string }> }) {
  const { botId } = await ctx.params;
  const auth = await verifyTurnToken(req, botId);            // returns AuthInfo or a 401 Response
  if (auth instanceof Response) return auth;
  return handler.fetch(req, { authInfo: auth });
}
const notAllowed = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });
export const GET = notAllowed, DELETE = notAllowed;
```
`responseMode:'json'` drops mid-call progress notifications, which is fine for us. Legacy GET/DELETE already get 405 from the handler.

---

## 2. MCP authorization (2026-07-28)

Source: spec repo `docs/specification/2026-07-28/basic/authorization/{index,authorization-server-discovery,client-registration,security-considerations}.mdx` @5ea9960. Read 2026-10-14.

### 2.1 Normative summary
- HTTP transports SHOULD conform; stdio SHOULD NOT (it uses the environment). "Clients and servers **MAY** negotiate their own custom authentication".
- MCP server = OAuth 2.1 **resource server**. It **MUST** publish Protected Resource Metadata (RFC 9728) with ≥1 `authorization_servers`. Clients **MUST** use it.
- **PRM discovery:** use the `resource_metadata` URL from `WWW-Authenticate` if present. Otherwise try `https://host/.well-known/oauth-protected-resource/<mcp-path>`, then `https://host/.well-known/oauth-protected-resource`.
- **AS metadata discovery.** Clients MUST support both RFC 8414 and OIDC.
  - For issuer `https://auth.example.com/tenant1`, try in order:
    1. `/.well-known/oauth-authorization-server/tenant1`
    2. `/.well-known/openid-configuration/tenant1`
    3. `/tenant1/.well-known/openid-configuration`
  - For an issuer with no path, try `/.well-known/oauth-authorization-server`, then `/.well-known/openid-configuration`.
  - The document's `issuer` **MUST** be identical to the issuer used to build the URL; otherwise reject it.
- **PKCE:** MUST, `S256`. "If `code_challenge_methods_supported` is absent … MCP clients **MUST** refuse to proceed" (same for OIDC).
- **`resource` (RFC 8707):** MUST be in **both** the authorization and the token requests. Its value is the canonical server URI (lowercase scheme and host, no fragment, preferably no trailing slash, e.g. `https://mcp.example.com/mcp`). Send it "regardless of whether authorization servers support it".
- **Scopes:** use the challenge's `scope`; otherwise all of PRM `scopes_supported`; otherwise omit. On `403 error="insufficient_scope"`, re-authorize with the **union** of old and new scopes (step-up). Retry a few times at most.
- **Tokens:** `Authorization: Bearer` on every request, never in the query string. Servers MUST check the audience. Servers "**MUST NOT** accept or transit any other tokens" (no passthrough to upstream APIs).
- **Refresh:** keep refresh tokens confidential. Include `refresh_token` in `grant_types`. MAY add `offline_access` if the AS lists it. Never assume one will be issued. For public clients the AS **MUST rotate** refresh tokens.
- **New in 2026-07-28:**
  - **RFC 9207.** Record the AS `issuer` next to the PKCE verifier. If `iss` is in the callback, compare it with simple string comparison. If the AS advertises `authorization_response_iss_parameter_supported: true` and `iss` is absent, **reject**. On a mismatch, don't act on or display `error*`.
  - **Issuer binding (SEP-2352).** Persist client credentials keyed by issuer and re-register if the AS changes. CIMD IDs are portable.
  - DCR **MUST** send `application_type` (`"web"` for a hosted web app, `"native"` for localhost/CLI).
- **Other security:** all AS endpoints over HTTPS; redirect URIs must be `localhost` or HTTPS and exact-match registered; clients SHOULD use `state`.

### 2.2 Registration: which one is preferred now
Priority order (a SHOULD):
1. Pre-registered credentials, if we have them for that AS.
2. **CIMD**, if the AS metadata has `"client_id_metadata_document_supported": true`.
3. **DCR**, if `registration_endpoint` exists. Deprecated, kept "for backwards compatibility".
4. Otherwise ask the user for a client ID.

**CIMD rules for us:**
- `client_id` **MUST** be an `https` URL **with a path**, e.g. `https://build-a-bot.site/oauth/client.json`.
- The document MUST contain `client_id` (exactly equal to the URL), `client_name` and `redirect_uris`.
- Client auth: `none` (public + PKCE) or `private_key_jwt` with JWKS. **Shared secrets are not allowed** with CIMD. Source for that: draft-parecki-oauth-client-id-metadata-document-02, via search snippet; UNVERIFIED for the current draft-ietf-…-00.

The AS fetches the document, validates `redirect_uri` against it, and caches it per HTTP caching headers.
```json
{
  "client_id": "https://build-a-bot.site/oauth/client.json",
  "client_name": "Build-a-bot",
  "client_uri": "https://build-a-bot.site",
  "logo_uri": "https://build-a-bot.site/icon-512.png",
  "redirect_uris": ["https://build-a-bot.site/api/connectors/oauth/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```
Gotcha: tokens are bound to the `client_id` URL. If the brand or domain changes (see the trademark notes in README), every connection must be re-authorized. Pick a domain we will keep for the CIMD URL.

The TS SDK v2 client supports this. If `OAuthClientProvider.clientMetadataUrl` is set and the AS advertises CIMD, it uses the URL as `client_id`; otherwise it falls back to DCR. Credentials are keyed by `ctx.issuer`. `finishAuth(params)` validates `iss`. Source: typescript-sdk `packages/client/src/client/auth.ts` L1310–1340, `docs/clients/oauth.md` @9bc40e9.

### 2.3 Client algorithm for a Next.js server (confidential web app acting as MCP client)
1. **Normalize** the user-supplied URL into the canonical resource `R`: lowercase scheme and host, strip fragment and trailing `/`.
2. **Probe.**
   ```http
   POST https://mcp.notion.com/mcp
   Accept: application/json, text/event-stream
   Content-Type: application/json
   MCP-Protocol-Version: 2025-11-25

   {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"build-a-bot","version":"1.0.0"}}}
   ```
   With a modern probe, use `server/discover` plus `_meta` and the `Mcp-Method` header instead. Expect:
   ```http
   HTTP/1.1 401 Unauthorized
   WWW-Authenticate: Bearer resource_metadata="https://mcp.notion.com/.well-known/oauth-protected-resource/mcp", scope="…"
   ```
3. **Fetch PRM:** `GET {resource_metadata}`, else the well-known paths in 2.1. Read `resource`, `authorization_servers[]` and `scopes_supported`. Check that `resource` matches `R`; the SDK's `validateResourceURL` does this.
4. **Fetch AS metadata** with the path-insertion order in 2.1. Check `issuer`; require `S256` in `code_challenge_methods_supported`. Note `registration_endpoint`, `client_id_metadata_document_supported` and `authorization_response_iss_parameter_supported`.
5. **Register:** pre-registered table keyed by `issuer`, then CIMD (`client_id = https://build-a-bot.site/oauth/client.json`), then DCR:
   ```http
   POST {registration_endpoint}
   Content-Type: application/json

   {"client_name":"Build-a-bot","redirect_uris":["https://build-a-bot.site/api/connectors/oauth/callback"],
    "grant_types":["authorization_code","refresh_token"],"response_types":["code"],
    "token_endpoint_auth_method":"none","application_type":"web"}
   ```
   Store the result keyed by `issuer`. If nothing works, say "this service needs an approved app" (see section 3).
6. **Authorize.** Generate `code_verifier` (43–128 chars), `code_challenge = BASE64URL(SHA256(verifier))` and `state`. Persist `{state, verifier, issuer, R, client_id, user_id}` server-side with a ~10 min TTL. Redirect the browser:
   ```
   GET {authorization_endpoint}?response_type=code&client_id=<id>&redirect_uri=<cb>
       &code_challenge=<c>&code_challenge_method=S256&state=<s>
       &scope=<challenge scope | scopes_supported [+ offline_access if listed by AS]>
       &resource=https%3A%2F%2Fmcp.notion.com%2Fmcp
   ```
7. **Callback.** Look up `state`. Apply the RFC 9207 rule from 2.1 to `iss`. Then exchange:
   ```http
   POST {token_endpoint}
   Content-Type: application/x-www-form-urlencoded

   grant_type=authorization_code&code=<code>&redirect_uri=<cb>&client_id=<id>&code_verifier=<v>&resource=https%3A%2F%2Fmcp.notion.com%2Fmcp
   ```
8. **Store** `access_token`, `refresh_token`, `expires_at`, `scope` and `issuer`, encrypted (envelope encryption), keyed by `(user_id, R, issuer)`. Never send them to the browser or log them.
9. **Use and refresh.** Send `Authorization: Bearer <access>`. Refresh before expiry with `grant_type=refresh_token&refresh_token=…&client_id=…&resource=…` and save the rotated token. On `401`: refresh once, then re-authorize. On `403 insufficient_scope`: step up with the union of scopes. On a changed `authorization_servers`: re-register (issuer binding).
10. **Disconnect:** delete the tokens; call `revocation_endpoint` if advertised.

The SDK route: `@modelcontextprotocol/client` `StreamableHTTPClientTransport(url, {authProvider})`. Implement `OAuthClientProvider` over the database:
- `clientMetadataUrl`
- `clientInformation(ctx)` and `saveClientInformation(info, ctx)`, keyed by `ctx.issuer`
- `tokens` / `saveTokens`
- `saveCodeVerifier` / `codeVerifier`
- `state()`
- `saveDiscoveryState` / `discoveryState`
- `redirectToAuthorization(url)`: return the URL to the browser

`connect()` throws `UnauthorizedError` after calling `redirectToAuthorization`. In the callback, compare `state`, then call `transport.finishAuth(searchParams)` and reconnect on a **fresh** transport. Source: `docs/clients/oauth.md` @9bc40e9.

---

## 3. Official remote MCP servers (2026-10-14)

**Method.** URL and transport come from the **official MCP Registry** when the vendor published there under its own domain namespace. A domain namespace like `com.notion/*` requires DNS or HTTP proof of the domain. A row marked "registry" is verified live:
`GET https://registry.modelcontextprotocol.io/v0.1/servers?search=<x>&version=latest`.

Auth details come from vendor docs via search snippets unless marked. Every remote server here is Streamable HTTP unless noted, and an `/sse` URL, where listed, is the deprecated transport.

**Auth legend:**
- **OAuth-DCR:** self-registration works.
- **OAuth-CIMD:** the AS advertises CIMD.
- **OAuth-prereg:** we must register an app with the vendor first.
- **OAuth-allowlist:** only clients the vendor approved.
- **Bearer:** an API key or PAT in `Authorization`.

| Service | Official URL | Auth | Notes / Source |
|---|---|---|---|
| GitHub | `https://api.githubcopilot.com/mcp/` (`/x/{toolset}`, `/readonly`; headers `X-MCP-Toolsets`, `X-MCP-Readonly`) | **OAuth-prereg** (GitHub App recommended, or OAuth App) **or Bearer PAT**. "Dynamic Client Registration is NOT supported by Remote GitHub MCP Server at this time." CIMD not mentioned | registry `io.github.github/github-mcp-server` (2026-10-08); raw.githubusercontent.com/github/github-mcp-server/main/docs/{remote-server,host-integration}.md |
| Linear | `https://mcp.linear.app/mcp` (also `/mcp/readonly`) | OAuth 2.1 **DCR**; **Bearer** API key or OAuth token also accepted | registry `app.linear/linear` (2026-08-04); linear.app/docs/mcp (vendor page via search snippet) |
| Notion | `https://mcp.notion.com/mcp` (`/sse` legacy) | OAuth only (no integration tokens on the hosted server); DCR per third parties, **UNVERIFIED** | registry `com.notion/mcp`; developers.notion.com/guides/mcp (vendor page via search snippet) |
| Atlassian (Jira, Confluence, Loom) | `https://mcp.atlassian.com/v2/mcp` and `https://mcp.atlassian.com/v1/mcp/authv2` | OAuth 2.1, but **each customer org's admin must allow the client's domain** (Atlassian supplies a default partner list). API tokens only if the org admin enables them | registry `com.atlassian/atlassian-mcp-server` (2026-09-09); support.atlassian.com Rovo MCP pages (vendor page via search snippet) |
| Asana | `https://mcp.asana.com/v2/mcp` | **OAuth-prereg**: create an "MCP app" in the Asana dev console. "Dynamic client registration is not supported" on V2 | developers.asana.com/docs/connecting-mcp-clients-to-asanas-v2-server (vendor page via search snippet); not in registry |
| monday.com | `https://mcp.monday.com/mcp` (`/sse`) | OAuth: DCR via `/register`, or a monday app with "New OAuth flow"; extra accounts need **admin approval**. **Bearer** personal API token (testing only) | registry `com.monday/monday.com`; developer.monday.com/api-reference/docs/integrate-with-monday-mcp (vendor page via search snippet) |
| ClickUp | `https://mcp.clickup.com/mcp` | OAuth; **allowlisted clients only** per third parties; public beta | third-party blogs only, **UNVERIFIED** |
| Sentry | `https://mcp.sentry.dev/mcp` | OAuth (details **UNVERIFIED**) | registry `io.github.getsentry/sentry-mcp` (2026-09-25) |
| Stripe | `https://mcp.stripe.com` | OAuth; **Bearer** restricted key (`rk_…`) for agents | registry `com.stripe/mcp`; third-party guides, **UNVERIFIED** details |
| PayPal | `https://mcp.paypal.com/mcp` (`/sse`) | `Authorization` required (PayPal OAuth access token) | registry `com.paypal.mcp/mcp` |
| Square | `https://mcp.squareup.com/mcp` (directories also list `/sse`) | OAuth; production data only | developer.squareup.com/docs/mcp (vendor page via search snippet) |
| Shopify | Storefront: `https://{shop}.myshopify.com/api/mcp`; Customer Account MCP | Storefront: **none** (per-shop catalog and cart). Customer Account: OAuth + PKCE. **No official remote Admin MCP** found | shopify.dev storefront-mcp (vendor page via search snippet) |
| Intercom | `https://mcp.intercom.com/mcp` (EU `mcp.eu.intercom.com` per one guide) | OAuth or **Bearer** token | developers.intercom.com/docs/guides/mcp (vendor page via search snippet); region support conflicting |
| HubSpot | `https://mcp.hubspot.com` | **OAuth-prereg** ("MCP auth app" in your HubSpot account) + PKCE; no DCR (per Arcade) | developers.hubspot.com …/integrate-with-the-remote-hubspot-mcp-server (vendor page via search snippet) |
| Salesforce | `https://api.salesforce.com/platform/mcp/v1/<server>` | **OAuth-prereg**: External Client App per org, PKCE; Enterprise+ | third-party, GA April 2026, **UNVERIFIED** |
| Zapier | `https://mcp.zapier.com/api/v1/connect` | OAuth (default) or **Bearer** connection token | registry `com.zapier/mcp` (2026-07-29); docs.zapier.com/mcp (vendor page via search snippet) |
| Make | `https://mcp.make.com` | OAuth (recommended) or token-in-URL `https://<zone>.make.com/mcp/u/<TOKEN>/stateless` | developers.make.com/mcp-server (vendor page via search snippet) |
| Cloudflare | `https://docs.mcp.cloudflare.com/mcp` (no auth); `https://{bindings,observability,builds,radar,containers,browser,logs,ai-gateway,…}.mcp.cloudflare.com/mcp` | OAuth or optional API token header | registry `com.cloudflare.mcp/mcp` |
| Vercel | `https://mcp.vercel.com` | OAuth, **approved clients only** ("only supports AI clients that have been reviewed and approved by Vercel") | registry `com.vercel/vercel-mcp`; vercel.com/docs/mcp/vercel-mcp (vendor page via search snippet) |
| Supabase | `https://mcp.supabase.com/mcp` | OAuth; PAT option **UNVERIFIED** for hosted | registry `com.supabase/mcp` (2026-09-17) |
| Neon | `https://mcp.neon.tech/mcp` | OAuth or **Bearer** Neon API key; header `x-read-only: true` | registry `com.neon/mcp` (2026-09-17) |
| Hugging Face | `https://huggingface.co/mcp` (`?login` for OAuth) | none (anonymous), **Bearer** HF token, or OAuth | registry `co.huggingface/hf-mcp-server` |
| Canva | `https://mcp.canva.com/mcp` | OAuth; DCR per Nango, **UNVERIFIED** | registry `com.canva.mcp/mcp` (2026-09-25) |
| Figma | `https://mcp.figma.com/mcp` | **OAuth-allowlist**: DCR gated on `client_name`; custom clients and PATs rejected; apply via Figma's catalog | registry `com.figma.mcp/mcp`; forum.figma.com threads (Figma staff), 2026 |
| Box | `https://mcp.box.com` | **OAuth-prereg** (Box Admin Console "Box MCP Server" integration, or a Dev Console app) | developer.box.com/guides/box-mcp/remote (vendor page via search snippet) |
| Dropbox | `https://mcp.dropbox.com/mcp` (beta) | OAuth (help center describes creating a Dropbox app). Dash MCP: no DCR | help.dropbox.com/integrations/connect-dropbox-mcp-server (vendor page via search snippet) |
| Google Workspace | `https://gmailmcp.googleapis.com/mcp/v1`, `https://drivemcp.googleapis.com/mcp/v1`, `https://calendarmcp.googleapis.com/mcp/v1` (Developer Preview) | **OAuth-prereg**: your own Google Cloud OAuth client; enable the APIs and their MCP variants. Restricted Gmail scopes very likely still need verification and CASA (our inference from Google's restricted-scope policy) | developers.google.com/workspace/guides/configure-mcp-servers (vendor page via search snippet); not in registry |
| Google Cloud and Maps | `https://{run,compute,container,firestore,sqladmin,bigtableadmin,monitoring,…}.googleapis.com/mcp`, **Maps** `https://mapstools.googleapis.com/mcp`, `https://developerknowledge.googleapis.com/mcp` | Google auth (OAuth or ADC); Maps auth **UNVERIFIED** | registry `com.googleapis.*/mcp` (15 servers, 2026-03/04) |
| Microsoft 365 (Outlook mail, Calendar, Teams, OneDrive/SharePoint, Word) | `https://agent365.svc.cloud.microsoft/agents/tenants/{tenant_id}/servers/mcp_{TeamsServer,CalendarTools,ODSPRemoteServer,WordServer,M365Copilot,MeServer,…}` ("Work IQ", preview) | Entra ID OAuth; **tenant admin consent** (Microsoft docs). M365 Copilot licence and "work/school accounts only, no personal Microsoft accounts" come from third-party guides, **UNVERIFIED** | registry `com.microsoft/workiq-*` (2026-03/07); learn.microsoft.com Work IQ overview (vendor page via search snippet). Also `https://learn.microsoft.com/api/mcp` (docs, no auth) |
| Slack | `https://mcp.slack.com/mcp` (first-party, launched 2026-02-17 per third parties) | OAuth; whether a third party needs its own Slack app is **UNVERIFIED** | docs.slack.dev (vendor page via search snippet); not in registry |
| Airtable | `https://mcp.airtable.com/mcp` | OAuth or **Bearer** PAT | registry `com.airtable/mcp` (2026-05-08); PAT detail from third parties, **UNVERIFIED** |
| Webflow | `https://mcp.webflow.com/mcp` | OAuth (**UNVERIFIED** details) | registry `com.webflow/mcp` |
| Wix | `https://mcp.wix.com/mcp` (`/sse`) | OAuth (**UNVERIFIED** details) | registry `com.wix/mcp` |
| Plaid | `https://api.dashboard.plaid.com/mcp/` | Plaid OAuth token. **Dashboard diagnostics only** (Production teams), not end-user bank data | plaid.com/docs/resources/mcp (vendor page via search snippet) |
| Twilio | `https://mcp.twilio.com/docs` | docs and OpenAPI **search only** (doesn't execute API calls); auth sources conflict | third-party, **UNVERIFIED**; not in registry |
| Zoom | `https://mcp.zoom.us/mcp/{zoom,meeting,chat,docs,tasks,whiteboard,revenue_accelerator}/streamable` | OAuth (details **UNVERIFIED**) | registry `io.github.zoom/*` (2026-05/07) |
| Calendly | `https://mcp.calendly.com` | OAuth 2.1 + PKCE + **DCR**; "Personal access tokens are not supported" | developer.calendly.com/calendly-mcp-server (vendor page via search snippet) |
| Todoist | `https://ai.todoist.net/mcp` | OAuth (reportedly **no refresh token**) | registry `net.todoist/mcp` (2025-09-24) |
| Spotify | none found (a reported Claude-only connector is not a public MCP endpoint) | none | **UNVERIFIED** |
| Apify | `https://mcp.apify.com/` | **Bearer** Apify token (required per registry); OAuth **UNVERIFIED** | registry `com.apify/apify-mcp-server` (2026-10-13) |
| Exa | `https://mcp.exa.ai/mcp` | keyless free tier; key via `?exaApiKey=`, `Authorization: Bearer` or `x-api-key` | registry `ai.exa/exa` (2026-09-23); README via third party |
| Firecrawl | `https://mcp.firecrawl.dev/v2/mcp` | optional **Bearer** key; keyless tier | registry `io.github.firecrawl/firecrawl-mcp-server` (2026-10-13) |
| Browserbase | no official remote (registry lists the npm stdio server only) | none | registry `io.github.browserbase/mcp-server-browserbase` |
| Context7 | `https://mcp.context7.com/mcp` | header `CONTEXT7_API_KEY: <key>` (official docs); OAuth at `/mcp/oauth` per a mirror, **UNVERIFIED** | registry `io.github.upstash/context7`; context7.com/docs (vendor page via search snippet) |
| DeepWiki | `https://mcp.deepwiki.com/mcp` (`/sse`) | **none**; public repos only | docs.devin.ai/work-with-devin/deepwiki-mcp (vendor page via search snippet) |
| Cal.com | `https://mcp.cal.com/mcp` | OAuth 2.1 | third-party directory only, **UNVERIFIED** |
| Granola | `https://mcp.granola.ai/mcp` | browser OAuth per user; no API keys; DCR per directories | docs.granola.ai (vendor page via search snippet) |
| Attio | `https://mcp.attio.com/mcp` | OAuth | third-party, **UNVERIFIED** |
| Pipedream | `https://remote.mcp.pipedream.net` (docs show `/v3`) | **Bearer** token from Pipedream Connect client-credentials, plus headers `x-pd-project-id`, `x-pd-environment`, `x-pd-external-user-id`, `x-pd-app-slug`; beta | pipedream.com/docs/connect/mcp/developers (vendor page via search snippet) |
| Composio | `https://connect.composio.dev/mcp` (or per-user Tool Router `session.mcp.url`) | key header required since 2026-04-15 (`x-consumer-api-key: ck_…` or `x-api-key`), plus OAuth | registry `io.github.ComposioHQ/composio`; docs.composio.dev changelog 2025-11-13 (vendor page via search snippet) |

**Practical consequence:** a "connect anything" button only works out of the box for **DCR/CIMD** servers. Examples: Linear, Notion, Calendly, Granola, Canva, Sentry, Cloudflare, Todoist, monday and Zapier, all likely. For **prereg** vendors (GitHub, Asana, HubSpot, Box, Google, Salesforce, Dropbox), we register our app once per vendor and ship the client IDs. For **allowlist** vendors (Figma, Vercel, ClickUp), we apply. For **API-key** vendors (Exa, Context7, Apify, Firecrawl, Neon), store the key like a BYOK secret.

**Registries usable at runtime:**
- **Official registry API** (no auth; generic API `v0.1`):
  - `GET https://registry.modelcontextprotocol.io/v0.1/servers?search=<substring>&version=latest&updated_since=<RFC3339>&limit=100&cursor=<nextCursor>`
  - `GET /v0.1/servers/{urlencoded name}/versions/latest`
- **Response shape** (verified): `{"servers":[{"server":{"$schema","name","title","description","version","websiteUrl","remotes":[{"type":"streamable-http","url","headers":[{"name","description","isRequired","isSecret","value"}]}],"packages":[…]},"_meta":{"io.modelcontextprotocol.registry/official":{"status","publishedAt","updatedAt","isLatest"}}}],"metadata":{"nextCursor","count"}}`.
- **How to use it:** the registry docs say clients should mostly pull through **subregistries**, and consumers should cache because the registry tolerates ~24 h of downtime. So **ETL it nightly into our own curated table**; don't query it per user. Trust heuristic: the reverse-domain namespace matches the remote host.

Sources: registry repo `docs/reference/api/{official-registry-api,generic-registry-api}.md`, `docs/design/{design-principles,ecosystem-vision}.md` @11b7b0e (2026-10-11); live queries 2026-10-14.

---

## 4. Claude Code headless (`claude -p`)

Sources: code.claude.com/docs/en/{cli-reference,headless,mcp,permissions,agent-sdk/typescript,legal-and-compliance} (raw markdown, read 2026-10-14). The docs cite features up to v2.1.295.

### 4.1 Flags we need
| Flag | Behaviour (docs) |
|---|---|
| `-p, --print` | non-interactive; exit 0 or non-zero; in-run failures (e.g. missing auth) are printed as the result |
| `--output-format text\|json\|stream-json` | `json` = one result object (`result`, `session_id`, `total_cost_usd`, per-model cost); `stream-json` = NDJSON events |
| `--verbose` | docs always pair it with `stream-json`. Community reports say the CLI errors without it (**UNVERIFIED** on the current version), so always pass it |
| `--include-partial-messages` | token deltas as `stream_event` (requires `-p` + `stream-json`) |
| `--input-format text\|stream-json` | stream-json stdin: one JSON per line, `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}`. The shape comes from `SDKUserMessage` plus community examples; the docs don't show it (open issues #24594, #44911) |
| `--mcp-config <files or JSON strings>` | with `-p`, it waits for pending servers up to `MCP_TIMEOUT` (30 s) before turn 1; invalid entries are skipped and reported in `system/init.mcp_server_errors` |
| `--strict-mcp-config` | "Only use MCP servers from `--mcp-config`, ignoring all other MCP configurations" |
| `--tools ""` | "Restrict which built-in tools Claude can use. Use `""` to disable all … The flag doesn't affect MCP tools; to deny those too, use `--disallowedTools "mcp__*"`" |
| `--allowedTools` / `--disallowedTools` | permission rules. MCP: `mcp__server`, `mcp__server__*` and `mcp__server__tool`. Allow-globs need a literal `mcp__<server>__` prefix (`"mcp__*"` allow is ignored); deny `"mcp__*"` or `"*"` removes tools from context |
| `--permission-mode` | `default`(=`manual`), `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`. `dontAsk` denies anything not pre-allowed |
| `--permission-prompts none` | (v2.1.259+) nobody answers prompts: deny, tell Claude not to retry, remove `AskUserQuestion`, cancel unanswered MCP elicitations; denials listed in `result.permission_denials` |
| `--system-prompt[-file]` / `--append-system-prompt[-file]` | replace or append. "Use a replacement flag when the surface, identity, or permission model differs from Claude Code's, like a non-coding agent". A line `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` splits the cached and dynamic parts (v2.1.275+) |
| `--max-turns N` | print mode; exits with an error at the limit |
| `--max-budget-usd X` | client-side cost estimate cap (print mode) |
| `--model sonnet\|opus\|haiku\|fable\|<id>`, `--fallback-model a,b` | aliases or full IDs (e.g. `claude-sonnet-5-5`) |
| `--resume <id\|path>`, `--continue`, `--session-id <uuid>`, `--fork-session`, `--no-session-persistence` | session control; `--no-session-persistence` = nothing saved to disk |
| `--setting-sources user,project,local` | which settings files load (`--setting-sources user` skips a project's settings **and** `.mcp.json`); empty value **UNVERIFIED** |
| `--settings <file\|json>` | overrides file settings for the session (e.g. `{"disableAllHooks":true}`) |
| `--disable-slash-commands` | disables all skills and commands |
| `--bare` | skips hooks, skills, plugins, MCP discovery, auto memory and CLAUDE.md. **Never reads OAuth credentials or the keychain**, so it needs `ANTHROPIC_API_KEY` or `apiKeyHelper`. **Not usable with a subscription** |
| `--restricted` | (v2.1.248+) removes command-running built-ins and WebFetch, confines file tools, loads only managed settings and `--settings`, refuses `bypassPermissions`. Subscription compatibility **UNVERIFIED** |
| `--exclude-dynamic-system-prompt-sections` | better cross-user prompt caching (default prompt only) |

### 4.2 stream-json events (`SDKMessage`, TypeScript reference)
- **`{"type":"system","subtype":"init",…}`** is first, unless hook or plugin-install events come before it. Fields:
  - `session_id`, `cwd`, `tools[]`, `model`, `permissionMode`, `claude_code_version`
  - `apiKeySource`, `slash_commands[]`, `skills[]`, `plugins[]`, `output_style`
  - `mcp_servers:[{name,status}]` and `mcp_server_errors[]` (v2.1.219+)
  - `capabilities[]` (v2.1.205+)
- **`{"type":"assistant","message":<BetaMessage>,"parent_tool_use_id":null,"session_id",…,"error"?}`**. `error` is one of `authentication_failed | oauth_org_not_allowed | account_on_hold | billing_error | rate_limit | overloaded | invalid_request | model_not_found | server_error | max_output_tokens | cloud_credential_error | unknown`.
- **`{"type":"user","message":<MessageParam>,"parent_tool_use_id",…}`** carries tool results.
- **`{"type":"stream_event","event":<BetaRawMessageStreamEvent>,…}`** only with `--include-partial-messages`. Text deltas: `.event.delta.type=="text_delta"`.
- **`{"type":"system","subtype":"api_retry","attempt","max_retries","retry_delay_ms","error_status","error"}`** and **`{"type":"system","subtype":"permission_denied","tool_name","tool_use_id","message"}`**.
- **Last line: `{"type":"result","subtype":"success",…}`.** Fields:
  - `is_error`, `result`, `session_id`
  - `duration_ms`, `duration_api_ms`, `num_turns`, `stop_reason`
  - `total_cost_usd`, `usage`, `modelUsage{}`
  - `permission_denials[]`, `structured_output?`, `terminal_reason?`

  Error subtypes are `error_max_turns | error_during_execution | error_max_budget_usd | error_max_structured_output_retries`, with `errors[]`. Costs are client-side estimates.
- SIGTERM gives exit 143 and leaves the turn unfinished; send SIGINT to end the turn cleanly.

### 4.3 `--mcp-config` for an HTTP server with a bearer header
```json
{"mcpServers":{"bab":{"type":"http","url":"https://api.build-a-bot.site/mcp/b/BOT_ID",
  "headers":{"Authorization":"Bearer ${BAB_MCP_TOKEN}"},"alwaysLoad":true,"timeout":60000}}}
```
- `${VAR}` and `${VAR:-default}` expansion is documented for `.mcp.json` (`command`, `args`, `env`, `url`, `headers`). Applying it to `--mcp-config` is **UNVERIFIED**, so writing a 0600 temp file is the safe default.
- `headersHelper` (a script printing JSON headers, 10 s timeout) is an alternative.
- `alwaysLoad:true` keeps the tools out of tool-search deferral. This matters with `--tools ""`: whether `ToolSearch` survives `--tools ""` is **UNVERIFIED**.
- A server entry without `type` is skipped (`url_missing_type`).

### 4.4 Gotchas for the Bridge
- **Project content runs without trust.** Per the permissions doc table: "Hooks in settings files, the `env` block and helper commands… | `claude -p` … | Used"; and "Servers in `.mcp.json` … | Connected without asking". So: run in an empty dedicated directory, plus `--strict-mcp-config` and `--settings '{"disableAllHooks":true}'`.
- **User's own `~/.claude/CLAUDE.md` and auto memory** still load: without `--bare`, `-p` "loads the same context an interactive session would, including anything configured in the working directory or `~/.claude`", and bare kills subscription auth. Whether `--setting-sources` or `--system-prompt` changes this is **UNVERIFIED**. Their content enters the bot's context. Acceptable for the owner's own bot; note it in the UI.
- **Background tasks:** `-p` may wait up to 10 min for background work. With `--tools ""` there is none.
- **Tool search** is on by default (MCP tools deferred). Use `alwaysLoad`, `_meta["anthropic/alwaysLoad"]`, or `ENABLE_TOOL_SEARCH=false`.
- **MCP OAuth:** Claude Code supports CIMD automatically and has `claude mcp login <name>`. Irrelevant for our bearer server.

### 4.5 Disabling Claude Code's own tools: the recipe
`--tools ""` + `--strict-mcp-config --mcp-config <ours>` + `--allowedTools "mcp__bab__*"` + `--permission-mode dontAsk` + `--permission-prompts none` + `--disable-slash-commands`. Belt and braces: `--disallowedTools "Bash" "Edit" "Write" "WebFetch" "WebSearch" "Agent"`. Check `system/init.tools` at runtime and abort if anything other than `mcp__bab__*` (and `EndConversation`, which can't be removed while MCP tools exist) is present.

### 4.6 Anthropic legal and compliance text (verbatim) and the Bridge verdict
Source: https://code.claude.com/docs/en/legal-and-compliance (read 2026-10-14). Verbatim; markdown links removed, and "…" marks omitted text:

> **Can customers offer Claude Code in their products?**
> Unless we've mutually agreed otherwise, preinstalling or running Claude Code in your products or services (e.g. in hosted sandboxes or other agent infrastructure) requires agreeing to our Commercial Terms of Service and complying with the conditions below:
> * **The Claude Code binary must not be modified.** Claude Code must be installed and run as published by Anthropic, and customers may not remove, disable, or restrict any authentication method built into it (including methods that permit signing in with a Claude account or the user's own API key).
> * **Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf.** Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential (Amazon Bedrock, Google Cloud's Agent Platform, Microsoft Foundry). That usage is billed directly to the end user under their own agreement with Anthropic or, for third-party inference providers, with the applicable provider.
>
> **Using the Claude Code name and logo.** You can accurately say, in plain text, that your product has Claude Code preinstalled or that it runs Claude Code. But you can't use the Claude Code or Anthropic names or logos as part of your own product, feature, or company name, in your own logo, or in a way that suggests Anthropic built, endorses, or is partnered with your product.

> Claude Code usage is subject to the Anthropic Usage Policy. Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK.

> **Authentication and credential use** … **OAuth authentication** is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications. …
> **Developers** building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow.
>
> This does not restrict how customers provision and manage their own API keys or third-party inference provider credentials … Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under *Can customers offer Claude Code in their products?* above.
>
> Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice.

Support article "Use the Claude Agent SDK with your Claude plan" (support.claude.com/en/articles/15036540, read 2026-10-14; short quotes only):
- "We've paused the previously-announced changes to Claude Agent SDK usage."
- "Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription limits."
- 10-07 update: "Claude Max and Team plans now include monthly API credits"; they cover the Agent SDK, `claude -p`, the API and Managed Agents; "You can still use the Claude Agent SDK, `claude -p`, and third-party apps with your subscription limits."

**Verdict (Claude's reading, not legal advice).** A **local, open-source companion that spawns the user's own installed, unmodified `claude` in `-p` mode on the user's own machine** fits the text, under these conditions:
- The user signed in through Anthropic's flow (`claude auth login`).
- Build-a-bot never reads, stores or relays Claude credentials or tokens.
- Usage bills to the user's own plan.
- Nothing is resold.

What supports it:
- The page carves this out explicitly ("Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription").
- Anthropic's own support page names "third-party apps" using subscription limits.

Residual risks to design around:
1. "route requests through … plan credentials **on behalf of their users**": every run must be for the account owner, triggered by the owner. Never run other people's messages on someone's plan; no shared or group bots on one subscription.
2. "ordinary, individual usage": cap proactive turns (heartbeats, check-ins) per day.
3. "preinstalling or running Claude Code in your products" requires the **Commercial Terms**. Accept them (Console org) and follow both conditions. Don't bundle or preinstall Claude Code; use the user's install.
4. Enforcement "without prior notice", and `--bare` becoming the default for `-p` would cut off subscription auth. Detect `authentication_failed` and fall back.
5. If the paused 06-15 change resumes, Bridge usage may move to the monthly API credits or extra usage. Monitor the support article.

---

## 5. OpenAI Codex CLI (`codex exec`)

Sources: openai/codex @ca2b076 (2026-10-13): `codex-rs/exec/src/{cli.rs,lib.rs,exec_events.rs}`, `codex-rs/utils/cli/src/{shared_options.rs,sandbox_mode_cli_arg.rs,config_override.rs}`, `codex-rs/cli/src/main.rs`, `codex-rs/config/src/{mcp_types.rs,config_toml.rs}`, `codex-rs/core/src/mcp_tool_call.rs`, `codex-rs/codex-mcp/src/mcp/mod.rs`, `codex-rs/features/src/lib.rs`. The repo's `docs/*.md` just link to developers.openai.com, which doesn't resolve from this sandbox; everything below comes from source code.

### 5.1 Flags (from source)
- **Usage:** `codex exec [OPTIONS] [PROMPT]`; `PROMPT` `-` or absent reads stdin; piped stdin plus a prompt is appended as a `<stdin>` block. Subcommands: `resume [SESSION_ID|--last]`, fork, review.
- **Output:**
  - `--json` (alias `--experimental-json`): JSONL to stdout.
  - `-o, --output-last-message FILE`.
  - `--output-schema FILE`: JSON Schema for the final message.
- **Run options:**
  - `--skip-git-repo-check`.
  - `--ephemeral`: no session files.
  - `--ignore-user-config`: don't load `$CODEX_HOME/config.toml`; "auth still uses `CODEX_HOME`".
  - `--ignore-rules`: skip execpolicy `.rules`.
  - `--strict-config`.
  - `-C, --cd DIR`, `--add-dir DIR`.
  - `-i, --image`.
- **Model:** `-m, --model`; `--oss --local-provider lmstudio|ollama`; `-p, --profile`.
- **Sandbox:** `-s, --sandbox read-only | workspace-write | danger-full-access`.
- **Approval:** headless **defaults to `approval_policy = never`** (`ConfigOverrides{approval_policy: Some(AskForApproval::Never)}`). `--approve-for-me` (alias `--not-so-yolo`) routes approvals through auto-review. `--dangerously-bypass-approvals-and-sandbox` (alias `--yolo`). **No `--full-auto` flag exists in current source.**
- **Config overrides:** `-c key=value`, dotted path, value parsed as TOML, e.g. `-c model="o3"`. `--enable/--disable <feature>` (global) are equivalent to `-c features.<name>=true|false`.

### 5.2 `--json` JSONL events (`exec_events.rs`)
- `{"type":"thread.started","thread_id":"…"}`
- `{"type":"turn.started"}`
- `{"type":"item.started"|"item.updated"|"item.completed","item":{"id":"…","type":…}}`. Item types:
  - `agent_message{text}`
  - `reasoning{text}`
  - `command_execution{command,aggregated_output,exit_code,status}`
  - `file_change{changes[{path,kind}],status}`
  - `mcp_tool_call{server,tool,arguments,result{content[],structured_content,_meta},error{message},status}`
  - `collab_tool_call`
  - `web_search{query,action,results?}`
  - `todo_list{items[{text,completed}]}`
  - `error{message}`
- `{"type":"turn.completed","usage":{"input_tokens","cached_input_tokens","cache_write_input_tokens","output_tokens","reasoning_output_tokens"}}`
- `{"type":"turn.failed","error":{"message"}}` and `{"type":"error","message"}`.

### 5.3 Remote MCP server config (`config.toml` or `-c`)
```toml
[mcp_servers.bab]
url = "https://api.build-a-bot.site/mcp/b/BOT_ID"   # streamable HTTP
bearer_token_env_var = "BAB_MCP_TOKEN"             # sends Authorization: Bearer $BAB_MCP_TOKEN
# http_headers = { "X-Foo" = "bar" }               # static headers
# env_http_headers = { "X-Bot" = "BAB_BOT_ID" }    # header value from env var
required = true                                     # codex exec exits if this server fails to start
startup_timeout_sec = 20
tool_timeout_sec = 60
default_tools_approval_mode = "approve"             # auto | prompt | writes | approve
# enabled_tools = ["web_search"]  /  disabled_tools = [...]
```
- No experimental flag is needed for HTTP servers.
- An inline `bearer_token` is not supported; it exists only to produce a validation error.
- `http_headers_helper` is local-only.
- **Approval gotcha (code-level):**
  - In exec mode the policy is `never`.
  - `requires_mcp_tool_approval()` returns true unless `readOnlyHint` is true. `destructiveHint` defaults to true and `openWorldHint` defaults to true.
  - `request_mcp_tool_user_approval` then returns `denied("MCP tool call requires approval, but approval policy is never")`.
  - Only `approval_mode = "approve"` (or a disabled or external permission profile, or a full-disk-write sandbox) auto-approves.
  - So set `default_tools_approval_mode = "approve"` for our server, and keep the real approval gate in our server.

### 5.4 Removing Codex's built-in tools
Feature defaults:

| Feature | Stage | Default | Bridge setting |
|---|---|---|---|
| `shell_tool` | Stable | on | `--disable` |
| `unified_exec` | Stable | on | `--disable` |
| `view_image` | Stable | on | `--disable` |
| `sleep_tool` | Stable | on | `--disable` |
| `multi_agent` | Stable | on | `--disable` |
| `apps` (ChatGPT connectors) | Stable | on | `--disable` |
| `plugins` | Stable | on | `--disable` |
| `hooks` | Stable | on | `--disable` |
| `memories` | Stable | off | leave off |
| `mcp_2026_07_28` | UnderDevelopment | off | leave off |

Web search is the top-level `web_search = "disabled" | "cached" | "indexed" | "live"` (default `cached`); set `-c web_search="disabled"`.

`apply_patch` has no off switch in the inspected config (**UNVERIFIED**). Pair the flags above with `--sandbox read-only`. Patches then fail, and with approval `never` they can't escalate. Without disabling `shell_tool`/`unified_exec`, a read-only sandbox still **reads the whole disk**: a prompt-injection exfiltration path.

Persona: `-c developer_instructions="…"` (a developer-role message). Avoid `model_instructions_file` ("Users are STRONGLY DISCOURAGED…").

### 5.5 OpenAI policy text on ChatGPT plans in other apps
developers.openai.com and help.openai.com do not resolve from this sandbox. These quotes are search-engine snippets of the official pages, read 2026-10-14; re-verify on a normal network:
- developers.openai.com/siwc/token-sharing-open-source/codex-app-server: "If you've built a local or open-source application using Codex app-server authentication, you can continue using it, though we recommend migrating to Sign in with ChatGPT." "App-server authentication has never been permitted for commercial or hosted services."
- developers.openai.com/siwc (quickstart): "Sign in with ChatGPT is currently available to selected commercial partners through a limited trial." "ChatGPT plan usage is available to all open-source partners and selected private clients."
- developers.openai.com/siwc/token-sharing-open-source (overview): "your open-source app can request permission to use the user's ChatGPT plan for eligible Responses API requests. This does not grant access to their ChatGPT conversations or other account context."
- The cookbook "Integrating Sign in with ChatGPT in your Opensource App" (snippet) gives the launch scope as "open-source projects, personal projects that run locally, and selected private apps".
- Prior repo research (10-13, read on Diego's network): plan usage is documented "for open-source and locally hosted apps"; paid or remotely hosted apps go through OpenAI's interest form.

**Verdict.** The Bridge drives the **user's own `codex` CLI login, locally**. It is not app-server token passing and not hosted. Making the Bridge **open source and free** keeps it inside "local or open-source application". Gray zone: Build-a-bot itself is commercial. Before charging for ChatGPT-backed bots, ask OpenAI (or join the SIWC commercial trial). Never read or copy `~/.codex/auth.json`. Never run Codex on our servers (consistent with docs/DECISIONS.md).

---

## 6. BYOK providers (OpenAI-compatible chat completions)

**Price sources:**
- OpenAI model IDs: `openai-node` `src/resources/shared.ts` (`ChatModel`, generated from OpenAI's OpenAPI spec, 2026-10-13).
- Claude prices: the bundled Claude API reference (cached 2026-10-06).
- Everything else: LiteLLM catalog @c581c85 (2026-10-14) unless stated; third-party, **UNVERIFIED** against vendor price pages.

Every row supports tools and streaming via OpenAI-style `tools` and `stream:true`, except where noted. Auth is `Authorization: Bearer <key>` unless noted.

| Provider | Base URL | Default model (agent with tools) | Cheap model | Key check | Notes / sources |
|---|---|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-6-sol` or `gpt-6.1-sol` ($2/$10) | `gpt-6-luna` ($0.10/$0.50) | `GET /v1/models` | flagship `gpt-6-astra` ($10/$50; long-context premium above 272K per third parties). Older: `gpt-5.6-{sol,terra,luna}`. IDs verified in SDK; prices LiteLLM + third parties |
| Anthropic | native `https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`. OpenAI-compat `https://api.anthropic.com/v1/` ("primarily intended to test and compare… not … production-ready"; no prompt caching; `strict` ignored) | `claude-sonnet-5-5` ($2/$10) | `claude-haiku-5-5` ($0.10/$0.50 for prompts ≤100K) | `GET /v1/models` | also `claude-opus-5-5` ($4/$20). Use the native API (caching). platform.claude.com/docs/en/api/openai-sdk.md (2026-10-14) |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-3.8-flash` ($0.75/$3.75) | `gemini-3.5-flash-lite` ($0.30/$2.50) | `GET …/v1beta/openai/models` | frontier `gemini-4-argon`: broadly available 2026-10-13, $2/$10 intro, $4/$20 from 12-01, 1M context (blog.google and VentureBeat via search). Tools, stream and `reasoning_effort` mapping are documented (ai.google.dev/gemini-api/docs/openai, vendor page via search snippet). Model list from google-gemini/cookbook README and styleguide (2026-10). **Free tier for Flash-class models: likely, UNVERIFIED**, and Google may use free-tier data. Gemini CLI login reuse is banned (DECISIONS.md) |
| OpenRouter | `https://openrouter.ai/api/v1` | choose from the catalog (`provider/model` slugs) | any `:free` or cheap slug | `GET /api/v1/key` (limit, usage, `is_free_tier`). `GET /api/v1/models` is public | attribution headers: `HTTP-Referer` (needed for an app page) + `X-OpenRouter-Title` (`X-Title` still accepted); send both. Filter models whose `supported_parameters` include `tools` (**UNVERIFIED** field name). openrouter.ai/docs (vendor page via search snippet). Reachable on Diego's network |
| Groq | `https://api.groq.com/openai/v1` | `openai/gpt-oss-120b` ($0.15/$0.60) | `openai/gpt-oss-20b` ($0.075/$0.30) | `GET /openai/v1/models` | also `qwen/qwen3.8-27b`, `llama-3.3-70b-versatile`. console.groq.com/docs/models (vendor page via search snippet) |
| Mistral | `https://api.mistral.ai/v1` | `mistral-medium-latest` (Medium 3.5; LiteLLM $1.5/$7.5, one guide $0.40/$2: conflict) | `mistral-small-latest` ($0.15/$0.60) | `GET /v1/models` | `mistral-large-latest`; alias targets change (docs advise dated IDs) |
| xAI | `https://api.x.ai/v1` | `grok-4.7` ($2/$6, 500K context; docs.x.ai pricing via search) | `grok-4.3` ($1.25/$2.50) | `GET /v1/models` | no `grok-5` ID found |
| DeepSeek | `https://api.deepseek.com` (OpenAI-compatible; `/v1` also accepted per history) | `deepseek-flash` (V4.1 Flash) | same | `GET /models` | `deepseek-chat` and `deepseek-reasoner` retired **2026-07-24** (third parties + LiteLLM deprecation date); `deepseek-v4-pro`. api-docs.deepseek.com (via search). **Blocked on Diego's network** (10-13 DNS test) |
| Together | `https://api.together.xyz/v1` (docs also show `api.together.ai/v1`) | pick from `/v1/models` (catalog churns monthly) | — | `GET /v1/models` | many LiteLLM entries carry deprecation dates; tool support per model. **Blocked on Diego's network** |
| Fireworks | `https://api.fireworks.ai/inference/v1` | `accounts/fireworks/models/glm-5p3` ($1.40/$4.40) or `kimi-k3` ($3/$15) | `accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b` ($0.05/$0.20) or `glm-5p3-flash` ($0.15/$0.50) | `GET /inference/v1/models` (**UNVERIFIED**; LiteLLM uses `https://api.fireworks.ai/v1/accounts/{account_id}/models`) | also hosts Nemotron 3.5 Lightning (prior research) |
| Cerebras | `https://api.cerebras.ai/v1` | `gpt-oss-120b` ($0.35/$0.75) | `llama3.1-8b` ($0.10/$0.10) | `GET /v1/models` | catalog refreshes often; `qwen-3.8-27b` and `gemma-4-31b` listed (LiteLLM) |

**Validation recipe:**
1. Call `GET {base}/models` with the key: 200 means valid, 401 or 403 means invalid. For OpenRouter use `/key`.
2. Do a 1-token `chat/completions` with `tools:[…]` to confirm tool support for the chosen model.

Never echo keys back to the browser (a rule from day one, `docs/history/first-build-brief.md`).

---

## 7. Implementation notes for Build-a-bot (Claude's proposal, not decided)

### 7a. Our per-bot MCP server (what the Bridge hands to Claude Code / Codex)
- **Endpoint:** `POST https://api.<domain>/mcp/b/<botId>`, dual-era, stateless (`createMcpHandler`, `legacy:'stateless'`, `responseMode:'json'`); GET/DELETE get 405; no sessions. Origin check: reject any present Origin that is not ours. Host it on Vercel (Node runtime) and keep tool calls under the function timeout. Long jobs return a handle plus a `check_job` tool (the spec's stateful-tool pattern).
- **Auth: a short-lived per-turn token, not a long-lived secret.** When the cloud dispatches a turn to the Bridge (over its WebSocket), it mints a JWT:
  - Claims: `iss` (our API), `aud` (exact per-bot URL, the RFC 8707 style audience), `sub=botId`, `owner=userId`, `turn=turnId`, `scope` (the bot's tool set), `exp` (now+15 min), `jti`.
  - Signed EdDSA/ES256; verified with `jose` in `verifyTurnToken`, then put into `AuthInfo.extra`.
  - On failure: `401` + `WWW-Authenticate: Bearer error="invalid_token"`.
  - The Bridge passes it only through a child-process env var (`BAB_MCP_TOKEN`). A leaked token dies with the turn.
  - No OAuth/PRM is needed for v1; the spec allows custom auth. Add PRM plus our own AS later if users want to plug a bot's tools into their own clients.
- **tools/list:**
  - Derived from the bot's config (it "MAY vary by the authorization presented"), in deterministic order.
  - Short names (Claude API names ≤64 chars), `annotations` set honestly.
  - `_meta["anthropic/alwaysLoad"]=true` on core tools; descriptions ≤2,048 chars; no root-level `anyOf`; results under ~10k tokens.
  - Mark read-only tools `readOnlyHint:true`. Codex auto-approves those even without the config override.
- **Policy lives in the server, not the model** (research "Minimum to ship" #1–#4). The server tracks per-turn taint keyed by `turnId`:
  - Once any tool returned untrusted content (web pages, inbound email), side-effect tools (send, post, buy, delete, settings) return `isError:true`: "Needs the owner's approval; I've asked them in the app." The owner approves out-of-band (push or passkey). Then the cloud runs the action or a new turn.
  - This works for every client era. MRTR URL-elicitation (2026-07-28) can replace it later for modern clients.
  - Dedupe side effects on `(turnId, tool, hash(args))`: clients may retry.
- **Connectors through the gateway:**
  - Tools from the user's connected remote MCP servers (Notion, Linear…) are proxied by this server with upstream tokens kept server-side, namespaced `notion_search` etc.
  - The CLI never sees third-party tokens. This is not "token passthrough": upstream tokens are separate grants (spec 2.1).
  - For API-key MCPs (Exa, Context7), inject the key server-side.

### 7b. Connecting remote MCP servers from the web app
- Implement 2.3 with `@modelcontextprotocol/client` v2: `versionNegotiation:{mode:'auto'}` and an `OAuthClientProvider` backed by Postgres or Supabase (RLS on). `clientMetadataUrl = https://<stable-domain>/oauth/client.json`. Callback `/api/connectors/oauth/callback`. Prefill pre-registered client IDs per issuer (GitHub App, Asana MCP app, HubSpot MCP auth app, Box, Google Workspace, Salesforce later).
- **Directory UI from data:** nightly ETL from the registry into a curated table `{name, url, auth_mode: dcr|cimd|prereg|allowlist|apikey|none, verified_at}`. Show only rows we have tested. Hide allowlist-only vendors until approved. Probe each server's PRM/AS metadata in CI weekly to update `auth_mode`.
- **Per-connection scopes:** request the minimum (challenge `scope`). Store `(user_id, resource, issuer)` uniquely. Step-up on 403. Refresh with `resource`. Revoke on disconnect.
- Default new connections to read-only where vendors offer it: Linear `/mcp/readonly`, GitHub `/readonly`, Neon `x-read-only: true`. This matches "Look only" in the trust step.

### 7c. Bridge invocations (one process per turn; canonical history stays in our cloud)
Run in an empty per-bot dir, e.g. `~/.buildabot/work/<botId>` (no `.claude/`, `.mcp.json`, `CLAUDE.md`, `AGENTS.md`). Feed a deterministic transcript (persona → memory summary → last N turns → new message) on stdin. A stable prefix gets server-side prompt-cache hits across processes. Mark untrusted text inside it.

**Claude Code** (verify `claude --version` ≥ v2.1.259 for `--permission-prompts`):
```bash
umask 077; CFG="$WORK/.bab-mcp.json"   # {"mcpServers":{"bab":{"type":"http","url":"https://api.<domain>/mcp/b/$BOT","headers":{"Authorization":"Bearer ${BAB_MCP_TOKEN}"},"alwaysLoad":true}}}
# if ${VAR} expansion turns out not to apply to --mcp-config, write the JWT itself into this 0600 file and delete it after the turn
cd "$WORK" && BAB_MCP_TOKEN="$TURN_JWT" ENABLE_TOOL_SEARCH=false claude -p \
  --output-format stream-json --verbose \
  --model sonnet \
  --system-prompt-file "$WORK/persona.md" \
  --tools "" --strict-mcp-config --mcp-config "$CFG" \
  --allowedTools "mcp__bab__*" \
  --permission-mode dontAsk --permission-prompts none \
  --disable-slash-commands --settings '{"disableAllHooks":true}' \
  --no-session-persistence --max-turns 12 \
  < "$WORK/turn-input.txt"
```
- Parse NDJSON. Check `system/init`:
  - `tools` ⊆ `mcp__bab__*` + `EndConversation`.
  - `mcp_servers[bab].status`.
  - `apiKeySource`: confirm it's the subscription and not some `ANTHROPIC_API_KEY` in the user's env. **Scrub `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` from the child env** unless the user chose API billing.
- Stream `assistant` text to the channel. Store `result.total_cost_usd` as an estimate. Map `assistant.error=rate_limit` to "your Claude limit is reached" and offer the Free brain.
- Later option: `--session-id <uuid>` on the first turn, then `--resume` while the conversation stays local. Better caching, but the local transcript diverges when a turn falls back to the cloud.

**Codex** (`codex --version`; check feature names at startup since they churn):
```bash
cd "$WORK" && BAB_MCP_TOKEN="$TURN_JWT" codex exec --json --ephemeral --skip-git-repo-check \
  --ignore-user-config --ignore-rules --sandbox read-only -C "$WORK" \
  --disable shell_tool --disable unified_exec --disable view_image --disable sleep_tool \
  --disable multi_agent --disable apps --disable plugins --disable hooks \
  -c web_search='"disabled"' \
  -c 'mcp_servers.bab.url="https://api.<domain>/mcp/b/'"$BOT"'"' \
  -c 'mcp_servers.bab.bearer_token_env_var="BAB_MCP_TOKEN"' \
  -c 'mcp_servers.bab.required=true' \
  -c 'mcp_servers.bab.default_tools_approval_mode="approve"' \
  -c "developer_instructions=$(jq -Rs . < "$WORK/persona.md")" \
  -o "$WORK/last.txt" - < "$WORK/turn-input.txt"
```
- Read `item.completed` items with `type:"agent_message"` for the reply and `mcp_tool_call` for receipts. `turn.completed.usage` gives tokens; `turn.failed`/`error` means fall back.
- Omit `-m` unless the user picked a model: which models a ChatGPT plan exposes in Codex is **UNVERIFIED**.
- `-c` creating a new `mcp_servers.<name>` table purely from overrides is **UNVERIFIED** (likely). The fallback is a generated `config.toml` in a private `CODEX_HOME`, but that would move auth, so test the override path first.

### 7d. Compliance guardrails for the Bridge
1. **Spawn, don't host or embed.** Use the user's own `claude`/`codex` from PATH, unmodified. Never bundle, preinstall or auto-update them; at most link to the official installers. Never run either CLI on our servers.
2. **Never touch credentials.** Don't read, copy, upload or log keychain items, `~/.claude*` credential files, `~/.codex/auth.json`, `CLAUDE_CODE_OAUTH_TOKEN`, or `claude setup-token` output. Sign-in happens only through `claude auth login` / `codex login` (Anthropic's or OpenAI's own flow), run by the user. Use `claude auth status` (JSON `authMethod`) only to show a status line.
3. **Owner-only, owner-initiated.** A subscription-backed bot answers only its owner's messages. Other people's messages are never processed on the owner's plan. Cap proactive turns per day (suggested ≤10) to stay within "ordinary, individual usage". Show usage and let the owner pause.
4. **No money in the loop.** Build-a-bot never pays for, resells or meters Claude or ChatGPT plan usage. Paid Build-a-bot features must not be "access to Claude/ChatGPT".
5. **Naming.** Plain-text "works with your Claude Code / Codex". No Anthropic or OpenAI names or logos in product, feature or plan names.
6. **Terms.** Accept Anthropic's Commercial Terms (Console org) since we "run Claude Code" in our product. Publish the Bridge as open source (OpenAI's carve-out is for local or open-source apps). Get OpenAI's view before charging for ChatGPT-backed bots.
7. **Sandboxing.** Strip built-in tools (4.5, 5.4), run in an empty directory, and keep tokens short-lived per turn. The Bridge's local control port must authenticate every connection (OpenClaw lessons: no open control panel).
8. **Detect drift.** On each Bridge start, record the CLI version and probe flags (`--help` greps, a dry `-p` with `--max-turns 1`). On `authentication_failed`, an unknown flag, or changed `system/init` tools, disable the subscription brain and fall back to Free (opt-in), then tell the owner.

### Things to test first (in this order)
1. `claude -p --tools "" … --permission-mode dontAsk` with a **subscription** login: our MCP tools run; nothing else is listed; `apiKeySource` shows the subscription.
2. Without `--verbose`, does `stream-json` error?
3. Does `${BAB_MCP_TOKEN}` expand inside `--mcp-config`?
4. `alwaysLoad` versus `ToolSearch` with `--tools ""`.
5. `codex exec` with `-c mcp_servers.bab.*` overrides and `--disable` flags: `mcp_tool_call` items complete; no `command_execution` items appear.
6. Our endpoint: run against Claude Code (modern probe) and Codex (legacy `initialize`) and confirm both work statelessly on Vercel.
7. OAuth probe of 10 directory servers: record `client_id_metadata_document_supported` and `registration_endpoint` for each.
