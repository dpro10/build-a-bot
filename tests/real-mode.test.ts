/**
 * Outside demo mode (what testers get), nothing may pretend to work: built-ins whose service
 * isn't set up are "coming soon", an app is only connected once it's really signed in (or the
 * catalog says it needs no sign-in), and the bot says plainly what isn't there yet.
 * A fake MCP server stands in for the vendors'.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "0";
delete process.env.DATABASE_URL;
// Nothing set up: no Token Factory, Browser Use, Tavily, speech-to-text, Composio or Stripe.
for (const key of ["TOKEN_FACTORY_API_KEY", "BROWSER_USE_API_KEY", "TAVILY_API_KEY", "TRANSCRIBE_API_KEY", "COMPOSIO_API_KEY", "STRIPE_SECRET_KEY", "MCP_OAUTH_CLIENTS"]) {
  delete process.env[key];
}

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => session.user,
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { runTurn } = await import("@/lib/agent/run");
const { ensureConversation } = await import("@/lib/channels/outbound");
const { checkSpend, recordUsage } = await import("@/lib/billing/usage");
const { FAIR_USE } = await import("@/lib/billing/prices");
const { buildToolset } = await import("@/lib/tools/registry");
const { webSearch } = await import("@/lib/tools/builtin/web");
const { comingSoonConnectors } = await import("@/lib/connectors/availability");
const connectionsRoute = await import("@/app/api/bots/[botId]/connections/route");
const connectRoute = await import("@/app/api/bots/[botId]/connections/[connectionId]/connect/route");
import type { AgentEvent } from "@/lib/agent/run";
import type { Bot, User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;

async function makeBot(name: string, connectors: string[] = []): Promise<Bot> {
  const res = await createBot(db, owner, {
    avatar: "blip",
    color: "grape",
    name,
    jobs: [],
    brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
    connectors,
    exactConnectors: true,
    trust: "ask",
    channels: [],
    contact: {},
    ageConfirmed: true,
    timezone: "UTC",
  });
  if (!res.ok) throw new Error(res.error);
  return res.bot;
}

const post = (url: string, body: unknown) => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function addApp(botId: string, body: Record<string, unknown>) {
  const res = await connectionsRoute.POST(post(`http://localhost/api/bots/${botId}/connections`, body), { params: Promise.resolve({ botId }) });
  return { status: res.status, data: (await res.json()) as { connection?: { id: string }; error?: string } };
}

async function connect(botId: string, connectionId: string) {
  const res = await connectRoute.POST(post(`http://localhost/api/bots/${botId}/connections/${connectionId}/connect`, { method: "oauth" }), {
    params: Promise.resolve({ botId, connectionId }),
  });
  return { status: res.status, data: (await res.json()) as { connected?: boolean; tools?: number; redirect?: string; error?: string } };
}

const row = async (id: string) => (await db.select().from(schema.connections).where(eq(schema.connections.id, id)))[0];

// --- A fake remote MCP server (Streamable HTTP, JSON replies) ---------------------------------

type Handler = (req: { method: string; rpc: { id?: number; method?: string } | null; headers: Headers }) => Response;

const TOOLS = [
  { name: "search_threads", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
  { name: "send_message", inputSchema: { type: "object", properties: {} } },
];

/**
 * Like Google's MCP servers: an unsigned `initialize` gets 200 and, with `listsToolsUnsigned`,
 * so does tools/list. Everything else needs a token.
 */
function mcpServer(opts: { listsToolsUnsigned: boolean }): Handler {
  return ({ rpc, headers }) => {
    const signedIn = Boolean(headers.get("authorization"));
    if (rpc?.method === "initialize") {
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1.0.0" } } });
    }
    if (rpc?.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (rpc?.method === "tools/list" && (signedIn || opts.listsToolsUnsigned)) return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { tools: TOOLS } });
    if (!signedIn) return new Response("Unauthorized", { status: 401 });
    return Response.json({ jsonrpc: "2.0", id: rpc?.id, result: { content: [{ type: "text", text: "ok" }] } });
  };
}

/** Routes requests by URL; anything else is a 404. Returns a log of "METHOD url rpc-method". */
function stubNet(routes: Record<string, Handler>): string[] {
  const log: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    let rpc: { id?: number; method?: string } | null = null;
    try {
      rpc = typeof init.body === "string" ? JSON.parse(init.body) : null;
    } catch {
      rpc = null;
    }
    const method = init.method ?? "GET";
    log.push(`${method} ${url}${rpc?.method ? ` ${rpc.method}` : ""}`);
    const handler = routes[url];
    return handler ? handler({ method, rpc, headers: new Headers(init.headers) }) : new Response("Not found", { status: 404 });
  });
  return log;
}

