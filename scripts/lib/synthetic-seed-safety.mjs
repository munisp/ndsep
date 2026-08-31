import { URL } from "node:url";

export const SYNTHETIC_SEED_CONFIRMATION = "NDSEP_SYNTHETIC_DATA_ONLY";
export const SYNTHETIC_SEED_APPLICATION_NAME = "ndsep-synthetic-seed";

const PRODUCTION_DATABASE_NAMES = /(?:^|[-_.])(prod(?:uction)?|live)(?:$|[-_.])/i;
const SYNTHETIC_DATABASE_NAMES = /(?:synthetic|demo|test|sandbox|staging)/i;

function parseBoundedInteger(value, fallback, minimum, maximum, name) {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function databaseName(url) {
  return decodeURIComponent(url.pathname.replace(/^\/+/, "").split("/")[0] ?? "");
}

function isLoopbackHost(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

/**
 * Validates that a synthetic seed run is explicitly confirmed, never targets a
 * production-labelled database, and has bounded database client settings.
 * This guard deliberately does not accept a default credential or connection URL.
 */
export function getSyntheticSeedPoolOptions(environment = process.env) {
  if (environment.NODE_ENV === "production") {
    throw new Error("Synthetic seed is prohibited when NODE_ENV=production");
  }
  if (environment.SYNTHETIC_SEED_CONFIRMATION !== SYNTHETIC_SEED_CONFIRMATION) {
    throw new Error(
      `Synthetic seed requires SYNTHETIC_SEED_CONFIRMATION=${SYNTHETIC_SEED_CONFIRMATION}`
    );
  }

  const connectionString = environment.POSTGRES_URL ?? environment.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Synthetic seed requires DATABASE_URL or POSTGRES_URL; no default database is permitted");
  }

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("Synthetic seed DATABASE_URL must be a valid PostgreSQL connection URL");
  }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new Error("Synthetic seed DATABASE_URL must use the PostgreSQL protocol");
  }

  const name = databaseName(parsed);
  if (!name) throw new Error("Synthetic seed DATABASE_URL must include a database name");
  if (PRODUCTION_DATABASE_NAMES.test(name)) {
    throw new Error("Synthetic seed refuses a production- or live-labelled database name");
  }
  if (!SYNTHETIC_DATABASE_NAMES.test(name)) {
    throw new Error("Synthetic seed database name must identify a synthetic, demo, test, sandbox, or staging database");
  }
  if (!isLoopbackHost(parsed.hostname)) {
    if (environment.SYNTHETIC_SEED_ALLOW_REMOTE !== SYNTHETIC_SEED_CONFIRMATION) {
      throw new Error(
        `Synthetic seed refuses non-loopback host '${parsed.hostname}' unless SYNTHETIC_SEED_ALLOW_REMOTE=${SYNTHETIC_SEED_CONFIRMATION}`
      );
    }
    const sslMode = parsed.searchParams.get("sslmode");
    if (!sslMode || !["require", "verify-ca", "verify-full"].includes(sslMode)) {
      throw new Error("Synthetic seed requires sslmode=require, verify-ca, or verify-full for a remote target");
    }
  }

  return {
    connectionString,
    application_name: SYNTHETIC_SEED_APPLICATION_NAME,
    max: parseBoundedInteger(environment.SYNTHETIC_SEED_POOL_MAX, 2, 1, 10, "SYNTHETIC_SEED_POOL_MAX"),
    connectionTimeoutMillis: parseBoundedInteger(
      environment.SYNTHETIC_SEED_CONNECTION_TIMEOUT_MS,
      5000,
      100,
      60000,
      "SYNTHETIC_SEED_CONNECTION_TIMEOUT_MS"
    ),
    idleTimeoutMillis: parseBoundedInteger(
      environment.SYNTHETIC_SEED_IDLE_TIMEOUT_MS,
      10000,
      1000,
      60000,
      "SYNTHETIC_SEED_IDLE_TIMEOUT_MS"
    ),
    statement_timeout: parseBoundedInteger(
      environment.SYNTHETIC_SEED_STATEMENT_TIMEOUT_MS,
      30000,
      1000,
      120000,
      "SYNTHETIC_SEED_STATEMENT_TIMEOUT_MS"
    ),
    query_timeout: parseBoundedInteger(
      environment.SYNTHETIC_SEED_QUERY_TIMEOUT_MS,
      30000,
      1000,
      120000,
      "SYNTHETIC_SEED_QUERY_TIMEOUT_MS"
    ),
    lock_timeout: parseBoundedInteger(
      environment.SYNTHETIC_SEED_LOCK_TIMEOUT_MS,
      5000,
      100,
      60000,
      "SYNTHETIC_SEED_LOCK_TIMEOUT_MS"
    ),
    idle_in_transaction_session_timeout: parseBoundedInteger(
      environment.SYNTHETIC_SEED_IDLE_IN_TRANSACTION_TIMEOUT_MS,
      15000,
      1000,
      120000,
      "SYNTHETIC_SEED_IDLE_IN_TRANSACTION_TIMEOUT_MS"
    ),
    maxUses: 10000,
    allowExitOnIdle: true,
  };
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * Reads the live public schema and counts every ordinary table. The caller must
 * use this after a seed run; an empty table is not silently ignored.
 */
export async function inspectPublicTableCoverage(client) {
  const { rows: tables } = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
  );
  const coverage = [];
  for (const row of tables) {
    const table = row.tablename;
    if (typeof table !== "string" || table.length === 0) {
      throw new Error("Database returned an invalid public table name during seed verification");
    }
    const { rows } = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${quoteIdentifier(table)}`);
    const value = rows[0]?.count;
    if (!/^\d+$/.test(String(value))) {
      throw new Error(`Unable to verify row count for public table '${table}'`);
    }
    coverage.push({ table, rows: Number(value) });
  }
  return coverage;
}

export function summarizePublicTableCoverage(coverage) {
  if (!Array.isArray(coverage) || coverage.some(row => !row || typeof row.table !== "string" || !Number.isSafeInteger(row.rows) || row.rows < 0)) {
    throw new Error("Invalid public-table coverage input");
  }
  const emptyTables = coverage.filter(row => row.rows === 0).map(row => row.table);
  return {
    totalTables: coverage.length,
    populatedTables: coverage.length - emptyTables.length,
    totalRows: coverage.reduce((total, row) => total + row.rows, 0),
    emptyTables,
    complete: emptyTables.length === 0,
  };
}

export function requireCompleteSyntheticSeed(summary) {
  if (!summary?.complete) {
    const empty = Array.isArray(summary?.emptyTables) ? summary.emptyTables.join(", ") : "unknown";
    throw new Error(`Synthetic seed coverage is incomplete; empty public tables: ${empty}`);
  }
  return summary;
}
