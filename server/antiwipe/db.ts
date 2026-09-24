/**
 * Shared Postgres access for the antiwipe module family.
 * Follows the lazy-pool pattern used by server/routers/sectors.ts.
 */
import pg from "pg";
import { getDatabaseUrl } from "../config";
import { getPgSslConfig } from "../dbSslConfig";
import { assertNotDestructive } from "./guards";

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
  // Anti-wipe guard (fail fast at the app layer): every statement through
  // this helper is screened for DROP / TRUNCATE / unqualified DELETE /
  // ALTER ... DROP against protected evidence tables before it reaches
  // Postgres. The database triggers (0060-0063) remain the deeper layer.
  assertNotDestructive(sql);
  const res = await getAntiwipePool().query(sql, params);
  return res.rows as T[];
}
