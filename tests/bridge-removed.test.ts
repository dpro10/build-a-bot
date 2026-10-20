/**
 * The Bridge is gone (Diego, 2026-10-20): bots think with the included open models or the owner's
 * own API key, never with a Claude or ChatGPT plan on their computer. What stays is pairing for the
 * desktop app, which older versions of the app still talk to the old way until they update.
 */
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
delete process.env.DATABASE_URL;
delete process.env.TOKEN_FACTORY_API_KEY;

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBotSchema } = await import("@/lib/bots/create");
const { resolveBrain } = await import("@/lib/agent/brain");
const { INCLUDED_MODELS } = await import("@/lib/models/catalog");
const { sha256 } = await import("@/lib/crypto");
const { POST: heartbeat } = await import("@/app/api/bridge/heartbeat/route");
const { GET: desktopSession } = await import("@/app/api/desktop/session/route");
const { handleMcpRequest } = await import("@/lib/mcp-server");
import type { Bot, BrainConfig } from "@/lib/db/schema";

const DEFAULT_MODEL = INCLUDED_MODELS.find((m) => m.default)!;

let db: Awaited<ReturnType<typeof getDb>>;

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
});

afterAll(async () => {
  await resetDbForTests();
});

async function ownerWithBot(id: string, opts: { mcpToken?: string } = {}) {
  const [owner] = await db.insert(schema.users).values({ id, email: `${id}@example.com`, emailVerifiedAt: new Date(), timezone: "UTC" }).returning();
  const [bot] = await db
    .insert(schema.bots)
    .values({
      id: `bot_${id}`,
      ownerId: owner.id,
      name: "Juniper",
      avatar: "nimbus",
      color: "mint",
      brain: { kind: "included", provider: "nebius", model: DEFAULT_MODEL.id, effort: "low" },
      handle: `juniper-${id}`,
      mcpTokenHash: opts.mcpToken ? sha256(opts.mcpToken) : null,
    })
    .returning();
  return { owner, bot };
}

describe("the migration that removes it", () => {
  it("moves bots on a Claude or ChatGPT plan to the default open model, says so in Activity, and unpairs the terminal Bridge", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { readMigrationFiles } = await import("drizzle-orm/migrator");
    const migrations = readMigrationFiles({ migrationsFolder: path.join(process.cwd(), "drizzle") });
    const at = migrations.findIndex((m) => m.sql.some((q) => q.includes('DROP TABLE "bridge_jobs"')));
    expect(at).toBeGreaterThan(0);
    const pg = new PGlite();
    const run = async (statements: string[]) => {
      for (const q of statements) if (q.trim()) await pg.exec(q);
    };
    for (const m of migrations.slice(0, at)) await run(m.sql);

    // The day before: one bot on Claude Pro, one on its owner's API key, one on an open model.
    await pg.exec(`
      insert into users (id, email) values ('usr_plan', 'plan@example.com');
      insert into bots (id, owner_id, name, avatar, color, brain, handle) values
        ('bot_claude', 'usr_plan', 'Juniper', 'nimbus', 'mint', '{"kind":"subscription","provider":"claude-code","model":"opus","whenOffline":"wait"}', 'juniper-1'),
        ('bot_key', 'usr_plan', 'Kip', 'blip', 'ocean', '{"kind":"byok","provider":"anthropic","model":"claude-sonnet-5-5","credentialId":"crd_1"}', 'kip-1'),
        ('bot_open', 'usr_plan', 'Ollie', 'otto', 'grape', '{"kind":"included","provider":"nebius","model":"some/open-model","effort":"medium"}', 'ollie-1');
      insert into bridge_devices (id, owner_id, name, token_hash, platform, clis) values
        ('dev_terminal', 'usr_plan', 'Laptop', 'h1', 'darwin-arm64', '{"claude":"2.1.3"}'),
        ('dev_unknown', 'usr_plan', 'Old laptop', 'h2', null, '{}'),
        ('dev_app', 'usr_plan', 'Mac', 'h3', 'desktop-darwin-arm64', '{}');
      insert into bridge_jobs (id, owner_id, bot_id, input, expires_at) values ('job_1', 'usr_plan', 'bot_claude', '{}', now() + interval '1 hour');
    `);
    await run(migrations[at].sql);

    const bots = new Map((await pg.query<{ id: string; brain: BrainConfig }>("select id, brain from bots")).rows.map((b) => [b.id, b.brain]));
    expect(bots.get("bot_claude")).toEqual({ kind: "included", provider: "nebius", model: DEFAULT_MODEL.id, effort: "low" });
    expect(bots.get("bot_key")).toMatchObject({ kind: "byok", provider: "anthropic", credentialId: "crd_1" });
    expect(bots.get("bot_open")).toMatchObject({ kind: "included", model: "some/open-model", effort: "medium" });

    const receipts = (await pg.query<{ id: string; bot_id: string; owner_id: string; kind: string; title: string; detail: unknown }>("select * from receipts")).rows;
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ bot_id: "bot_claude", owner_id: "usr_plan", kind: "system", detail: { changed: ["brain"], brain: { kind: "included", model: DEFAULT_MODEL.id } } });
    expect(receipts[0].title.startsWith(`Brain: ${DEFAULT_MODEL.label}`)).toBe(true);
    expect(receipts[0].id).toMatch(/^rcp_[0-9a-f]{17}$/);

    const devices = (await pg.query<{ id: string; revoked_at: Date | null }>("select id, revoked_at from bridge_devices")).rows;
    expect(Object.fromEntries(devices.map((d) => [d.id, d.revoked_at !== null]))).toEqual({ dev_app: false, dev_terminal: true, dev_unknown: true });

    expect((await pg.query("select to_regclass('bridge_jobs') as t")).rows).toEqual([{ t: null }]);
    const gone = await pg.query(
      "select table_name, column_name from information_schema.columns where (table_name = 'bridge_devices' and column_name = 'clis') or (table_name = 'study_sets' and column_name = 'job_id')",
    );
    expect(gone.rows).toEqual([]);
    // Later migrations still apply on top.
    for (const m of migrations.slice(at + 1)) await run(m.sql);
    await pg.close();
  });
});

