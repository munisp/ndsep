import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDatabaseUrl } from "./config";
import { getPgSslConfig } from "./dbSslConfig";
import { logger } from "./logger";

/**
 * Apply the checked-in Drizzle migration journal before the API starts.
 * A failed migration is intentionally fatal: accepting traffic against a partial
 * schema produces plausible empty responses and corrupts operational state.
 */
export async function applyDatabaseMigrations(): Promise<void> {
  const pool = new pg.Pool({
    connectionString: getDatabaseUrl(),
    ssl: getPgSslConfig(),
    max: 2,
    connectionTimeoutMillis: 10_000,
  });

  try {
    await migrate(drizzle(pool), {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
      migrationsSchema: "drizzle",
    });
    logger.info("[Database] Drizzle migrations applied successfully");

    // Raw operational migrations (drizzle/migrations/0019+, incl. round-9
    // 0097/0109/0110/0111) are not in the drizzle journal — run the dedicated
    // idempotent runner. Failure is fatal here too: the API must not serve
    // traffic against a partially-migrated schema.
    const runner = path.resolve(process.cwd(), "scripts/runRawMigrations.mjs");
    if (fs.existsSync(runner)) {
      execFileSync(process.execPath, [runner], { stdio: "inherit", env: process.env });
      logger.info("[Database] Raw SQL migrations applied successfully");
    } else {
      logger.warn({ runner }, "[Database] runRawMigrations.mjs not found in deployment image — raw migrations skipped (wire scripts/migrate.sh into the entrypoint)");
    }
  } catch (error) {
    logger.fatal({ err: error }, "[Database] Drizzle migration failed");
    throw error;
  } finally {
    await pool.end();
  }
}
