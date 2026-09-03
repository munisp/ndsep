#!/usr/bin/env node
/**
 * Apply the schema-aware synthetic fixture extension after the main synthetic
 * seed path. This command is guarded by synthetic-seed-safety and is never a
 * production, release-evidence, or compliance-evidence loader.
 *
 * Usage:
 *   SYNTHETIC_SEED_CONFIRMATION=NDSEP_SYNTHETIC_DATA_ONLY \
 *     DATABASE_URL=postgresql://.../ndsep_synthetic \
 *     node scripts/seed-remaining-synthetic-fixtures.mjs
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import {
  getSyntheticSeedPoolOptions,
  inspectPublicTableCoverage,
  summarizePublicTableCoverage,
} from "./lib/synthetic-seed-safety.mjs";

export const REMAINING_FIXTURE_TABLES = Object.freeze([
  "analytics_snapshots",
  "article40_codes",
  "dpco_audit_service_records",
  "dpco_registry_service_records",
  "dpco_verification_service_records",
  "dt_monte_carlo_stats",
  "dt_org_agents",
  "dt_policy_impacts",
  "dt_sandboxes",
  "dt_simulation_results",
  "dt_simulations",
  "marketplace_plugins",
  "mobile_push_devices",
  "noc_agent_memory",
  "onboarding_checklists",
]);

export function requireFixtureTablesPopulated(coverageSummary) {
  if (!coverageSummary || !Array.isArray(coverageSummary.emptyTables)) {
    throw new Error("Synthetic fixture coverage summary is invalid");
  }
  const missing = REMAINING_FIXTURE_TABLES.filter(table => coverageSummary.emptyTables.includes(table));
  if (missing.length > 0) {
    throw new Error(`Synthetic fixture extension did not populate required table(s): ${missing.join(", ")}`);
  }
  return coverageSummary;
}

async function main() {
  const sqlPath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "seed_remaining_synthetic_fixtures.sql");
  const sql = await readFile(sqlPath, "utf8");
  if (!sql.trim()) throw new Error("Synthetic fixture extension SQL is empty");

  const pool = new pg.Pool(getSyntheticSeedPoolOptions(process.env));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");

    const coverageSummary = summarizePublicTableCoverage(await inspectPublicTableCoverage(client));
    requireFixtureTablesPopulated(coverageSummary);
    console.log(JSON.stringify({
      status: "passed",
      scope: "remaining-synthetic-fixture-extension-only",
      populatedTables: REMAINING_FIXTURE_TABLES,
      allPublicTablesPopulated: coverageSummary.complete,
      emptyTables: coverageSummary.emptyTables,
      noReadinessCredit: true,
    }, null, 2));
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The original database error remains the actionable failure.
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(`Remaining synthetic fixture extension failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
