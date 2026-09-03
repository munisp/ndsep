import type { PoolConfig } from "pg";

const DEFAULTS = {
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
  query_timeout: 35_000,
  lock_timeout: 5_000,
  idle_in_transaction_session_timeout: 15_000,
  maxUses: 10_000,
} as const;

function boundedInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = environment[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const value = Number(raw);
  if (value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

/**
 * Applies bounded operational controls to the primary PostgreSQL pool.
 * Database credentials and TLS settings remain supplied by the existing
 * configuration/secret boundary; this function never introduces defaults for them.
 */
export function getPrimaryDatabasePoolOptions(
  connectionString: string,
  ssl: PoolConfig["ssl"],
  environment: NodeJS.ProcessEnv = process.env
): PoolConfig {
  return {
    connectionString,
    ssl,
    application_name: environment.DB_APPLICATION_NAME ?? "ndsep-api",
    max: boundedInteger(environment, "DB_POOL_MAX", DEFAULTS.max, 1, 100),
    idleTimeoutMillis: boundedInteger(
      environment,
      "DB_IDLE_TIMEOUT_MS",
      DEFAULTS.idleTimeoutMillis,
      1_000,
      300_000
    ),
    connectionTimeoutMillis: boundedInteger(
      environment,
      "DB_CONNECTION_TIMEOUT_MS",
      DEFAULTS.connectionTimeoutMillis,
      100,
      60_000
    ),
    statement_timeout: boundedInteger(
      environment,
      "DB_STATEMENT_TIMEOUT_MS",
      DEFAULTS.statement_timeout,
      1_000,
      300_000
    ),
    query_timeout: boundedInteger(
      environment,
      "DB_QUERY_TIMEOUT_MS",
      DEFAULTS.query_timeout,
      1_000,
      300_000
    ),
    lock_timeout: boundedInteger(
      environment,
      "DB_LOCK_TIMEOUT_MS",
      DEFAULTS.lock_timeout,
      100,
      60_000
    ),
    idle_in_transaction_session_timeout: boundedInteger(
      environment,
      "DB_IDLE_IN_TRANSACTION_TIMEOUT_MS",
      DEFAULTS.idle_in_transaction_session_timeout,
      1_000,
      300_000
    ),
    maxUses: boundedInteger(environment, "DB_POOL_MAX_USES", DEFAULTS.maxUses, 100, 1_000_000),
    keepAlive: true,
    allowExitOnIdle: environment.NODE_ENV === "test",
  };
}
