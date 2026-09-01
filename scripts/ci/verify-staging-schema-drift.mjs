#!/usr/bin/env node
/**
 * Read-only staging schema-drift verifier for protected deployment workflows.
 *
 * This command never writes fixture data, applies migrations, or runs on a pull
 * request. It compares a clean same-commit baseline database with a protected
 * staging fixture database and exits nonzero on any schema mismatch.
 *
 * Required environment variables:
 *   SCHEMA_DRIFT_BASELINE_DATABASE_URL
 *   SCHEMA_DRIFT_STAGING_DATABASE_URL
 *
 * Both endpoints must be distinct, non-production PostgreSQL targets using
 * sslmode=verify-full and a read-only database role. Do not print either URL.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { URL } from "node:url";
import pg from "pg";

export const SCHEMA_DRIFT_APPLICATION_NAME = "ndsep-ci-schema-drift-verifier";
const PRODUCTION_DATABASE_NAMES = /(?:^|[-_.])(prod(?:uction)?|live)(?:$|[-_.])/i;
const STAGING_DATABASE_NAMES = /(?:staging|synthetic|demo|test|sandbox)/i;
const REQUIRED_QUERY_PACK_MARKERS = Object.freeze([
  "BEGIN TRANSACTION READ ONLY;",
  "schema_column_fingerprint",
  "schema_constraint_fingerprint",
  "schema_index_fingerprint",
  "fixture_counts AS",
  "ROLLBACK;",
]);
const MUTATING_SQL_TOKENS = /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|VACUUM|ANALYZE)\b/i;

export const REQUIRED_TABLES = Object.freeze([
  "analytics_snapshots",
  "article40_codes",
  "dpco_audit_service_records",
  "dpco_registry_service_records",
  "dpco_verification_service_records",
  "dt_jurisdictions",
  "dt_policies",
  "dt_org_agents",
  "dt_simulations",
  "dt_simulation_results",
  "dt_monte_carlo_stats",
  "dt_policy_impacts",
  "dt_sandboxes",
  "marketplace_plugins",
  "mobile_push_devices",
  "noc_agent_memory",
  "onboarding_checklists",
  "users",
]);

export const REQUIRED_COLUMNS = Object.freeze([
  ["analytics_snapshots", "metric_name"], ["analytics_snapshots", "dimension"],
  ["analytics_snapshots", "dimension_value"], ["analytics_snapshots", "metric_value"],
  ["analytics_snapshots", "snapshot_date"], ["analytics_snapshots", "metadata"],
  ["article40_codes", "code_name"], ["article40_codes", "sector"],
  ["article40_codes", "description"], ["article40_codes", "submitted_by"],
  ["article40_codes", "document_url"], ["article40_codes", "status"],
  ["dpco_audit_service_records", "audit_id"], ["dpco_audit_service_records", "payload"],
  ["dpco_registry_service_records", "registry_id"], ["dpco_registry_service_records", "payload"],
  ["dpco_verification_service_records", "statement_id"], ["dpco_verification_service_records", "payload"],
  ["dt_jurisdictions", "code"], ["dt_jurisdictions", "name"],
  ["dt_policies", "jurisdiction_id"], ["dt_policies", "code"], ["dt_policies", "rules"],
  ["dt_org_agents", "jurisdiction_id"], ["dt_org_agents", "org_name"],
  ["dt_simulations", "simulation_id"], ["dt_simulations", "jurisdictions"],
  ["dt_simulation_results", "simulation_id"], ["dt_simulation_results", "jurisdiction"],
  ["dt_monte_carlo_stats", "simulation_id"], ["dt_monte_carlo_stats", "metric"],
  ["dt_policy_impacts", "simulation_id"], ["dt_policy_impacts", "policy_id"],
  ["dt_sandboxes", "sandbox_id"], ["dt_sandboxes", "base_snapshot"],
  ["marketplace_plugins", "name"], ["marketplace_plugins", "manifest"],
  ["mobile_push_devices", "user_id"], ["mobile_push_devices", "token"], ["mobile_push_devices", "device_id"],
  ["noc_agent_memory", "memory_id"], ["noc_agent_memory", "context"],
  ["onboarding_checklists", "user_id"], ["onboarding_checklists", "step_id"],
  ["users", "open_id"], ["users", "role"],
]);

function databaseName(url) {
  return decodeURIComponent(url.pathname.replace(/^\/+/, "").split("/")[0] ?? "");
}

function redactedTarget(parsed) {
  return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}/${databaseName(parsed)}`;
}

function stripSqlCommentsAndStrings(sql) {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/'(?:''|[^'])*'/g, "''");
}

export function validateSchemaDriftTarget(value, label) {
  if (!value) throw new Error(`${label} is required`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL`);
  }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new Error(`${label} must use the PostgreSQL protocol`);
  }
  const name = databaseName(parsed);
  if (!name) throw new Error(`${label} must include a database name`);
  if (PRODUCTION_DATABASE_NAMES.test(name)) {
    throw new Error(`${label} refuses a production- or live-labelled database`);
  }
  if (!STAGING_DATABASE_NAMES.test(name)) {
    throw new Error(`${label} must identify a staging, synthetic, demo, test, or sandbox database`);
  }
  if (parsed.searchParams.get("sslmode") !== "verify-full") {
    throw new Error(`${label} requires sslmode=verify-full`);
  }
  return parsed;
}

export function requireDistinctTargets(baseline, staging) {
  if (redactedTarget(baseline) === redactedTarget(staging)) {
    throw new Error("Schema-drift baseline and staging targets must be distinct databases");
  }
}

export function assertReadOnlyQueryPack(sql) {
  if (typeof sql !== "string" || sql.trim().length === 0) {
    throw new Error("Schema-drift verification SQL must be non-empty");
  }
  for (const marker of REQUIRED_QUERY_PACK_MARKERS) {
    if (!sql.includes(marker)) throw new Error(`Schema-drift verification SQL is missing required marker: ${marker}`);
  }
  const executableSql = stripSqlCommentsAndStrings(sql);
  const unsafe = executableSql.match(MUTATING_SQL_TOKENS);
  if (unsafe) throw new Error(`Schema-drift verification SQL must be read-only; prohibited token: ${unsafe[0].toUpperCase()}`);
  return true;
}

export function assertSchemaComparison(baseline, staging) {
  for (const key of ["column", "constraint", "index"]) {
    if (typeof baseline?.fingerprints?.[key] !== "string" || !/^[a-f0-9]{32}$/.test(baseline.fingerprints[key])) {
      throw new Error(`Baseline ${key} fingerprint is invalid`);
    }
    if (typeof staging?.fingerprints?.[key] !== "string" || !/^[a-f0-9]{32}$/.test(staging.fingerprints[key])) {
      throw new Error(`Staging ${key} fingerprint is invalid`);
    }
    if (baseline.fingerprints[key] !== staging.fingerprints[key]) {
      throw new Error(`Schema drift detected: ${key} fingerprint differs`);
    }
  }
  for (const [label, report] of [["baseline", baseline], ["staging", staging]]) {
    if (report.missingTables.length > 0) throw new Error(`${label} schema is missing required table(s): ${report.missingTables.join(", ")}`);
    if (report.missingColumns.length > 0) throw new Error(`${label} schema is missing required column(s): ${report.missingColumns.join(", ")}`);
    if (report.unvalidatedConstraints.length > 0) throw new Error(`${label} schema has unvalidated constraint(s)`);
    if (report.invalidIndexes.length > 0) throw new Error(`${label} schema has invalid or unready index(es)`);
    if (report.transactionReadOnly !== "on") throw new Error(`${label} schema verification session is not read-only`);
  }
  return true;
}

const COLUMN_FINGERPRINT_QUERY = `
WITH columns_contract AS (
  SELECT table_schema, table_name, ordinal_position, column_name, data_type, udt_schema,
    udt_name, is_nullable, COALESCE(column_default, '') AS column_default
  FROM information_schema.columns WHERE table_schema = 'public'
), canonical AS (
  SELECT string_agg(format('%s.%s#%s:%s:%s.%s:%s:%s:%s', table_schema, table_name,
    ordinal_position, column_name, data_type, udt_schema, udt_name, is_nullable, column_default),
    E'\\n' ORDER BY table_schema, table_name, ordinal_position) AS contents FROM columns_contract
) SELECT md5(COALESCE(contents, '')) AS fingerprint FROM canonical`;

const CONSTRAINT_FINGERPRINT_QUERY = `
WITH constraint_contract AS (
  SELECT conrelid::regclass::text AS table_name, conname, contype, condeferrable,
    condeferred, convalidated, pg_get_constraintdef(oid, true) AS definition
  FROM pg_constraint WHERE connamespace = 'public'::regnamespace
), canonical AS (
  SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s', table_name, conname, contype,
    condeferrable, condeferred, convalidated, definition), E'\\n' ORDER BY table_name, conname) AS contents
  FROM constraint_contract
) SELECT md5(COALESCE(contents, '')) AS fingerprint FROM canonical`;

const INDEX_FINGERPRINT_QUERY = `
WITH index_contract AS (
  SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
), canonical AS (
  SELECT string_agg(format('%s.%s:%s:%s', schemaname, tablename, indexname, indexdef),
    E'\\n' ORDER BY schemaname, tablename, indexname) AS contents FROM index_contract
) SELECT md5(COALESCE(contents, '')) AS fingerprint FROM canonical`;

async function collectSchemaReport(client) {
  const tableNames = REQUIRED_TABLES;
  const columnTables = REQUIRED_COLUMNS.map(([table]) => table);
  const columnNames = REQUIRED_COLUMNS.map(([, column]) => column);
  const [session, missingTables, missingColumns, unvalidatedConstraints, invalidIndexes, column, constraint, index] = await Promise.all([
    client.query("SHOW transaction_read_only"),
    client.query(`SELECT expected.table_name
      FROM unnest($1::text[]) AS expected(table_name)
      LEFT JOIN information_schema.tables actual
        ON actual.table_schema = 'public' AND actual.table_name = expected.table_name
      WHERE actual.table_name IS NULL ORDER BY expected.table_name`, [tableNames]),
    client.query(`SELECT expected.table_name, expected.column_name
      FROM unnest($1::text[], $2::text[]) AS expected(table_name, column_name)
      LEFT JOIN information_schema.columns actual ON actual.table_schema = 'public'
        AND actual.table_name = expected.table_name AND actual.column_name = expected.column_name
      WHERE actual.column_name IS NULL ORDER BY expected.table_name, expected.column_name`, [columnTables, columnNames]),
    client.query(`SELECT conrelid::regclass::text AS table_name, conname
      FROM pg_constraint WHERE connamespace = 'public'::regnamespace
        AND contype IN ('f', 'c') AND NOT convalidated ORDER BY table_name, conname`),
    client.query(`SELECT indexes.indexrelid::regclass::text AS index_name, indexes.indrelid::regclass::text AS table_name
      FROM pg_index AS indexes
      JOIN pg_class AS relation ON relation.oid = indexes.indrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND (NOT indexes.indisvalid OR NOT indexes.indisready)
      ORDER BY table_name, index_name`),
    client.query(COLUMN_FINGERPRINT_QUERY),
    client.query(CONSTRAINT_FINGERPRINT_QUERY),
    client.query(INDEX_FINGERPRINT_QUERY),
  ]);
  return {
    transactionReadOnly: session.rows[0]?.transaction_read_only,
    missingTables: missingTables.rows.map(row => row.table_name),
    missingColumns: missingColumns.rows.map(row => `${row.table_name}.${row.column_name}`),
    unvalidatedConstraints: unvalidatedConstraints.rows,
    invalidIndexes: invalidIndexes.rows,
    fingerprints: {
      column: column.rows[0]?.fingerprint,
      constraint: constraint.rows[0]?.fingerprint,
      index: index.rows[0]?.fingerprint,
    },
  };
}

async function collectTargetReport(connectionString, label) {
  const target = validateSchemaDriftTarget(connectionString, label);
  const pool = new pg.Pool({
    connectionString,
    application_name: SCHEMA_DRIFT_APPLICATION_NAME,
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 30_000,
    lock_timeout: 5_000,
    idle_in_transaction_session_timeout: 15_000,
    ssl: { rejectUnauthorized: true },
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const report = await collectSchemaReport(client);
    await client.query("ROLLBACK");
    return { target: redactedTarget(target), ...report };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Original error is actionable. */ }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

