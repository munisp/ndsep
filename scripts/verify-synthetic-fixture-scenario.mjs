#!/usr/bin/env node
/**
 * Verifies a synthetic demonstration scenario against the source-controlled
 * uncovered-table manifest. This is not a production readiness, compliance,
 * release, residency, or all-public-tables-populated verifier.
 *
 * Usage:
 *   SYNTHETIC_SEED_CONFIRMATION=NDSEP_SYNTHETIC_DATA_ONLY \
 *     DATABASE_URL=postgresql://.../ndsep_synthetic \
 *     pnpm seed:verify:scenario -- --allow-runtime-exemptions
 */
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  getSyntheticSeedPoolOptions,
  inspectPublicTableCoverage,
  summarizePublicTableCoverage,
} from "./lib/synthetic-seed-safety.mjs";
import {
  evaluateSyntheticFixtureCoverage,
  loadSyntheticFixturePlan,
  requireSyntheticFixtureScenario,
} from "./lib/synthetic-fixture-plan.mjs";

const expectedArgument = "--allow-runtime-exemptions";
if (process.argv.length !== 3 || process.argv[2] !== expectedArgument) {
  throw new Error(`Scenario verification requires the exact argument ${expectedArgument}`);
}

const pool = new pg.Pool(getSyntheticSeedPoolOptions(process.env));
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(scriptDirectory, "fixtures", "uncovered-table-scenario-manifest.json");

async function main() {
  const client = await pool.connect();
  try {
    const coverageSummary = summarizePublicTableCoverage(await inspectPublicTableCoverage(client));
    const manifest = await loadSyntheticFixturePlan(manifestPath);
    const scenarioReport = evaluateSyntheticFixtureCoverage(coverageSummary, manifest);
    console.log(JSON.stringify({ coverageSummary, scenarioReport }, null, 2));
    requireSyntheticFixtureScenario(scenarioReport);
    if (!coverageSummary.complete) {
      console.warn("Synthetic scenario is complete under expiring runtime-owned exemptions; all public tables are not populated and no readiness credit is granted.");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Synthetic fixture scenario verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
