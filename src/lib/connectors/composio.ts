/**
 * Composio: managed OAuth + ready-made tools for hundreds of apps (Gmail, Calendar,
 * Drive, Slack, Notion...). Each bot is a Composio "user" (user_id = bot id), so
 * connections are per bot. Every tool call still goes through our policy engine.
 *
 * API v3.1 (docs/research/integrations-2026-10-14.md §9).
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Connection } from "@/lib/db/schema";
import { config } from "@/lib/env";
import type { ConnectorDef } from "./types";
import { safeToolName, type AnyToolSpec, type ToolContext } from "@/lib/tools/types";
import { classifyTool, extractEmails } from "./mcp/effects";
import { fetchWithTimeout } from "@/lib/tools/net";
import { truncate } from "@/lib/utils";

const BASE = () => `${config.composio.baseUrl.replace(/\/$/, "")}/api/v3.1`;
const TOOLS_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_TOOLS = 20;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetchWithTimeout(`${BASE()}${path}`, {
    method,
    headers: { "x-api-key": config.composio.apiKey ?? "", "content-type": "application/json", accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    timeoutMs: 30000,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } | string; message?: string };
  if (!res.ok) {
    const msg = typeof data.error === "string" ? data.error : (data.error?.message ?? data.message ?? `Composio ${res.status}`);
    throw new Error(msg);
  }
  return data;
}

const authConfigCache = new Map<string, string>();

/** Auth config for a toolkit: env override, an existing one, or a new Composio-managed one. */
export async function authConfigFor(toolkit: string): Promise<string> {
  const envKey = `COMPOSIO_AUTH_CONFIG_${toolkit.toUpperCase()}`;
  if (process.env[envKey]) return process.env[envKey]!;
  const cached = authConfigCache.get(toolkit);
  if (cached) return cached;
  const list = await call<{ items?: { id: string; toolkit?: { slug?: string } }[] }>("GET", `/auth_configs?toolkit_slug=${encodeURIComponent(toolkit)}`);
  let id = list.items?.find((i) => i.toolkit?.slug === toolkit)?.id ?? list.items?.[0]?.id;
  if (!id) {
    const created = await call<{ auth_config?: { id: string }; id?: string }>("POST", "/auth_configs", {
      toolkit: { slug: toolkit },
      auth_config: { type: "use_composio_managed_auth" },
    });
    id = created.auth_config?.id ?? created.id;
  }
  if (!id) throw new Error(`Couldn't set up ${toolkit} sign-in`);
  authConfigCache.set(toolkit, id);
  return id;
}

/** Start the hosted Connect flow; returns the URL to send the owner to. */
export async function startComposioConnection(db: Db, conn: Connection, callbackUrl: string): Promise<string> {
  const toolkit = String((conn.config as { toolkit?: string }).toolkit ?? "");
  if (!toolkit) throw new Error("This connector has no Composio toolkit");
  const authConfigId = await authConfigFor(toolkit);
  const link = await call<{ redirect_url?: string; redirectUrl?: string; connected_account_id?: string; id?: string }>("POST", "/connected_accounts/link", {
    auth_config_id: authConfigId,
    user_id: conn.botId,
    callback_url: callbackUrl,
  });
  const redirect = link.redirect_url ?? link.redirectUrl;
  const accountId = link.connected_account_id ?? link.id;
  if (!redirect || !accountId) throw new Error("Composio didn't return a sign-in link");
  await db
    .update(schema.connections)
    .set({ mode: "composio", status: "needs_auth", config: { ...conn.config, toolkit, accountId, authConfigId }, updatedAt: new Date() })
    .where(eq(schema.connections.id, conn.id));
  return redirect;
}

export async function refreshComposioStatus(db: Db, conn: Connection): Promise<Connection["status"]> {
  const accountId = (conn.config as { accountId?: string }).accountId;
  if (!accountId) return conn.status;
  const acct = await call<{ status?: string }>("GET", `/connected_accounts/${encodeURIComponent(accountId)}`);
  const status = acct.status === "ACTIVE" ? "connected" : acct.status === "INITIATED" || acct.status === "INITIALIZING" ? "needs_auth" : "error";
  await db
    .update(schema.connections)
    .set({ status, error: status === "error" ? `Composio: ${acct.status}` : null, updatedAt: new Date() })
    .where(eq(schema.connections.id, conn.id));
  return status;
}

