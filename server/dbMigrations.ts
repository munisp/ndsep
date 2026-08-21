import path from "node:path";
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
  } catch (error) {
    logger.fatal({ err: error }, "[Database] Drizzle migration failed");
    throw error;
  } finally {
    await pool.end();
  }
}
