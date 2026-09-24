/**
 * Shared Postgres access for the antiwipe module family.
 * Follows the lazy-pool pattern used by server/routers/sectors.ts.
 */
import pg from "pg";
import { getDatabaseUrl } from "../config";
import { getPgSslConfig } from "../dbSslConfig";

const { Pool } = pg;

let _pool: InstanceType<typeof Pool> | null = null;

export function getAntiwipePool(): InstanceType<typeof Pool> {
  if (!_pool) {
    _pool = new Pool({
      connectionString: getDatabaseUrl(),
      ssl: getPgSslConfig(),
      max: 4,
    });
  }
  return _pool;
}

export async function q<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getAntiwipePool().query(sql, params);
  return res.rows as T[];
}
