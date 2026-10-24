/**
 * The server on real Postgres through postgres.js, the way it runs on Supabase. The other tests
 * use PGlite, which is more forgiving (it takes a Date anywhere, and it has no connection pool),
 * so a query can pass there and still fail in production. Point TEST_DATABASE_URL at an empty
 * local database, ideally behind pgbouncer in transaction mode like Supabase's pooler:
 *
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:6543/bab_test npx vitest run tests/postgres.test.ts
 *
 * Port 6543 makes the client skip prepared statements, as it does on Supabase.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const url = process.env.TEST_DATABASE_URL;
if (url && !/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
  throw new Error("TEST_DATABASE_URL must be a local throwaway database: these tests wipe it.");
}
if (url) process.env.DATABASE_URL = url;
process.env.DEMO_MODE = "1";
process.env.ADMIN_EMAILS = "boss@example.com";
process.env.ADMIN_SIGNIN_CODE = "correct horse battery staple";
delete process.env.RESEND_API_KEY;
delete process.env.AGENTMAIL_API_KEY;

// The route marks the browser that asks for a link with a cookie.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/headers")>()),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (opts: string | { name: string }) => void jar.delete(typeof opts === "string" ? opts : opts.name),
  }),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => null,
}));

const { getDb, migratePostgres, poolerUrl, resetDbForTests, schema } = await import("@/lib/db");

const ask = async (body: Record<string, unknown>) => {
  const magic = await import("@/app/api/auth/magic/route");
  return magic.POST(new Request("http://localhost/api/auth/magic", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
};

const connect = async () => {
  const { default: postgres } = await import("postgres");
  return postgres(url!, { max: 2, prepare: false, onnotice: () => {} });
};

beforeAll(async () => {
  if (!url) return;
  const admin = await connect();
  await admin.unsafe("drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public;");
  await admin.end();
  await resetDbForTests();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("Supabase's pooler", () => {
  it("is used in transaction mode, whichever of its URLs is pasted", () => {
    const session = "postgresql://postgres.abcd:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require";
    expect(poolerUrl(session)).toBe("postgresql://postgres.abcd:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require");
    expect(poolerUrl(poolerUrl(session))).toBe(poolerUrl(session));
    for (const other of ["postgresql://postgres:pw@db.abcd.supabase.co:5432/postgres", "postgres://u:p@localhost:5432/app"]) {
      expect(poolerUrl(other)).toBe(other);
    }
  });
});

describe.skipIf(!url)("on real Postgres, as on Supabase", () => {
  it("lets cold starts race to set up a new database", async () => {
    const { readMigrationFiles } = await import("drizzle-orm/migrator");
    const [a, b] = [await connect(), await connect()];
    await Promise.all([migratePostgres(a), migratePostgres(b), migratePostgres(a)]);
    const [{ n }] = await a`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(n).toBe(readMigrationFiles({ migrationsFolder: "drizzle" }).length);
    await Promise.all([a.end(), b.end()]);
  });

  it("starts over after a failed start instead of staying broken", async () => {
    await resetDbForTests();
    process.env.DATABASE_URL = "postgres://postgres@127.0.0.1:1/nowhere";
    await expect(getDb()).rejects.toThrow();
    process.env.DATABASE_URL = url;
    await expect(getDb()).resolves.toBeTruthy();
  });

  it("counts sign-in attempts per window", async () => {
    const { rateLimit } = await import("@/lib/safety/ratelimit");
    const db = await getDb();
    expect(await rateLimit(db, "pg:test", 2, 900)).toMatchObject({ ok: true, remaining: 1 });
    expect(await rateLimit(db, "pg:test", 2, 900)).toMatchObject({ ok: true, remaining: 0 });
    expect((await rateLimit(db, "pg:test", 2, 900)).ok).toBe(false);
  });

  it("hands out a one-time sign-in link, and admin emails still need the code", async () => {
    const res = await ask({ email: "someone@example.com" });
    expect(res.status).toBe(200);
    const token = new URL((await res.json()).demoLink).searchParams.get("token")!;
    const { consumeLoginLink } = await import("@/lib/auth/magic");
    const db = await getDb();
    expect((await consumeLoginLink(db, token))?.user.email).toBe("someone@example.com");
    expect(await consumeLoginLink(db, token)).toBeNull();

    expect((await ask({ email: "boss@example.com" })).status).toBe(403);
    expect((await ask({ email: "boss@example.com", adminCode: "correct horse battery staple" })).status).toBe(200);
  });

  it("adds up the admin numbers", async () => {
    const { adminMetrics } = await import("@/lib/admin/metrics");
    const m = await adminMetrics(await getDb());
    expect(m.users).toEqual({ total: 1, signedUp: 1, new7: 1 });
    expect(m.messages).toEqual({ d1: 0, d7: 0, d30: 0 });
  });

  it("runs the every-minute tick", async () => {
    const { housekeeping, runDueSchedules } = await import("@/lib/scheduler/tick");
    const db = await getDb();
    await runDueSchedules(db);
    await housekeeping(db);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, "someone@example.com"));
    expect(user?.emailVerifiedAt).toBeInstanceOf(Date);
  });
});
