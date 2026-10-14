/**
 * Discord /link: the code a Discord user types must match one pending code exactly.
 * A LIKE pattern built from the typed text let "%" (or "______") match anyone's
 * pending code, which linked the attacker as the owner of someone else's bot.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";

const keys = crypto.generateKeyPairSync("ed25519");
process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
delete process.env.DATABASE_URL;
// The raw 32-byte public key, hex (the SPKI DER prefix is 12 bytes).
process.env.DISCORD_PUBLIC_KEY = keys.publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const discord = await import("@/app/api/webhooks/discord/route");

let db: Awaited<ReturnType<typeof getDb>>;

function signed(body: unknown): Request {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.sign(null, Buffer.from(ts + raw), keys.privateKey).toString("hex");
  return new Request("http://localhost/api/webhooks/discord", {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature-ed25519": sig, "x-signature-timestamp": ts },
    body: raw,
  });
}

const link = (userId: string, code: string) => signed({ id: "i1", type: 2, token: "t", data: { name: "link", options: [{ name: "code", value: code }] }, user: { id: userId } });

async function victimWithPendingCode(id: string, digits: string) {
  await db.insert(schema.users).values({ id, email: `${id}@example.com`, emailVerifiedAt: new Date(), name: "Vic" });
  await db.insert(schema.bots).values({ id: `bot_${id}`, ownerId: id, name: "Vicbot", avatar: "otto", color: "grape", handle: `vic-${id}`, brain: { kind: "included", provider: "nebius", model: "x" } });
  await db.insert(schema.channels).values({ id: `chn_${id}`, botId: `bot_${id}`, kind: "discord", status: "pending" });
  await db.insert(schema.pairingCodes).values({ code: `dsc_chn_${id}_${digits}`, purpose: "discord_owner", ownerId: id, botId: `bot_${id}`, channelId: `chn_${id}`, expiresAt: new Date(Date.now() + 30 * 60_000) });
  return `chn_${id}`;
}

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("discord /link", () => {
  it("wildcards in the typed code don't match someone else's pending code", async () => {
    const channelId = await victimWithPendingCode("usr_vic", "K7XQ29MD");
    for (const guess of ["%", "________", "%%%%%%%%", "K7XQ_9MD", "%29MD", "482913"]) {
      const res = await discord.POST(link(`attacker-${guess.length}`, guess));
      expect((await res.json()).data.content).toMatch(/didn't work/);
    }
    const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId));
    expect(channel.ownerAddress).toBeNull();
    expect(channel.status).toBe("pending");

    // The owner's own code still works, once.
    const ok = await discord.POST(link("owner-discord-id", " k7xq-29md "));
    expect((await ok.json()).data.content).toMatch(/Linked!/);
    const [linked] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId));
    expect(linked.ownerAddress).toBe("owner-discord-id");
    const again = await discord.POST(link("someone-else", "K7XQ-29MD"));
    expect((await again.json()).data.content).toMatch(/didn't work/);
  });

  it("hands out codes too long to guess (they're checked against every pending link)", async () => {
    const { channelAction } = await import("@/lib/channels/setup");
    await victimWithPendingCode("usr_codes", "AAAA0000");
    const [owner] = await db.select().from(schema.users).where(eq(schema.users.id, "usr_codes"));
    const [bot] = await db.select().from(schema.bots).where(eq(schema.bots.id, "bot_usr_codes"));
    const res = await channelAction(db, owner, bot, "discord", "link", {});
    expect(res.ok).toBe(true);
    const code = String((res as { data?: { code?: string } }).data?.code);
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const stored = await db.select().from(schema.pairingCodes).where(eq(schema.pairingCodes.code, `dsc_chn_usr_codes_${code.replace("-", "")}`));
    expect(stored).toHaveLength(1);
  });

  it("limits how many codes one Discord user can try", async () => {
    await victimWithPendingCode("usr_vic2", "ZZZZ7777");
    const answers: string[] = [];
    for (let i = 0; i < 12; i++) answers.push((await (await discord.POST(link("guesser", `AAAA${1000 + i}`))).json()).data.content);
    expect(answers.at(-1)).toMatch(/Too many tries/);
    // Even the right code is refused while that user is locked out.
    const res = await discord.POST(link("guesser", "ZZZZ-7777"));
    expect((await res.json()).data.content).toMatch(/Too many tries/);
  });
});