const json = (data: unknown): Handler => () => Response.json(data);

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner] = await db.insert(schema.users).values({ id: "usr_live", email: "live@example.com", emailVerifiedAt: new Date(), timezone: "UTC" }).returning();
  session.user = owner;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("built-ins whose service isn't set up are coming soon", () => {
  it("lists them, and not the ones that need no key", () => {
    const soon = comingSoonConnectors();
    expect(soon).toEqual(expect.arrayContaining(["browser", "web_search", "news", "meetings"]));
    for (const id of ["memory", "reminders", "weather", "currency", "notes", "web_reader", "wikipedia"]) expect(soon).not.toContain(id);
  });

  it("web actions can't be added in Apps & trust", async () => {
    const bot = await makeBot("Errand");
    const res = await addApp(bot.id, { connectorId: "browser" });
    expect(res.status).toBe(409);
    expect(res.data.error).toBe("Web actions is coming soon.");
    const rows = await db.select().from(schema.connections).where(and(eq(schema.connections.botId, bot.id), eq(schema.connections.connectorId, "browser")));
    expect(rows).toHaveLength(0);
    // A built-in that works here still adds.
    expect((await addApp(bot.id, { connectorId: "wikipedia" })).status).toBe(200);
  });

  it("the builder leaves them out", async () => {
    const bot = await makeBot("Runner", ["browser", "web_search", "notes"]);
    const ids = (await db.select().from(schema.connections).where(eq(schema.connections.botId, bot.id))).map((c) => c.connectorId);
    expect(ids).toContain("notes");
    expect(ids).not.toContain("browser");
    expect(ids).not.toContain("web_search");
  });

  it("one added before gives the bot no tools to promise with", async () => {
    const bot = await makeBot("Legacy");
    await db.insert(schema.connections).values({ id: "con_old_browser", botId: bot.id, connectorId: "browser", mode: "builtin", status: "connected" });
    const toolset = await buildToolset({ db, bot, owner, conversationId: null, channelKind: "web", demo: false, now: new Date() });
    const names = toolset.tools.map((t) => t.name);
    expect(names).not.toContain("web_browse");
    expect(names).not.toContain("web_form_fill");
    expect(names).toContain("remember"); // the always-on built-ins are still there
  });
});

describe("connecting an app over MCP", () => {
  const GMAIL = "https://gmailmcp.googleapis.com/mcp/v1";

  it("a server that answers an unsigned initialize (like Google's) isn't marked connected without a sign-in", async () => {
    const bot = await makeBot("Mailer");
    // Composio isn't set up, so Gmail goes to Google's MCP server.
    const added = await addApp(bot.id, { connectorId: "gmail" });
    expect(added.status).toBe(200);
    const id = added.data.connection!.id;
    expect((await row(id)).status).toBe("needs_auth");

    const log = stubNet({ [GMAIL]: mcpServer({ listsToolsUnsigned: true }) });
    const res = await connect(bot.id, id);
    expect(res.status).toBe(409);
    expect(res.data.connected).toBeUndefined();
    expect(res.data.error).toMatch(/sign-in/);
    const after = await row(id);
    expect(after.status).toBe("needs_auth");
    expect(after.credentialId).toBeNull();
    // It looked for the sign-in instead of trusting the reply.
    expect(log).toContain("GET https://gmailmcp.googleapis.com/.well-known/oauth-protected-resource/mcp/v1");
    expect(log.some((l) => l.endsWith("tools/list"))).toBe(false);
  });

  it("where the server publishes its sign-in, it goes there", async () => {
    const bot = await makeBot("Mailer two");
    const id = (await addApp(bot.id, { connectorId: "gmail" })).data.connection!.id;
    const AUTH = "https://auth.example.test";
    stubNet({
      [GMAIL]: mcpServer({ listsToolsUnsigned: true }),
      "https://gmailmcp.googleapis.com/.well-known/oauth-protected-resource/mcp/v1": json({ resource: GMAIL, authorization_servers: [AUTH] }),
      [`${AUTH}/.well-known/oauth-authorization-server`]: json({
        issuer: AUTH,
        authorization_endpoint: `${AUTH}/authorize`,
        token_endpoint: `${AUTH}/token`,
        registration_endpoint: `${AUTH}/register`,
        code_challenge_methods_supported: ["S256"],
      }),
      [`${AUTH}/register`]: json({ client_id: "client-123" }),
    });
    const res = await connect(bot.id, id);
    expect(res.status).toBe(200);
    expect(res.data.connected).toBeUndefined();
    const redirect = new URL(res.data.redirect!);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(`${AUTH}/authorize`);
    expect(redirect.searchParams.get("client_id")).toBe("client-123");
    expect(redirect.searchParams.get("resource")).toBe(GMAIL);
    expect((await row(id)).status).toBe("needs_auth");
    const states = await db.select().from(schema.oauthStates).where(eq(schema.oauthStates.botId, bot.id));
    expect(states).toHaveLength(1);
  });

  it("an app the catalog lists as needing no sign-in connects once its tools load", async () => {
    const bot = await makeBot("Reader");
    const id = (await addApp(bot.id, { connectorId: "deepwiki" })).data.connection!.id;
    stubNet({ "https://mcp.deepwiki.com/mcp": mcpServer({ listsToolsUnsigned: true }) });
    const res = await connect(bot.id, id);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ connected: true, tools: 2 });
    const after = await row(id);
    expect(after.status).toBe("connected");
    expect(after.mode).toBe("mcp");
  });

  it("a server you add yourself connects without a sign-in only if it lets us in and offers none", async () => {
    const bot = await makeBot("Tinkerer");
    const open = (await addApp(bot.id, { connectorId: "custom_mcp", url: "https://open.example.test/mcp" })).data.connection!.id;
    const closed = (await addApp(bot.id, { connectorId: "custom_mcp", url: "https://closed.example.test/mcp" })).data.connection!.id;
    stubNet({
      "https://open.example.test/mcp": mcpServer({ listsToolsUnsigned: true }),
      "https://closed.example.test/mcp": mcpServer({ listsToolsUnsigned: false }),
    });

    const ok = await connect(bot.id, open);
    expect(ok.data).toEqual({ connected: true, tools: 2 });
    expect((await row(open)).status).toBe("connected");

    // Answers initialize, then wants a token for anything real: not connected.
    const refused = await connect(bot.id, closed);
    expect(refused.status).toBe(409);
    expect(refused.data.error).toMatch(/access token/);
    expect((await row(closed)).status).toBe("needs_auth");
  });
});