export async function verifyStagingSchemaDrift(environment = process.env) {
  const baselineUrl = environment.SCHEMA_DRIFT_BASELINE_DATABASE_URL;
  const stagingUrl = environment.SCHEMA_DRIFT_STAGING_DATABASE_URL;
  const baselineTarget = validateSchemaDriftTarget(baselineUrl, "SCHEMA_DRIFT_BASELINE_DATABASE_URL");
  const stagingTarget = validateSchemaDriftTarget(stagingUrl, "SCHEMA_DRIFT_STAGING_DATABASE_URL");
  requireDistinctTargets(baselineTarget, stagingTarget);
  const sqlPath = join(dirname(fileURLToPath(import.meta.url)), "staging-schema-drift-and-synthetic-fixture-verification.sql");
  assertReadOnlyQueryPack(await readFile(sqlPath, "utf8"));
  const [baseline, staging] = await Promise.all([
    collectTargetReport(baselineUrl, "SCHEMA_DRIFT_BASELINE_DATABASE_URL"),
    collectTargetReport(stagingUrl, "SCHEMA_DRIFT_STAGING_DATABASE_URL"),
  ]);
  assertSchemaComparison(baseline, staging);
  return {
    status: "passed",
    scope: "protected-staging-schema-drift-only",
    baseline: baseline.target,
    staging: staging.target,
    fingerprints: baseline.fingerprints,
    fixturePopulationVerified: false,
    noReadinessCredit: true,
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  verifyStagingSchemaDrift().then(result => {
    console.log(JSON.stringify(result, null, 2));
  }).catch(error => {
    console.error(`Staging schema-drift verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
