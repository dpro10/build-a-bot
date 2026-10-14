/**
 * Apply database migrations from ./drizzle.
 *   npm run db:migrate
 * Uses DATABASE_URL (Postgres) when set, otherwise the local PGlite database in DATA_DIR.
 * The app also migrates on first use; run this before deploys to fail fast.
 */
import { dbKind, getDb } from "../src/lib/db";

async function main() {
  const started = Date.now();
  await getDb();
  console.log(`Migrations are up to date (${dbKind()}, ${Date.now() - started} ms).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
