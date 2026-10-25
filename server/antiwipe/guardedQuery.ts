/**
 * Anti-Wipe Guarded Query — main-pool integration
 * =================================================
 * Wires assertNotDestructive() into the MAIN application pool's raw-SQL path
 * (previously the guard only covered the antiwipe module's own helper in
 * ./db.ts — the rest of the app queried the shared pool unguarded).
 *
 * `wrapPoolWithGuard(pool)` returns a Proxy that screens every .query() call:
 *   - DROP/TRUNCATE/ALTER...DROP on protected evidence tables → throws
 *     DestructiveOperationError BEFORE the statement reaches Postgres.
 *   - Bare TRUNCATE on any table → throws (mass-wipe primitive).
 *   - Unqualified DELETE on a NON-protected table → permitted but loudly
 *     logged (legacy demo-reset paths do this; protected tables always throw).
 *
 * Adoption: server/db.ts#getSharedPool returns the wrapped pool, so every
 * `getSharedPool().query(...)` call site in the app is screened without
 * per-file changes. Code that intentionally runs DDL (migration runner,
 * drizzle-kit) uses its own dedicated connections, not this pool.
 */
import type pg from "pg";
import { assertNotDestructive, PROTECTED_TABLES } from "./guards";
import { logger } from "../logger";

export interface GuardedPool {
  query: pg.Pool["query"];
  connect: pg.Pool["connect"];
  end: pg.Pool["end"];
}

export function wrapPoolWithGuard<T extends { query: (...args: unknown[]) => unknown }>(pool: T): T {
  return new Proxy(pool, {
    get(target, prop, receiver) {
      if (prop === "query") {
        return (text: unknown, ...rest: unknown[]) => {
          if (typeof text === "string") {
            assertNotDestructive(text, PROTECTED_TABLES, {
              allowUnqualifiedDeleteOnUnprotected: true,
              onWarning: (message) => logger.warn({ sql: text.slice(0, 200) }, `[GuardedQuery] ${message}`),
            });
          } else if (text && typeof text === "object" && typeof (text as { text?: unknown }).text === "string") {
            assertNotDestructive((text as { text: string }).text, PROTECTED_TABLES, {
              allowUnqualifiedDeleteOnUnprotected: true,
              onWarning: (message) => logger.warn({ sql: (text as { text: string }).text.slice(0, 200) }, `[GuardedQuery] ${message}`),
            });
          }
          return (target.query as (...a: unknown[]) => unknown)(text, ...rest);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Screened raw query against an arbitrary pool — for call sites that hold
 * their own pool reference instead of the shared one.
 */
export async function guardedQuery<T = Record<string, unknown>>(
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: T[] }> },
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  assertNotDestructive(sql);
  const res = await pool.query(sql, params);
  return res.rows;
}
