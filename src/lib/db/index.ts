/**
 * Database access.
 *
 * - DATABASE_URL set   → Postgres via postgres.js (production: Supabase, Neon, RDS, ...).
 * - DATABASE_URL unset → PGlite, an embedded Postgres, stored under DATA_DIR (default .data/pglite).
 *   DATA_DIR=memory keeps it in memory (tests).
 *
 * Migrations in ./drizzle run automatically on first use (guarded by an advisory lock on Postgres).
 */
import path from "node:path";
import fs from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

type DbState = { db: Db; ready: Promise<void>; kind: "pglite" | "postgres"; close: () => Promise<void> };

const g = globalThis as unknown as { __babDb?: DbState };

function migrationsFolder() {
  return path.join(process.cwd(), "drizzle");
}

async function createPglite(): Promise<DbState> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");

  let dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), ".data", "pglite");
  if (process.env.VERCEL && !process.env.DATA_DIR) dataDir = "/tmp/pglite"; // demo previews only
  const inMemory = dataDir === "memory";
  if (!inMemory) {
    dataDir = path.resolve(dataDir);
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const client = inMemory ? new PGlite() : new PGlite(dataDir);
  const db = drizzle(client, { schema }) as unknown as Db;
  const ready = (async () => {
    await client.waitReady;
    await migrate(db as never, { migrationsFolder: migrationsFolder() });
  })();
  return { db, ready, kind: "pglite", close: () => client.close() };
}

async function createPostgres(url: string): Promise<DbState> {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");

  const client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    prepare: !/pooler|pgbouncer|:6543/.test(url), // transaction poolers don't support prepared statements
    idle_timeout: 20,
  });
  const db = drizzle(client, { schema }) as unknown as Db;
  const ready = (async () => {
    if (process.env.AUTO_MIGRATE === "0") return;
    // One migrator at a time across cold starts.
    await client`select pg_advisory_lock(727274)`;
    try {
      await migrate(db as never, { migrationsFolder: migrationsFolder() });
    } finally {
      await client`select pg_advisory_unlock(727274)`;
    }
  })();
  return { db, ready, kind: "postgres", close: () => client.end() };
}

async function init(): Promise<DbState> {
  const url = process.env.DATABASE_URL;
  return url ? createPostgres(url) : createPglite();
}

let initPromise: Promise<DbState> | null = null;

/** Returns the ready database. Safe to call from any server code path. */
export async function getDb(): Promise<Db> {
  if (g.__babDb) {
    await g.__babDb.ready;
    return g.__babDb.db;
  }
  if (!initPromise) {
    initPromise = init().then((state) => {
      g.__babDb = state;
      return state;
    });
  }
  const state = await initPromise;
  await state.ready;
  return state.db;
}

export function dbKind(): "pglite" | "postgres" {
  return process.env.DATABASE_URL ? "postgres" : "pglite";
}

/** Tests only: close and forget the current database. */
export async function resetDbForTests() {
  if (g.__babDb) {
    await g.__babDb.close().catch(() => {});
    g.__babDb = undefined;
  }
  initPromise = null;
}
