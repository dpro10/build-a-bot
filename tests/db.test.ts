import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb, resetDbForTests, schema } from "@/lib/db";

beforeAll(async () => {
  process.env.DATA_DIR = "memory";
  delete process.env.DATABASE_URL;
  await resetDbForTests();
});
afterAll(async () => {
  await resetDbForTests();
});

describe("database", () => {
  it("migrates and enforces append-only receipts", async () => {
    const db = await getDb();
    await db.insert(schema.users).values({ id: "usr_test", email: "t@example.com" });
    await db.insert(schema.bots).values({
      id: "bot_test",
      ownerId: "usr_test",
      name: "Nova",
      avatar: "blip",
      color: "ocean",
      brain: { kind: "included", provider: "nebius", model: "m" },
      handle: "nova-test",
    });
    await db.insert(schema.receipts).values({ id: "rcp_1", botId: "bot_test", ownerId: "usr_test", kind: "system", title: "Born" });

    await expect(
      db.update(schema.receipts).set({ title: "tampered" }).where(eq(schema.receipts.id, "rcp_1")),
    ).rejects.toThrow();
    await expect(db.delete(schema.receipts).where(eq(schema.receipts.id, "rcp_1"))).rejects.toThrow();

    // Deleting with the bot inside an explicit deletion transaction is allowed.
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local app.allow_receipt_delete = 'on'`);
      await tx.delete(schema.bots).where(eq(schema.bots.id, "bot_test"));
    });
    const left = await db.select().from(schema.receipts);
    expect(left).toHaveLength(0);
  });
});
