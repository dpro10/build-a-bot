/**
 * The live call check (scripts/live-call.mjs) makes its call as its own signed-in account: calls
 * need one. It signs in with the voice server's secret, only as that account, whose credit is
 * topped up as the checks spend it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const SECRET = "c".repeat(48);
process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "0";
process.env.VOICE_SERVER_URL = "https://voice.example/";
process.env.VOICE_SERVER_SECRET = SECRET;
for (const name of ["DATABASE_URL", "TOKEN_FACTORY_API_KEY", "STRIPE_SECRET_KEY"]) delete process.env[name];

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/headers")>()),
  headers: async () => new Headers({ "user-agent": "vitest" }),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (opts: string | { name: string }) => void jar.delete(typeof opts === "string" ? opts : opts.name),
  }),
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { getUser } = await import("@/lib/auth/session");
const { getCredit } = await import("@/lib/billing/credit");
const { checkSpend, recordUsage } = await import("@/lib/billing/usage");
const { signBody } = await import("@/lib/calls/tokens");
const checkRoute = await import("@/app/api/calls/check/route");

const signIn = (secret = SECRET, body = JSON.stringify({ check: "live-call" })) =>
  checkRoute.POST(new Request("http://localhost/api/calls/check", { method: "POST", headers: { "content-type": "application/json", "x-voice-signature": signBody(secret, body) }, body }));

beforeAll(async () => {
  await resetDbForTests();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("the live call check's account", () => {
  it("only with the voice server's secret", async () => {
    expect((await signIn("x".repeat(48))).status).toBe(401);
    expect((await signIn(SECRET, JSON.stringify({ check: "something-else" }))).status).toBe(422);
    expect(jar.size).toBe(0);
  });

  it("is signed in, can make calls, and its credit is topped up as the checks spend it", async () => {
    const res = await signIn();
    expect(res.status).toBe(200);
    const user = await getUser();
    expect(user).toMatchObject({ id: "usr_live_call_check", email: "live-call-check@build-a-bot.site" });
    expect(user?.emailVerifiedAt).toBeTruthy();
    expect(await checkSpend(await getDb(), user!, "call")).toEqual({ ok: true });

    const db = await getDb();
    const before = await getCredit(db, user!.id);
    // A little spent: no top-up yet.
    await recordUsage(db, user!.id, { costMicros: 500_000 });
    jar.clear();
    await signIn();
    expect((await getCredit(db, user!.id)).balanceMicros).toBe(before.balanceMicros - 500_000);
    // Under a dollar left: back to $5.
    await recordUsage(db, user!.id, { costMicros: before.balanceMicros - 800_000 });
    await signIn();
    expect((await getCredit(db, user!.id)).balanceMicros).toBe(5_000_000);
    const gifts = await db.select().from(schema.credits).where(eq(schema.credits.userId, user!.id));
    expect(gifts.every((g) => g.kind === "gift")).toBe(true);
  });
});
