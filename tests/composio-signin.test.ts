/**
 * Signing in to apps through Composio, outside demo mode: only apps Composio can sign people in
 * to are offered, a one-click sign-in beats pasting a token, an app's own sign-in falls back to
 * Composio's, and Composio's callback identity check only activates the owner's own sign-in.
 * A fake Composio API stands in for the real one.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "0";
process.env.COMPOSIO_API_KEY = "test-composio-key";
delete process.env.COMPOSIO_BASE_URL;
delete process.env.DATABASE_URL;
for (const key of ["TOKEN_FACTORY_API_KEY", "BROWSER_USE_API_KEY", "TAVILY_API_KEY", "TRANSCRIBE_API_KEY", "STRIPE_SECRET_KEY", "MCP_OAUTH_CLIENTS"]) {
  delete process.env[key];
}

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => session.user,
}));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/headers")>()),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (opts: string | { name: string }) => void jar.delete(typeof opts === "string" ? opts : opts.name),
  }),
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { comingSoonConnectors } = await import("@/lib/connectors/availability");
const { composioCanConnect } = await import("@/lib/connectors/composio-auth");
const { COMPOSIO_PENDING_COOKIE } = await import("@/lib/connectors/composio");
const connectionsRoute = await import("@/app/api/bots/[botId]/connections/route");
const connectRoute = await import("@/app/api/bots/[botId]/connections/[connectionId]/connect/route");
const verifyRoute = await import("@/app/api/connectors/composio/verify/route");
import type { Bot, User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;
let stranger: User;

const API = "https://backend.composio.dev/api/v3.1";
const post = (url: string, body: unknown) => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function makeBot(name: string): Promise<Bot> {
  const res = await createBot(db, owner, {
    avatar: "blip",
    color: "grape",
    name,
    jobs: [],
    brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
    connectors: [],
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

async function addApp(botId: string, connectorId: string) {
  const res = await connectionsRoute.POST(post(`http://localhost/api/bots/${botId}/connections`, { connectorId }), { params: Promise.resolve({ botId }) });
  return { status: res.status, data: (await res.json()) as { connection?: { id: string; mode: string; config: Record<string, unknown> }; error?: string } };
}

async function connect(botId: string, connectionId: string, method: "oauth" | "composio") {
  const res = await connectRoute.POST(post(`http://localhost/api/bots/${botId}/connections/${connectionId}/connect`, { method }), {
    params: Promise.resolve({ botId, connectionId }),
  });
  return { status: res.status, data: (await res.json()) as { redirect?: string; error?: string } };
}

const verify = (sessionUri: string) => verifyRoute.GET(new Request(`http://localhost/api/connectors/composio/verify?session_uri=${sessionUri}`));

/** A fake Composio API (and nothing else on the network). Returns a log of "METHOD url body". */
function stubComposio(): string[] {
  const log: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init.method ?? "GET";
    log.push(`${method} ${url}${typeof init.body === "string" ? ` ${init.body}` : ""}`);
    const slug = /toolkit_slug=([a-z_]+)/.exec(url)?.[1];
    if (method === "GET" && url.startsWith(`${API}/auth_configs?`)) return Response.json({ items: [{ id: `ac_${slug}`, toolkit: { slug } }] });
    if (method === "POST" && url === `${API}/connected_accounts/link`) return Response.json({ redirect_url: "https://connect.composio.dev/link/lk_1", connected_account_id: "ca_1" });
    if (method === "POST" && url === `${API}/connected_accounts/complete_auth`) return Response.json({ connected_account_id: "ca_1", toolkit_slug: "gmail" });
    if (method === "GET" && url === `${API}/connected_accounts/ca_1`) return Response.json({ status: "ACTIVE" });
    return new Response("Not found", { status: 404 });
  });
  return log;
}

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner, stranger] = await db
    .insert(schema.users)
    .values([
      { id: "usr_owner", email: "owner@example.com", emailVerifiedAt: new Date(), timezone: "UTC", plan: "pro" },
      { id: "usr_stranger", email: "stranger@example.com", emailVerifiedAt: new Date(), timezone: "UTC", plan: "pro" },
    ])
    .returning();
});

afterEach(() => {
  vi.unstubAllGlobals();
  jar.clear();
  session.user = owner;
});

afterAll(async () => {
  await resetDbForTests();
});

