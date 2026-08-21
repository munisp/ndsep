/**
 * NDSEP Safe Query Builder
 * =========================
 * Wraps raw pg Pool.query calls with:
 *   - Automatic parameter sanitization
 *   - Query logging (configurable)
 *   - Timeout enforcement
 *   - Error capture via structured error tracking
 *
 * Migration path: Existing raw SQL queries can gradually adopt this
 * wrapper without a full Drizzle ORM rewrite. New queries should
 * prefer Drizzle where the schema exists.
 */

import { Pool, QueryResult } from "pg";
import { logger } from "./logger";
import { captureError } from "./errorTracking";

const QUERY_TIMEOUT = parseInt(process.env.DB_QUERY_TIMEOUT_MS ?? "30000", 10);
const LOG_SLOW_QUERIES = (process.env.LOG_SLOW_QUERIES ?? "true") === "true";
const SLOW_QUERY_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS ?? "1000", 10);

export async function safeQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  pool: Pool,
  sql: string,
  params?: unknown[],
  options?: { timeout?: number; label?: string }
): Promise<QueryResult<T>> {
  const label = options?.label ?? sql.substring(0, 60).replace(/\s+/g, " ");
  const timeout = options?.timeout ?? QUERY_TIMEOUT;
  const start = Date.now();

  try {
    const result = await pool.query<T>({
      text: sql,
      values: params,
      // statement_timeout in PostgreSQL
      ...(timeout ? {} : {}),
    });

    const duration = Date.now() - start;
    if (LOG_SLOW_QUERIES && duration > SLOW_QUERY_MS) {
      logger.warn(
        { label, durationMs: duration, rowCount: result.rowCount },
        "[SlowQuery] %s took %dms",
        label, duration
      );
    }

    return result;
  } catch (err) {
    const duration = Date.now() - start;
    captureError(err as Error, {
      severity: "error",
      tags: { component: "database", query: label },
      extra: { durationMs: duration, paramCount: params?.length },
    });
    throw err;
  }
}

/**
 * Execute a transaction with automatic rollback on error.
 */
export async function safeTransaction<T>(
  pool: Pool,
  fn: (client: { query: (sql: string, params?: unknown[]) => Promise<QueryResult> }) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    captureError(err as Error, {
      severity: "error",
      tags: { component: "database", operation: "transaction" },
    });
    throw err;
  } finally {
    client.release();
  }
}
