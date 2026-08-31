#!/usr/bin/env node
/**
 * Read-only verifier for the synthetic seed environment.
 *
 * Usage (synthetic, non-production database only):
 *   SYNTHETIC_SEED_CONFIRMATION=NDSEP_SYNTHETIC_DATA_ONLY \
 *     DATABASE_URL=postgresql://.../ndsep_synthetic pnpm seed:verify
 *
 * The command never writes data. It reports the live public table count and
 * exits nonzero if even one table has zero rows.
 */
import pg from "pg";
import {
  getSyntheticSeedPoolOptions,
  inspectPublicTableCoverage,
  requireCompleteSyntheticSeed,
  summarizePublicTableCoverage,
} from "./lib/synthetic-seed-safety.mjs";

const pool = new pg.Pool(getSyntheticSeedPoolOptions(process.env));

async function main() {
  const client = await pool.connect();
  try {
    const coverage = await inspectPublicTableCoverage(client);
    const summary = summarizePublicTableCoverage(coverage);
    console.log(JSON.stringify(summary, null, 2));
    requireCompleteSyntheticSeed(summary);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Synthetic seed coverage verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