describe("which apps can be signed in to", () => {
  it("apps Composio has no sign-in of its own for are coming soon, unless an auth config is set up", () => {
    const soon = comingSoonConnectors();
    expect(soon).toEqual(expect.arrayContaining(["spotify", "twitter", "shopify"]));
    for (const id of ["gmail", "google_calendar", "slack", "notion", "github"]) expect(soon).not.toContain(id);

    expect(composioCanConnect("spotify")).toBe(false);
    process.env.COMPOSIO_AUTH_CONFIG_SPOTIFY = "ac_our_own_spotify_app";
    expect(composioCanConnect("spotify")).toBe(true);
    delete process.env.COMPOSIO_AUTH_CONFIG_SPOTIFY;
  });

  it("refuses to add one", async () => {
    session.user = owner;
    const bot = await makeBot("Listener");
    const res = await addApp(bot.id, "spotify");
    expect(res.status).toBe(409);
    expect(res.data.error).toBe("Spotify is coming soon.");
  });

  it("GitHub uses Composio's one-click sign-in instead of a pasted token", async () => {
    session.user = owner;
    const bot = await makeBot("Coder");
    const res = await addApp(bot.id, "github");
    expect(res.status).toBe(200);
    expect(res.data.connection).toMatchObject({ mode: "composio", config: { toolkit: "github" } });
  });
});

describe("Composio's sign-in", () => {
  it("starts on Composio and remembers, in this browser only, whose sign-in it is", async () => {
    session.user = owner;
    const log = stubComposio();
    const bot = await makeBot("Mailer");
    const id = (await addApp(bot.id, "gmail")).data.connection!.id;
    const res = await connect(bot.id, id, "composio");
    expect(res.data.redirect).toBe("https://connect.composio.dev/link/lk_1");
    expect(jar.get(COMPOSIO_PENDING_COOKIE)).toBe(id);
    expect(log.some((l) => l.startsWith(`POST ${API}/connected_accounts/link`) && l.includes(`"user_id":"${bot.id}"`))).toBe(true);
  });

  it("the identity check activates the owner's own sign-in", async () => {
    session.user = owner;
    const log = stubComposio();
    const bot = await makeBot("Scheduler");
    const id = (await addApp(bot.id, "google_calendar")).data.connection!.id;
    await connect(bot.id, id, "composio");

    const res = await verify("su_owner");
    expect(log).toContain(`POST ${API}/connected_accounts/complete_auth ${JSON.stringify({ user_id: bot.id, session_uri: "su_owner" })}`);
    expect(res.headers.get("location")).toMatch(new RegExp(`/app/bots/${bot.id}/tools\\?connected=1$`));
    const [row] = await db.select().from(schema.connections).where(eq(schema.connections.id, id));
    expect(row.status).toBe("connected");
    expect(jar.has(COMPOSIO_PENDING_COOKIE)).toBe(false);
  });

  it("someone who was sent a copied sign-in link can't complete it", async () => {
    session.user = owner;
    const log = stubComposio();
    const bot = await makeBot("Target");
    const id = (await addApp(bot.id, "gmail")).data.connection!.id;
    await connect(bot.id, id, "composio");

    // Another browser: no cookie.
    jar.clear();
    let res = await verify("su_other_browser");
    expect(res.headers.get("location")).toMatch(/\/app$/);

    // The same browser, but someone else signed in.
    jar.set(COMPOSIO_PENDING_COOKIE, id);
    session.user = stranger;
    res = await verify("su_stranger");
    expect(res.headers.get("location")).toMatch(/\/app$/);

    expect(log.some((l) => l.includes("complete_auth"))).toBe(false);
    const [row] = await db.select().from(schema.connections).where(eq(schema.connections.id, id));
    expect(row.status).toBe("needs_auth");
  });

  it("when an app's own sign-in doesn't work out, Composio's is used", async () => {
    session.user = owner;
    const log = stubComposio(); // Notion's MCP server isn't reachable here: its sign-in can't be discovered.
    const bot = await makeBot("Writer");
    const added = await addApp(bot.id, "notion");
    expect(added.data.connection).toMatchObject({ mode: "mcp" });
    const res = await connect(bot.id, added.data.connection!.id, "oauth");
    expect(res.data.redirect).toBe("https://connect.composio.dev/link/lk_1");
    expect(log.some((l) => l.startsWith(`GET ${API}/auth_configs?toolkit_slug=notion`))).toBe(true);
  });
});
