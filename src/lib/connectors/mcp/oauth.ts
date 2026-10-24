/**
 * OAuth for remote MCP servers, per the MCP authorization spec (2026-07-28):
 *   probe → 401 + WWW-Authenticate → Protected Resource Metadata (RFC 9728)
 *   → Authorization Server metadata (RFC 8414 / OIDC, path-insertion order, issuer check)
 *   → client registration: pre-registered → Client ID Metadata Document → DCR
 *   → authorization code + PKCE (S256) + `resource` (RFC 8707) + `iss` check (RFC 9207)
 *   → tokens stored encrypted; refreshed before expiry.
 * Some vendors only accept pre-registered or approved clients (docs/research/mcp-and-brains-2026-10-14.md §3).
 */
import { eq } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Connection } from "@/lib/db/schema";
import { appUrl } from "@/lib/env";
import { pkcePair, randomToken } from "@/lib/crypto";
import { readCredential, replaceCredential, storeCredential } from "@/lib/channels/secrets";
import { getConnector } from "@/lib/connectors";
// Every address here comes from the server or its metadata, so it's someone else's choice: public only.
import { publicFetch, UnsafeUrlError } from "@/lib/tools/net";
import { McpAuthRequired, MCP_CLIENT_VERSION, parseWwwAuthenticate } from "./client";

export const OAUTH_CALLBACK_PATH = "/api/connectors/oauth/callback";
export const CLIENT_METADATA_PATH = "/oauth/client.json";

export function redirectUri() {
  return `${appUrl()}${OAUTH_CALLBACK_PATH}`;
}

export function clientMetadataUrl() {
  return `${appUrl()}${CLIENT_METADATA_PATH}`;
}

