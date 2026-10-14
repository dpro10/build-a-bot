/**
 * Channel linking edge cases found in review (in-memory Postgres).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
delete process.env.DATABASE_URL;

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { rememberManagerStart } = await import("@/lib/channels/telegram-setup");

let db: Awaited<ReturnType<typeof getDb>>;

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("telegram manager bot", () => {
  it("'/start link_…' needs the pending request's own code, not the bot's id", async () => {
    await db.insert(schema.users).values({ id: "usr_tg", email: "tg@example.com", emailVerifiedAt: new Date() });
    await db.insert(schema.bots).values({ id: "bot_tg", ownerId: "usr_tg", name: "Tgbot", avatar: "otto", color: "grape", handle: "tg-bot", brain: { kind: "included", provider: "nebius", model: "x" } });
    await db.insert(schema.pairingCodes).values({
      code: "tg_Secret_Code1",
      purpose: "telegram_managed",
      ownerId: "usr_tg",
      botId: "bot_tg",
      channelId: "chn_tg",
      data: { suggestedUsername: "tgbot_ab12_bot" },
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const data = async () => (await db.select().from(schema.pairingCodes).where(eq(schema.pairingCodes.code, "tg_Secret_Code1")))[0].data as { telegramUserId?: string };

    await rememberManagerStart(db, "bot_tg", "666"); // someone who only knows the bot id
    expect((await data()).telegramUserId).toBeUndefined();
    await rememberManagerStart(db, "Secret_Code1", "4242");
    expect((await data()).telegramUserId).toBe("4242");
  });
});

describe("connecting an app (MCP sign-in)", () => {
  it("only the person who started connecting can finish it: someone else's browser can't attach their account to it", async () => {
    const { vi } = await import("vitest");
    const { finishMcpOAuth } = await import("@/lib/connectors/mcp/oauth");
    const state = (id: string) => ({
      id,
      ownerId: "usr_attacker",
      botId: "bot_attacker",
      connectorId: "gmail",
      kind: "mcp",
      codeVerifier: "v",
      data: { connectionId: "con_attacker", issuer: "https://auth.example", tokenEndpoint: "https://auth.example/token", revocationEndpoint: null, issParamSupported: false, clientId: "c", clientSecret: null, resource: "https://mcp.example", scope: null },
      redirectTo: "/app/bots/bot_attacker/tools",
      expiresAt: new Date(Date.now() + 600_000),
    });
    await db.insert(schema.oauthStates).values([state("st_victim_clicks"), state("st_owner_finishes")]);
    const fetchSpy = vi.fn(async () => new Response("nope", { status: 400 }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      // The attacker's sign-in link, opened (and approved) by a victim signed in as someone else.
      const r = await finishMcpOAuth(db, { state: "st_victim_clicks", code: "victims-code", iss: null, error: null, userId: "usr_victim" });
      expect(r.ok).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled(); // the victim's code is never exchanged
      // The person who started it gets through to the token exchange.
      const mine = await finishMcpOAuth(db, { state: "st_owner_finishes", code: "code", iss: null, error: null, userId: "usr_attacker" });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(!mine.ok && mine.message).toMatch(/refused the sign-in/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
