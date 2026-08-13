/**
 * NDSEP database migration verification.
 *
 * The readiness path calls this verifier after the canonical Drizzle migration
 * chain has run. It intentionally fails closed for missing core schema,
 * incomplete migration history, referential-integrity gaps, or unindexed
 * foreign keys that would make parent deletes and relational queries degrade.
 */
import { Pool } from "pg";
import { getDatabaseUrl } from "./config";
import { getPgSslConfig } from "./dbSslConfig";
import { logger } from "./logger";

export interface MigrationCheck {
  name: string;
  status: "pass" | "fail" | "warn";
  details: string;
}

export interface VerificationReport {
  passed: boolean;
  checks: MigrationCheck[];
  duration: number;
}

const CRITICAL_TABLES = [
  "users", "organizations", "audit_logs", "citizen_requests",
  "breach_incidents", "consent_records", "dpia_assessments",
  "dpco_organisations", "dpco_audit_engagements", "transfer_instruments",
  "analytics_snapshots", "compliance_calendar_events", "consent_records_v2",
  "notification_inbox", "public_compliance_registry", "api_rate_limit_stats",
  "whistleblower_cases", "penalty_calculations",
] as const;

const CRITICAL_COLUMNS = [
  ["users", "open_id"],
  ["users", "name"],
  ["users", "role"],
  ["organizations", "compliance_score"],
  ["citizen_requests", "citizen_email"],
  ["audit_logs", "action"],
  ["consent_records_v2", "organization_id"],
  ["penalty_calculations", "org_id"],
  ["public_compliance_registry", "is_published"],
] as const;

const EXPECTED_MIGRATION_COUNT = 29;
const MINIMUM_TABLE_COUNT = 153;
const MINIMUM_FOREIGN_KEY_COUNT = 83;

function pushCheck(checks: MigrationCheck[], name: string, ok: boolean, details: string, statusWhenFalse: "fail" | "warn" = "fail") {
  checks.push({ name, status: ok ? "pass" : statusWhenFalse, details });
}

export async function verifyMigrations(): Promise<VerificationReport> {
  const pool = new Pool({ connectionString: getDatabaseUrl(), ssl: getPgSslConfig(), max: 2 });
  const startedAt = Date.now();
  const checks: MigrationCheck[] = [];

  try {
    for (const table of CRITICAL_TABLES) {
      const { rows } = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1
        ) AS exists`,
        [table],
      );
      pushCheck(checks, `table_exists:${table}`, rows[0]?.exists === true,
        rows[0]?.exists ? `Table ${table} exists` : `MISSING: table ${table}`);
    }

    for (const [table, column] of CRITICAL_COLUMNS) {
      const { rows } = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
        ) AS exists`,
        [table, column],
      );
      pushCheck(checks, `column_exists:${table}.${column}`, rows[0]?.exists === true,
        rows[0]?.exists ? `${table}.${column} exists` : `MISSING: ${table}.${column}`);
    }

    const { rows: [tableCount] } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pg_tables WHERE schemaname = 'public'`,
    );
    pushCheck(checks, "table_count", Number(tableCount.count) >= MINIMUM_TABLE_COUNT,
      `${tableCount.count} public tables (minimum ${MINIMUM_TABLE_COUNT})`);

    const { rows: [migrationCount] } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM drizzle.__drizzle_migrations`,
    );
    pushCheck(checks, "drizzle_migration_history", Number(migrationCount.count) >= EXPECTED_MIGRATION_COUNT,
      `${migrationCount.count} recorded Drizzle migrations (minimum ${EXPECTED_MIGRATION_COUNT})`);

    const { rows: [indexCount] } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pg_indexes WHERE schemaname = 'public'`,
    );
    pushCheck(checks, "index_count", Number(indexCount.count) >= 300,
      `${indexCount.count} indexes found (minimum 300)`, "warn");

    const { rows: [foreignKeyCount] } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pg_constraint
       WHERE contype = 'f' AND connamespace = 'public'::regnamespace`,
    );
    pushCheck(checks, "foreign_key_count", Number(foreignKeyCount.count) >= MINIMUM_FOREIGN_KEY_COUNT,
      `${foreignKeyCount.count} foreign keys (minimum ${MINIMUM_FOREIGN_KEY_COUNT})`);

    const { rows: [unindexedForeignKeyCount] } = await pool.query<{ count: string }>(`
      WITH foreign_keys AS (
        SELECT conrelid, conkey::smallint[] AS key_columns
        FROM pg_constraint
        WHERE contype = 'f' AND connamespace = 'public'::regnamespace
      ), indexes AS (
        SELECT indrelid, array_to_string(indkey::smallint[], ' ') AS key_columns
        FROM pg_index
        WHERE indisvalid AND indisready
      )
      SELECT COUNT(*)::text AS count
      FROM foreign_keys fk
      WHERE NOT EXISTS (
        SELECT 1 FROM indexes i
        WHERE i.indrelid = fk.conrelid
          AND (i.key_columns = array_to_string(fk.key_columns, ' ')
            OR i.key_columns LIKE array_to_string(fk.key_columns, ' ') || ' %')
      )
    `);
    pushCheck(checks, "foreign_key_index_coverage", Number(unindexedForeignKeyCount.count) === 0,
      `${unindexedForeignKeyCount.count} foreign keys lack a leading index`);

    for (const table of ["users", "organizations"] as const) {
      const { rows: [row] } = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
      checks.push({ name: `row_count:${table}`, status: "pass", details: `${table}: ${row.count} rows` });
    }
  } catch (error) {
    checks.push({
      name: "migration_verifier_execution",
      status: "fail",
      details: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await pool.end();
  }

  const report: VerificationReport = {
    passed: checks.every((check) => check.status !== "fail"),
    checks,
    duration: Date.now() - startedAt,
  };

  if (report.passed) logger.info({ checks: checks.length, duration: report.duration }, "[Migration] Verification passed");
  else logger.error({ failures: checks.filter((check) => check.status === "fail") }, "[Migration] Verification failed");
  return report;
}
