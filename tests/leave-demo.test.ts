/**
 * Leaving demo mode (DEMO_MODE off on a server that ran with it): apps connected with sample data
 * stop serving it and ask for a real sign-in, channels that ran simulated go back to "set up"
 * with their stand-in addresses gone, and nothing real is touched (in-memory Postgres).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "0";
for (const name of ["DATABASE_URL", "COMPOSIO_API_KEY"]) delete process.env[name];

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { leaveDemoMode } = await import("@/lib/bots/demo-leftovers");
const { housekeeping } = await import("@/lib/scheduler/tick");
const { buildToolset } = await import("@/lib/tools/registry");
import type { Bot, User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;
let bot: Bot;

const ctx = () => ({ db, bot, owner, conversationId: null, channelKind: "web" as const, demo: false, now: new Date() });
const connection = async (id: string) => (await db.select().from(schema.connections).where(eq(schema.connections.id, id)))[0];
const channel = async (id: string) => (await db.select().from(schema.channels).where(eq(schema.channels.id, id)))[0];

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner] = await db.insert(schema.users).values({ id: "usr_demo_left", email: "sam@example.com", emailVerifiedAt: new Date(), timezone: "UTC" }).returning();
  [bot] = await db
    .insert(schema.bots)
    .values({ id: "bot_demo_left", ownerId: owner.id, name: "Pip", handle: "pip-demo-left", avatar: "otto", color: "sky", trust: "ask", brain: { kind: "included", provider: "nebius", model: "nvidia/Nemotron-3_5-Lightning" } })
    .returning();
  await db.insert(schema.connections).values([
    // Connected in demo mode: sample data, no sign-in.
    { id: "con_notion", botId: bot.id, connectorId: "notion", mode: "demo", status: "demo", config: {} },
    { id: "con_gmail", botId: bot.id, connectorId: "gmail", mode: "demo", status: "demo", config: {} },
    // Connected for real, though its mode was never moved off "demo".
    { id: "con_linear", botId: bot.id, connectorId: "linear", mode: "demo", status: "connected", config: { url: "https://mcp.linear.app/mcp", auth: "oauth" } },
    // A real one, untouched.
    { id: "con_todo", botId: bot.id, connectorId: "todoist", mode: "mcp", status: "needs_auth", config: { url: "https://example.com/mcp" } },
  ]);
  await db.insert(schema.channels).values([
    { id: "chn_tg", botId: bot.id, kind: "telegram", status: "active", address: "@pip_bot", ownerAddress: "demo-telegram-user", ownerVerifiedAt: new Date(), config: { simulated: true, username: "@pip_bot" } },
    { id: "chn_sms", botId: bot.id, kind: "sms", status: "active", ownerAddress: "+15125550123", ownerVerifiedAt: new Date(), config: { simulated: true, pendingOwnerAddress: "+15125550123" } },
    { id: "chn_slack", botId: bot.id, kind: "slack", status: "active", address: "T0123", ownerAddress: "U0123", ownerVerifiedAt: new Date(), config: { teamName: "Lab" } },
  ]);
});

afterAll(async () => {
  await resetDbForTests();
});

describe("out of demo mode", () => {
  it("apps connected with sample data don't serve it", async () => {
    const toolset = await buildToolset(ctx());
    expect(toolset.apps.map((a) => a.name).join(" ")).not.toMatch(/demo data/);
    expect(toolset.tools.some((t) => /notion|gmail/i.test(t.name))).toBe(false);
  });

  it("simulated apps ask for a real sign-in, simulated channels for a real setup, and real ones stay as they are", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await leaveDemoMode(db)).toEqual({ apps: 3, channels: 2 });
    expect(log.mock.calls.map((c) => c.join(" ")).join("\n")).toMatch(/3 simulated apps now need a real sign-in, 2 simulated channels a real setup/);
    log.mockRestore();

    // Signed in to through the app's own sign-in (MCP), as if added now.
    expect(await connection("con_notion")).toMatchObject({ status: "needs_auth", mode: "mcp", config: { url: "https://mcp.notion.com/mcp" }, error: null });
    // No way to sign in to it here (Gmail goes through Composio, not set up): "coming soon" in Apps & trust.
    expect(await connection("con_gmail")).toMatchObject({ status: "needs_auth", mode: "mcp" });
    expect(await connection("con_linear")).toMatchObject({ status: "connected", mode: "mcp" });
    expect(await connection("con_todo")).toMatchObject({ status: "needs_auth", mode: "mcp", config: { url: "https://example.com/mcp" } });

    expect(await channel("chn_tg")).toMatchObject({ status: "needs_setup", address: null, ownerAddress: null, ownerVerifiedAt: null, config: {} });
    expect(await channel("chn_sms")).toMatchObject({ status: "needs_setup", ownerAddress: null, config: { pendingOwnerAddress: "+15125550123" } });
    expect(await channel("chn_slack")).toMatchObject({ status: "active", address: "T0123", ownerAddress: "U0123", config: { teamName: "Lab" } });
  });

  it("does it once, from housekeeping", async () => {
    await db.insert(schema.connections).values({ id: "con_late", botId: bot.id, connectorId: "asana", mode: "demo", status: "demo", config: {} });
    await housekeeping(db);
    expect(await connection("con_late")).toMatchObject({ status: "needs_auth", mode: "mcp" });
    expect(await leaveDemoMode(db)).toEqual({ apps: 0, channels: 0 });
  });
});

describe("in demo mode", () => {
  it("leaves simulated apps and channels alone", async () => {
    await db.insert(schema.connections).values({ id: "con_demo", botId: bot.id, connectorId: "trello", mode: "demo", status: "demo", config: {} });
    vi.resetModules();
    process.env.DEMO_MODE = "1";
    try {
      const inDemo = await import("@/lib/bots/demo-leftovers");
      expect(await inDemo.leaveDemoMode(db)).toEqual({ apps: 0, channels: 0 });
      expect(await connection("con_demo")).toMatchObject({ status: "demo", mode: "demo" });
    } finally {
      process.env.DEMO_MODE = "0";
    }
  });
});
