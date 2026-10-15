/**
 * Apps & trust outside demo mode: the plan's apps-per-bot limit holds after the bot is made
 * (built-ins and switched-off apps don't count), and an app whose sign-in can't be reached
 * says so plainly.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "0";
delete process.env.DATABASE_URL;
for (const key of ["COMPOSIO_API_KEY", "STRIPE_SECRET_KEY", "MCP_OAUTH_CLIENTS", "TOKEN_FACTORY_API_KEY"]) delete process.env[key];

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => session.user,
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { PLANS } = await import("@/lib/billing/plans");
const connectionsRoute = await import("@/app/api/bots/[botId]/connections/route");
const connectRoute = await import("@/app/api/bots/[botId]/connections/[connectionId]/connect/route");
import type { Bot, User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;

const post = (url: string, body: unknown) => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function addApp(botId: string, connectorId: string) {
  const res = await connectionsRoute.POST(post(`http://localhost/api/bots/${botId}/connections`, { connectorId }), { params: Promise.resolve({ botId }) });
  return { status: res.status, data: (await res.json()) as { connection?: { id: string }; error?: string } };
}

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner] = await db.insert(schema.users).values({ id: "usr_free", email: "free@example.com", emailVerifiedAt: new Date(), timezone: "UTC", plan: "free" }).returning();
  session.user = owner;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await resetDbForTests();
});

async function makeBot(): Promise<Bot> {
  const res = await createBot(db, owner, {
    avatar: "blip",
    color: "grape",
    name: "Juggler",
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

describe("apps on the Free plan", () => {
  it("connects as many apps as the plan says; built-ins and switched-off apps don't count", async () => {
    expect(PLANS.free.limits.connectors).toBe(3);
    const bot = await makeBot();
    for (const app of ["notion", "linear", "todoist"]) expect((await addApp(bot.id, app)).status).toBe(200);
    expect((await addApp(bot.id, "wikipedia")).status).toBe(200); // a built-in

    const fourth = await addApp(bot.id, "calendly");
    expect(fourth.status).toBe(402);
    expect(fourth.data.error).toBe("The Free plan connects 3 apps. Paid plans are coming soon.");

    // Asking for one it already has isn't a new app.
    expect((await addApp(bot.id, "notion")).status).toBe(200);

    // Switching one off frees its place.
    await db.update(schema.connections).set({ status: "disabled" }).where(and(eq(schema.connections.botId, bot.id), eq(schema.connections.connectorId, "linear")));
    expect((await addApp(bot.id, "calendly")).status).toBe(200);
  });

  it("an app whose sign-in can't be reached says so", async () => {
    const [bot] = await db.select().from(schema.bots).where(eq(schema.bots.ownerId, owner.id));
    const [notion] = await db.select().from(schema.connections).where(and(eq(schema.connections.botId, bot.id), eq(schema.connections.connectorId, "notion")));
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const res = await connectRoute.POST(post(`http://localhost/api/bots/${bot.id}/connections/${notion.id}/connect`, { method: "oauth" }), {
      params: Promise.resolve({ botId: bot.id, connectionId: notion.id }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await res.json()).error).toBe("Couldn't reach Notion. Try again in a moment.");
  });
});