describe("bots", () => {
  it("a new bot can't pick a Claude or ChatGPT plan", () => {
    const base = { avatar: "blip", color: "ocean", name: "Kip", trust: "ask", ageConfirmed: true };
    expect(createBotSchema.safeParse({ ...base, brain: { kind: "included", model: DEFAULT_MODEL.id } }).success).toBe(true);
    expect(createBotSchema.safeParse({ ...base, brain: { kind: "subscription", subscription: "claude" } }).success).toBe(false);
  });

  it("a bot somehow still marked as on a plan thinks with the default open model, instead of waiting for a computer", async () => {
    const bot = { id: "bot_left", ownerId: "usr_left", brain: { kind: "subscription", provider: "claude-code", model: "opus" } } as unknown as Bot;
    expect(await resolveBrain(db, bot)).toMatchObject({ kind: "llm", included: true, label: expect.stringContaining(DEFAULT_MODEL.label) });
  });
});

describe("older desktop apps, until they update", () => {
  it("their heartbeat still answers, with nothing to do, and keeps the computer online", async () => {
    const { owner } = await ownerWithBot("usr_beat");
    const token = `bab_dev_${"h".repeat(40)}`;
    await db.insert(schema.bridgeDevices).values({ id: "dev_beat", ownerId: owner.id, name: "Dana's PC", tokenHash: sha256(token), platform: "desktop-win32-x64" });
    const beat = (bearer: string) =>
      heartbeat(
        new Request("http://localhost/api/bridge/heartbeat", {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
          body: JSON.stringify({ clis: { claude: "2.1.302 (Claude Code)", codex: null } }),
        }),
      );
    const res = await beat(token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deviceId: "dev_beat", queued: 0 });
    const [device] = await db.select().from(schema.bridgeDevices).where(eq(schema.bridgeDevices.id, "dev_beat"));
    expect(device.lastSeenAt).not.toBeNull();
    expect((await beat(`bab_dev_${"x".repeat(40)}`)).status).toBe(401);
  });

  it("their session names no bot that needs Claude Code or Codex", async () => {
    const { owner, bot } = await ownerWithBot("usr_session");
    const token = `bab_dev_${"s".repeat(40)}`;
    await db.insert(schema.bridgeDevices).values({ id: "dev_sess", ownerId: owner.id, name: "Dana's Mac", tokenHash: sha256(token), platform: "desktop-darwin-arm64" });
    const res = await desktopSession(new Request("http://localhost/api/desktop/session", { headers: { authorization: `Bearer ${token}` } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bots: Array<Record<string, unknown>> };
    const mine = body.bots.find((b) => b.id === bot.id);
    expect(mine).toBeDefined();
    expect(mine).not.toHaveProperty("subscription");
  });
});

describe("a bot's tools in other AI apps (MCP)", () => {
  it("answer only the token its owner made for that bot", async () => {
    const token = `bab_mcp_${"m".repeat(40)}`;
    const { bot } = await ownerWithBot("usr_mcp", { mcpToken: token });
    const { bot: other } = await ownerWithBot("usr_mcp_other", { mcpToken: `bab_mcp_${"o".repeat(40)}` });
    const list = (botId: string, bearer: string) =>
      handleMcpRequest(
        new Request(`http://localhost/api/mcp/${botId}`, {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
        botId,
      );
    const ok = await list(bot.id, token);
    expect(ok.status).toBe(200);
    expect(Array.isArray(((await ok.json()) as { result: { tools: unknown[] } }).result.tools)).toBe(true);
    expect((await list(other.id, token)).status).toBe(401);
    expect((await list(bot.id, `bab_job_${"j".repeat(40)}`)).status).toBe(401);
  });
});
