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

  let dataDir = process.env.DATA_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "pglite");
  if (process.env.VERCEL && !process.env.DATA_DIR) dataDir = "/tmp/pglite"; // demo previews only
  const inMemory = dataDir === "memory";
  if (!inMemory) {
    // The ignore comments keep the build from tracing the whole project for this runtime-only path.
    dataDir = path.resolve(/* turbopackIgnore: true */ dataDir);
    fs.mkdirSync(/* turbopackIgnore: true */ dataDir, { recursive: true });
  }
  const client = inMemory ? new PGlite() : new PGlite(dataDir);
  const db = drizzle(client, { schema }) as unknown as Db;
  const ready = (async () => {
    await client.waitReady;
    await migrate(db as never, { migrationsFolder: migrationsFolder() });
  })();
  return { db, ready, kind: "pglite", close: () => client.close() };
}

/**
 * Supabase's pooler answers in session mode on port 5432 and in transaction mode on 6543, with the
 * same host and login. Session mode allows only as many clients as its pool (15 on the free plan),
 * and every serverless instance keeps its own connections open, frozen ones included, so a few page
 * loads used them all up. Transaction mode lends a connection per query, so the app always uses it.
 */
export function poolerUrl(url: string): string {
  return url.replace(/(@[^/?#@]+\.pooler\.supabase\.com):5432(?=[/?#]|$)/, "$1:6543");
}

/**
 * Applies ./drizzle the way drizzle's migrator does (same bookkeeping table), but in one transaction
 * under a transaction-level lock. Cold starts can race, and a session lock doesn't survive a
 * transaction pooler (the lock and the unlock can land on different server connections).
 */
export async function migratePostgres(client: import("postgres").Sql) {
  const { readMigrationFiles } = await import("drizzle-orm/migrator");
  const migrations = readMigrationFiles({ migrationsFolder: migrationsFolder() });
  const latest = migrations.at(-1)?.folderMillis ?? 0;
  const lastApplied = async (q: import("postgres").Sql | import("postgres").TransactionSql) => {
    const [table] = await q`select to_regclass('drizzle.__drizzle_migrations') is not null as present`;
    if (!table?.present) return -1;
    const [row] = await q`select coalesce(max(created_at), -1)::text as at from drizzle.__drizzle_migrations`;
    return Number(row?.at ?? -1);
  };
  if ((await lastApplied(client)) >= latest) return; // the usual cold start
  await client.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(727274)`;
    await tx`create schema if not exists drizzle`;
    await tx`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
    const done = await lastApplied(tx);
    for (const migration of migrations) {
      if (migration.folderMillis <= done) continue;
      for (const statement of migration.sql) if (statement.trim()) await tx.unsafe(statement);
      await tx`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.folderMillis})`;
    }
  });
}

async function createPostgres(rawUrl: string): Promise<DbState> {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");

  const url = poolerUrl(rawUrl);
  const client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    prepare: !/pooler|pgbouncer|:6543/.test(url), // transaction poolers don't support prepared statements
    idle_timeout: 20,
    // NOTICEs ("already exists, skipping") are noise in the logs; warnings still show.
    onnotice: (notice) => {
      if (notice.severity !== "NOTICE") console.warn("[postgres]", notice.severity, notice.message);
    },
  });
  const db = drizzle(client, { schema }) as unknown as Db;
  // drizzle makes postgres.js pass date values through untouched (its columns hand over strings),
  // so a Date written straight into a sql`` template would reach the wire as an object and fail
  // the query. PGlite takes Dates as they are, which is why only real Postgres shows this.
  const serializers = (client as unknown as { options: { serializers: Record<string, (x: unknown) => unknown> } }).options.serializers;
  for (const type of ["1082", "1114", "1184"]) {
    const passThrough = serializers[type];
    serializers[type] = (x) => (x instanceof Date ? x.toISOString() : passThrough ? passThrough(x) : x);
  }
  // A Preview deployment shares production's database (docs/DECISIONS.md): it never migrates it, so
  // a pull request's migration can't change the live database before it's merged.
  const migrate = process.env.AUTO_MIGRATE !== "0" && process.env.VERCEL_ENV !== "preview";
  const ready = migrate ? migratePostgres(client) : Promise.resolve();
  return { db, ready, kind: "postgres", close: () => client.end() };
}

async function init(): Promise<DbState> {
  const url = process.env.DATABASE_URL;
  return url ? createPostgres(url) : createPglite();
}

let initPromise: Promise<DbState> | null = null;

/** Returns the ready database. Safe to call from any server code path. */
export async function getDb(): Promise<Db> {
  if (!initPromise) {
    const pending: Promise<DbState> = (g.__babDb ? Promise.resolve(g.__babDb) : init()).then(async (state) => {
      g.__babDb = state;
      try {
        await state.ready;
      } catch (err) {
        // A failed start (the database briefly unreachable, say) mustn't break this server
        // for good: forget it, so the next request starts over.
        if (g.__babDb === state) g.__babDb = undefined;
        if (initPromise === pending) initPromise = null;
        await state.close().catch(() => {});
        throw err;
      }
      return state;
    });
    initPromise = pending;
  }
  return (await initPromise).db;
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