describe("what isn't set up is said plainly, once", () => {
  async function say(bot: Bot, who: User, text: string) {
    const events: AgentEvent[] = [];
    const conversation = await ensureConversation(db, bot.id, "web", "owner");
    const res = await runTurn({ db, bot, owner: who, conversation, channelKind: "web", message: { text, author: "owner" }, emit: (e) => events.push(e) });
    return { res, notices: events.filter((e) => e.type === "notice") };
  }

  it("without Token Factory, the open models we run are coming soon", async () => {
    const bot = await makeBot("Thinker");
    const { res, notices } = await say(bot, owner, "hi");
    expect(res.status).toBe("unavailable");
    expect(res.text).toBe("I can't think right now. The open models we run are coming soon. Until then, switch me to your own AI key in Settings → Brain.");
    expect(notices).toEqual([]);
  });

  it("without Tavily, web search tells the model it's coming soon", async () => {
    const bot = await makeBot("Searcher");
    const out = await webSearch.run({ query: "weather in Austin" }, { db, bot, owner, conversationId: null, channelKind: "web", demo: false, now: new Date() });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error).toMatch(/^Web search is coming soon\. Answer from what you already know/);
  });

  it("the fair-use limit on your own AI says when it resets, and nothing about credit", async () => {
    const [keyed] = await db.insert(schema.users).values({ id: "usr_fair_use", email: "keyed@example.com", emailVerifiedAt: new Date(), timezone: "UTC" }).returning();
    const made = await createBot(db, keyed, {
      avatar: "otto",
      color: "grape",
      name: "Keyed",
      jobs: [],
      brain: { kind: "byok", provider: "openai", model: "gpt-6.1-sol", apiKey: "sk-test-not-a-real-key-1234567890" },
      connectors: [],
      trust: "ask",
      channels: [],
      contact: {},
      ageConfirmed: true,
      timezone: "UTC",
    });
    if (!made.ok) throw new Error(made.error);
    await recordUsage(db, keyed.id, { messages: FAIR_USE.ownBrainMessages });
    const limit = await checkSpend(db, keyed, "ownBrain");
    if (limit.ok) throw new Error("expected the fair-use limit to be reached");
    expect(limit.code).toBe("fair_use");
    const { res, notices } = await say(made.bot, keyed, "hi");
    expect(res.status).toBe("limited");
    // The limit, and nothing about credit (or switching to its own key: it's on one).
    expect(res.text).toBe("You've sent 100,000 messages on your own AI this month, the fair-use limit. It resets on the 1st.");
    expect(notices).toEqual([]);
  });
});