type ComposioTool = { slug: string; name?: string; description?: string; input_parameters?: Record<string, unknown>; version?: string };

async function toolsFor(db: Db, conn: Connection): Promise<ComposioTool[]> {
  const cfg = conn.config as { toolkit?: string; toolsCache?: { at: number; tools: ComposioTool[] } };
  if (cfg.toolsCache && Date.now() - cfg.toolsCache.at < TOOLS_TTL_MS) return cfg.toolsCache.tools;
  const toolkit = cfg.toolkit ?? "";
  const data = await call<{ items?: ComposioTool[] }>("GET", `/tools?toolkit_slug=${encodeURIComponent(toolkit)}&toolkit_versions=latest&limit=60`);
  const tools = (data.items ?? []).map((t) => ({ slug: t.slug, name: t.name, description: t.description, input_parameters: t.input_parameters, version: t.version }));
  await db
    .update(schema.connections)
    .set({ config: { ...conn.config, toolsCache: { at: Date.now(), tools } } })
    .where(eq(schema.connections.id, conn.id));
  return tools;
}

export async function composioToolsForConnection(conn: Connection, def: ConnectorDef, ctx: ToolContext): Promise<AnyToolSpec[]> {
  let tools: ComposioTool[] = [];
  try {
    tools = await toolsFor(ctx.db, conn);
  } catch {
    return [];
  }
  const toolkit = String((conn.config as { toolkit?: string }).toolkit ?? def.id);
  const pinned = process.env[`COMPOSIO_TOOLKIT_VERSION_${toolkit.toUpperCase()}`];
  const prefix = safeToolName(def.id).slice(0, 20);
  const ranked = [...tools].sort((a, b) => Number(classifyTool(a.slug).effect !== "read") - Number(classifyTool(b.slug).effect !== "read"));
  return ranked.slice(0, MAX_TOOLS).map((tool) => {
    const { effect, risk } = classifyTool(tool.slug.replace(new RegExp(`^${toolkit}_`, "i"), ""));
    const params = tool.input_parameters && (tool.input_parameters as { type?: string }).type === "object" ? tool.input_parameters : { type: "object", properties: {} };
    const spec: AnyToolSpec = {
      name: safeToolName(`${prefix}__${tool.slug.toLowerCase().replace(new RegExp(`^${toolkit}_`, "i"), "")}`),
      title: tool.name ?? tool.slug,
      description: `${def.name} — ${(tool.description ?? tool.slug).slice(0, 1500)}`,
      input: z.record(z.string(), z.unknown()),
      jsonSchema: params,
      connectorId: def.id,
      capabilityId: def.capabilities.find((c) => c.effect === effect)?.id,
      effect,
      risk,
      sensitive: def.sensitive,
      taints: effect === "read",
      recipients:
        effect === "send" || effect === "admin"
          ? async (args, c) => {
              const emails = extractEmails(args);
              if (!emails.length) return [{ address: `${def.name} audience`, kind: def.id, isOwner: false, isKnownContact: false }];
              const known = await c.db.select({ address: schema.contacts.address }).from(schema.contacts).where(eq(schema.contacts.botId, c.bot.id));
              const knownSet = new Set(known.map((k) => k.address));
              return emails.map((address) => ({ address, kind: "email", isOwner: address === c.owner.email?.toLowerCase(), isKnownContact: knownSet.has(address) }));
            }
          : undefined,
      outboundText: (args) => JSON.stringify(args).slice(0, 20000),
      summarize: (args) => {
        const first = Object.entries(args).find(([, v]) => typeof v === "string" && v);
        return `${def.name}: ${tool.name ?? tool.slug}${first ? ` — “${String(first[1]).slice(0, 60)}”` : ""}`;
      },
      async run(args, c) {
        try {
          const res = await call<{ data?: unknown; error?: string | null; successful?: boolean }>("POST", `/tools/execute/${encodeURIComponent(tool.slug)}`, {
            user_id: c.bot.id,
            arguments: args,
            ...(pinned || tool.version ? { version: pinned ?? tool.version } : {}),
          });
          if (res.successful === false || res.error) return { ok: false, error: truncate(String(res.error ?? "The app reported an error."), 400) };
          return { ok: true, content: truncate(JSON.stringify(res.data ?? {}, null, 1), 12000), summary: "Done" };
        } catch (err) {
          return { ok: false, error: truncate((err as Error).message, 300) };
        }
      },
    };
    return spec;
  });
}