export function clientMetadataDocument() {
  return {
    client_id: clientMetadataUrl(),
    client_name: "Build-a-bot",
    client_uri: appUrl(),
    logo_uri: `${appUrl()}/icon.svg`,
    redirect_uris: [redirectUri()],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

/** Canonical resource URI: lowercase scheme/host, no fragment, no trailing slash. */
export function canonicalResource(url: string): string {
  const u = new URL(url);
  u.hash = "";
  const path = u.pathname.replace(/\/+$/, "");
  return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${path}${u.search}`;
}

type AsMeta = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  code_challenge_methods_supported?: string[];
  client_id_metadata_document_supported?: boolean;
  authorization_response_iss_parameter_supported?: boolean;
  scopes_supported?: string[];
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await publicFetch(url, { headers: { accept: "application/json" }, timeoutMs: 10000 });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * An unsigned `initialize`. A 401/403 means sign-in, with its challenge. Any other answer
 * proves nothing: Google's servers answer 200 (and even list their tools), then refuse every call.
 */
async function probe(url: string): Promise<{ needsAuth: boolean; challenge: ReturnType<typeof parseWwwAuthenticate> }> {
  try {
    const res = await publicFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": MCP_CLIENT_VERSION },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: MCP_CLIENT_VERSION, capabilities: {}, clientInfo: { name: "build-a-bot", version: "1.0.0" } },
      }),
      timeoutMs: 15000,
    });
    if (res.status === 401 || res.status === 403) return { needsAuth: true, challenge: parseWwwAuthenticate(res.headers.get("www-authenticate")) };
    return { needsAuth: false, challenge: {} };
  } catch (err) {
    if (err instanceof McpAuthRequired) return { needsAuth: true, challenge: parseWwwAuthenticate(err.wwwAuthenticate) };
    throw new Error("Couldn't reach that MCP server.");
  }
}

async function discoverAs(issuer: string): Promise<AsMeta | null> {
  const u = new URL(issuer);
  const path = u.pathname.replace(/\/+$/, "");
  const candidates = path
    ? [
        `${u.origin}/.well-known/oauth-authorization-server${path}`,
        `${u.origin}/.well-known/openid-configuration${path}`,
        `${u.origin}${path}/.well-known/openid-configuration`,
      ]
    : [`${u.origin}/.well-known/oauth-authorization-server`, `${u.origin}/.well-known/openid-configuration`];
  for (const c of candidates) {
    const meta = await getJson<AsMeta>(c);
    if (meta?.authorization_endpoint && meta.token_endpoint) {
      if (meta.issuer && meta.issuer.replace(/\/$/, "") !== issuer.replace(/\/$/, "")) continue; // issuer must match
      return { ...meta, issuer: meta.issuer ?? issuer };
    }
  }
  return null;
}

function preRegistered(issuer: string): { client_id: string; client_secret?: string } | null {
  try {
    const map = JSON.parse(process.env.MCP_OAUTH_CLIENTS ?? "{}") as Record<string, { client_id: string; client_secret?: string }>;
    return map[issuer] ?? map[new URL(issuer).host] ?? null;
  } catch {
    return null;
  }
}

/** How the catalog signs in to this connection's server; null for a server the owner pasted (custom MCP). */
function catalogAuth(connection: Connection, url: string): "oauth" | "bearer" | "none" | null {
  if (connection.connectorId.startsWith("custom_mcp:")) return null;
  const via = getConnector(connection.connectorId)?.via.find((v) => v.kind === "mcp" && v.url === url);
  // A catalog app signs in unless its entry says it needs none.
  return via?.kind === "mcp" ? via.auth : "oauth";
}

/** "no_auth": connect without signing in, once its tools really load (the caller checks). */
export type StartResult = { kind: "redirect"; url: string } | { kind: "no_auth" } | { kind: "error"; message: string };

type ProtectedResource = { resource?: string; authorization_servers?: string[]; scopes_supported?: string[] };

/**
 * Only the catalog can say an app needs no sign-in (auth "none"): every other catalog app goes
 * through sign-in, whatever its server answers. A server the owner pasted needs none only when
 * it lets us in and advertises no sign-in.
 */
export async function startMcpOAuth(
  db: Db,
  input: { ownerId: string; botId: string; connection: Connection; redirectTo: string },
): Promise<StartResult> {
  const url = String((input.connection.config as { url?: string }).url ?? "");
  if (!url) return { kind: "error", message: "This connector has no server URL." };
  const listed = catalogAuth(input.connection, url);
  if (listed === "none") return { kind: "no_auth" };
  const resource = canonicalResource(url);
  const { needsAuth, challenge } = await probe(url);

  const r = new URL(resource);
  const prm =
    (challenge.resourceMetadata ? await getJson<ProtectedResource>(challenge.resourceMetadata) : null) ??
    (await getJson<ProtectedResource>(`${r.origin}/.well-known/oauth-protected-resource${r.pathname}`)) ??
    (await getJson<ProtectedResource>(`${r.origin}/.well-known/oauth-protected-resource`));
  if (listed === null && !needsAuth && !prm?.authorization_servers?.length) return { kind: "no_auth" };
  const issuer = prm?.authorization_servers?.[0] ?? r.origin;
  const as = await discoverAs(issuer);
  if (!as) return { kind: "error", message: "That server's sign-in couldn't be discovered." };
  if (as.code_challenge_methods_supported && !as.code_challenge_methods_supported.includes("S256")) {
    return { kind: "error", message: "That server doesn't support secure sign-in (PKCE)." };
  }

  // Register: pre-registered → CIMD → DCR.
  let clientId: string | null = null;
  let clientSecret: string | undefined;
  const pre = preRegistered(as.issuer);
  if (pre) {
    clientId = pre.client_id;
    clientSecret = pre.client_secret;
  } else if (as.client_id_metadata_document_supported) {
    clientId = clientMetadataUrl();
  } else if (as.registration_endpoint) {
    try {
      const res = await publicFetch(as.registration_endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          client_name: "Build-a-bot",
          redirect_uris: [redirectUri()],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          application_type: "web",
        }),
        timeoutMs: 15000,
      });
      if (res.ok) {
        const reg = (await res.json()) as { client_id?: string; client_secret?: string };
        clientId = reg.client_id ?? null;
        clientSecret = reg.client_secret;
      }
    } catch {
      /* fall through */
    }
  }
  if (!clientId) {
    return {
      kind: "error",
      message: "This app only lets in apps it has approved, and it hasn't approved this one yet, so it can't be connected here for now.",
    };
  }

  const pkce = pkcePair();
  const state = randomToken(24);
  const scope = challenge.scope ?? prm?.scopes_supported?.join(" ") ?? undefined;
  await db.insert(schema.oauthStates).values({
    id: state,
    ownerId: input.ownerId,
    botId: input.botId,
    connectorId: input.connection.connectorId,
    kind: "mcp",
    codeVerifier: pkce.verifier,
    data: {
      connectionId: input.connection.id,
      issuer: as.issuer,
      tokenEndpoint: as.token_endpoint,
      revocationEndpoint: as.revocation_endpoint ?? null,
      issParamSupported: Boolean(as.authorization_response_iss_parameter_supported),
      clientId,
      clientSecret: clientSecret ?? null,
      resource,
      scope: scope ?? null,
    },
    redirectTo: input.redirectTo,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  const auth = new URL(as.authorization_endpoint);
  // The browser is sent here, so it must be a web address (a server could answer "javascript:…").
  if (auth.protocol !== "https:") throw new Error("This app's sign-in address isn't a secure web address (https).");
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri());
  auth.searchParams.set("code_challenge", pkce.challenge);
  auth.searchParams.set("code_challenge_method", "S256");
  auth.searchParams.set("state", state);
  auth.searchParams.set("resource", resource);
  if (scope) auth.searchParams.set("scope", scope);
  return { kind: "redirect", url: auth.toString() };
}

type TokenSet = { access_token: string; refresh_token?: string; expires_at?: number; scope?: string; token_type?: string };

export async function finishMcpOAuth(
  db: Db,
  input: { state: string; code: string | null; iss: string | null; error: string | null; userId: string | null },
): Promise<{ ok: true; redirectTo: string; connectionId: string } | { ok: false; message: string; redirectTo?: string }> {
  const [row] = await db.select().from(schema.oauthStates).where(eq(schema.oauthStates.id, input.state)).limit(1);
  if (!row || row.kind !== "mcp" || row.expiresAt.getTime() < Date.now()) return { ok: false, message: "That sign-in link expired. Try connecting again." };
  await db.delete(schema.oauthStates).where(eq(schema.oauthStates.id, row.id));
  // Only the person who started connecting may finish it, in their own browser. Otherwise a
  // stranger could send someone their own sign-in link and get that person's account (their
  // Gmail, say) connected to the stranger's bot.
  if (!input.userId || input.userId !== row.ownerId) return { ok: false, message: "Sign in to Build-a-bot as the person who started connecting this app, then connect it again." };
  const d = row.data as {
    connectionId: string;
    issuer: string;
    tokenEndpoint: string;
    revocationEndpoint: string | null;
    issParamSupported: boolean;
    clientId: string;
    clientSecret: string | null;
    resource: string;
    scope: string | null;
  };
  // RFC 9207: compare iss before acting on anything in the response.
  if (input.iss ? input.iss !== d.issuer : d.issParamSupported) return { ok: false, message: "Sign-in response came from an unexpected server.", redirectTo: row.redirectTo ?? undefined };
  if (input.error || !input.code) return { ok: false, message: "Sign-in was canceled.", redirectTo: row.redirectTo ?? undefined };

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: redirectUri(),
    client_id: d.clientId,
    code_verifier: row.codeVerifier ?? "",
    resource: d.resource,
  });
  if (d.clientSecret) form.set("client_secret", d.clientSecret);
  const res = await publicFetch(d.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: form.toString(),
    timeoutMs: 15000,
  }).catch((err) => {
    if (err instanceof UnsafeUrlError) return null;
    throw err;
  });
  if (!res) return { ok: false, message: "The app's sign-in points somewhere it can't go.", redirectTo: row.redirectTo ?? undefined };
  if (!res.ok) return { ok: false, message: `The app refused the sign-in (${res.status}).`, redirectTo: row.redirectTo ?? undefined };
  const tok = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string };
  if (!tok.access_token) return { ok: false, message: "No access token came back.", redirectTo: row.redirectTo ?? undefined };

  const tokens: TokenSet = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: tok.expires_in ? Date.now() + tok.expires_in * 1000 : undefined,
    scope: tok.scope,
    token_type: tok.token_type,
  };
  const credentialId = await storeCredential(db, {
    ownerId: row.ownerId,
    kind: "oauth",
    provider: row.connectorId ?? "mcp",
    secret: JSON.stringify(tokens),
    label: "MCP sign-in",
    meta: {
      issuer: d.issuer,
      tokenEndpoint: d.tokenEndpoint,
      revocationEndpoint: d.revocationEndpoint,
      clientId: d.clientId,
      clientSecret: d.clientSecret,
      resource: d.resource,
    },
    expiresAt: tokens.expires_at ? new Date(tokens.expires_at) : null,
  });
  await db
    .update(schema.connections)
    .set({ credentialId, status: "connected", mode: "mcp", error: null, updatedAt: new Date() })
    .where(eq(schema.connections.id, d.connectionId));
  return { ok: true, redirectTo: row.redirectTo ?? "/app", connectionId: d.connectionId };
}

/** Token (and headers) to call this connection's MCP server, refreshing OAuth tokens when needed. */
export async function connectionAuth(db: Db, conn: Connection): Promise<{ token: string | null; headers?: Record<string, string> }> {
  const cfg = conn.config as { auth?: string; headers?: Record<string, string> };
  if (!conn.credentialId) return { token: null, headers: cfg.headers };
  const [cred] = await db.select().from(schema.credentials).where(eq(schema.credentials.id, conn.credentialId)).limit(1);
  if (!cred) return { token: null, headers: cfg.headers };
  const secret = await readCredential(db, conn.credentialId);
  if (!secret) return { token: null, headers: cfg.headers };
  if (cred.kind !== "oauth") return { token: secret, headers: cfg.headers };

  let tokens: TokenSet;
  try {
    tokens = JSON.parse(secret) as TokenSet;
  } catch {
    return { token: null };
  }
  const meta = cred.meta as { tokenEndpoint?: string; clientId?: string; clientSecret?: string | null; resource?: string };
  if (tokens.expires_at && tokens.expires_at < Date.now() + 60_000 && tokens.refresh_token && meta.tokenEndpoint && meta.clientId) {
    const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: meta.clientId });
    if (meta.resource) form.set("resource", meta.resource);
    if (meta.clientSecret) form.set("client_secret", meta.clientSecret);
    try {
      const res = await publicFetch(meta.tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: form.toString(),
        timeoutMs: 15000,
      });
      if (res.ok) {
        const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
        tokens = {
          access_token: t.access_token,
          refresh_token: t.refresh_token ?? tokens.refresh_token,
          expires_at: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined,
          scope: t.scope ?? tokens.scope,
        };
        await replaceCredential(db, cred.id, JSON.stringify(tokens), tokens.expires_at ? new Date(tokens.expires_at) : null);
      }
    } catch {
      /* use the old token; the server will 401 if it's dead */
    }
  }
  return { token: tokens.access_token, headers: cfg.headers };
}

/** Connect with a pasted token (PAT / API key) instead of OAuth. */
export async function connectWithToken(db: Db, input: { ownerId: string; connection: Connection; token: string }) {
  const credentialId = await storeCredential(db, {
    ownerId: input.ownerId,
    kind: "api_key",
    provider: input.connection.connectorId,
    secret: input.token.trim(),
    label: "Access token",
  });
  await db
    .update(schema.connections)
    .set({ credentialId, status: "connected", mode: "mcp", error: null, updatedAt: new Date() })
    .where(eq(schema.connections.id, input.connection.id));
  return credentialId;
}
