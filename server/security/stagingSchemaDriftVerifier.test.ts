import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertReadOnlyQueryPack,
  assertSchemaComparison,
  getVerifiedSchemaDriftSslConfig,
  requireDistinctTargets,
  validateSchemaDriftTarget,
} from "../../scripts/ci/verify-staging-schema-drift.mjs";

const root = resolve(import.meta.dirname, "../..");
const queryPackPath = resolve(root, "scripts/ci/staging-schema-drift-and-synthetic-fixture-verification.sql");
const workflowPath = resolve(root, ".github/workflows/ci.yml");

function passingReport() {
  return {
    transactionReadOnly: "on",
    missingTables: [],
    missingColumns: [],
    unvalidatedConstraints: [],
    invalidIndexes: [],
    fingerprints: {
      column: "a".repeat(32),
      constraint: "b".repeat(32),
      index: "c".repeat(32),
    },
  };
}

describe("staging schema-drift verifier", () => {
  it("requires distinct non-production staging/synthetic PostgreSQL targets with verified TLS", () => {
    const baseline = validateSchemaDriftTarget(
      "postgresql://reader:secret@baseline.example.invalid:5432/ndsep_staging_baseline?sslmode=verify-full",
      "SCHEMA_DRIFT_BASELINE_DATABASE_URL"
    );
    const staging = validateSchemaDriftTarget(
      "postgresql://reader:secret@staging.example.invalid:5432/ndsep_staging_synthetic?sslmode=verify-full",
      "SCHEMA_DRIFT_STAGING_DATABASE_URL"
    );
    expect(() => requireDistinctTargets(baseline, staging)).not.toThrow();
    expect(() => validateSchemaDriftTarget(
      "postgresql://reader:secret@staging.example.invalid:5432/ndsep_production?sslmode=verify-full",
      "SCHEMA_DRIFT_STAGING_DATABASE_URL"
    )).toThrow(/production- or live-labelled/);
    expect(() => validateSchemaDriftTarget(
      "postgresql://reader:secret@staging.example.invalid:5432/ndsep_staging_synthetic?sslmode=require",
      "SCHEMA_DRIFT_STAGING_DATABASE_URL"
    )).toThrow(/sslmode=verify-full/);
    expect(() => requireDistinctTargets(baseline, baseline)).toThrow(/must be distinct/);
  });

  it("keeps certificate verification enabled and rejects malformed private CA bundles", () => {
    expect(getVerifiedSchemaDriftSslConfig({})).toEqual({ rejectUnauthorized: true });
    expect(getVerifiedSchemaDriftSslConfig({
      SCHEMA_DRIFT_DB_SSL_CA_PEM: "-----BEGIN CERTIFICATE-----\nsynthetic-ca\n-----END CERTIFICATE-----",
    })).toEqual({
      rejectUnauthorized: true,
      ca: "-----BEGIN CERTIFICATE-----\nsynthetic-ca\n-----END CERTIFICATE-----",
    });
    expect(() => getVerifiedSchemaDriftSslConfig({ SCHEMA_DRIFT_DB_SSL_CA_PEM: "not-a-pem" })).toThrow(/PEM certificate bundle/);
  });

  it("requires the tracked query pack to remain read-only and fingerprint-complete", async () => {
    const sql = await readFile(queryPackPath, "utf8");
    expect(() => assertReadOnlyQueryPack(sql)).not.toThrow();
    expect(() => assertReadOnlyQueryPack([
      "BEGIN TRANSACTION READ ONLY;",
      "SELECT 'schema_column_fingerprint';",
      "SELECT 'schema_constraint_fingerprint';",
      "SELECT 'schema_index_fingerprint';",
      "WITH fixture_counts AS (SELECT 1)",
      "INSERT INTO x VALUES (1);",
      "ROLLBACK;",
    ].join("\n"))).toThrow(/read-only/);
    expect(() => assertReadOnlyQueryPack("BEGIN TRANSACTION READ ONLY; ROLLBACK;")).toThrow(/missing required marker/);
  });

  it("fails closed on schema fingerprint mismatch or invalid schema health", () => {
    const baseline = passingReport();
    expect(() => assertSchemaComparison(baseline, passingReport())).not.toThrow();
    expect(() => assertSchemaComparison(baseline, {
      ...passingReport(),
      fingerprints: { ...passingReport().fingerprints, index: "d".repeat(32) },
    })).toThrow(/index fingerprint differs/);
    expect(() => assertSchemaComparison(baseline, {
      ...passingReport(),
      missingTables: ["dt_simulations"],
    })).toThrow(/missing required table/);
    expect(() => assertSchemaComparison(baseline, {
      ...passingReport(),
      transactionReadOnly: "off",
    })).toThrow(/not read-only/);
  });

  it("keeps the protected schema-drift job read-only, secret-scoped, and mandatory for publication", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    expect(workflow).toMatch(
      /schema-drift-verification:\s*\n\s+name: Protected Staging Schema Drift Verification[\s\S]*?environment:\s*\n\s+name: production-release[\s\S]*?if: github\.ref == 'refs\/heads\/production'/
    );
    expect(workflow).toMatch(/schema-drift-verification:[\s\S]*?permissions:\s*\n\s+contents: read/);
    expect(workflow).toMatch(/SCHEMA_DRIFT_BASELINE_DATABASE_URL: \$\{\{ secrets\.SCHEMA_DRIFT_BASELINE_DATABASE_URL \}\}/);
    expect(workflow).toMatch(/SCHEMA_DRIFT_STAGING_DATABASE_URL: \$\{\{ secrets\.SCHEMA_DRIFT_STAGING_DATABASE_URL \}\}/);
    expect(workflow).toMatch(/SCHEMA_DRIFT_DB_SSL_CA_PEM: \$\{\{ secrets\.SCHEMA_DRIFT_DB_SSL_CA_PEM \}\}/);
    expect(workflow).toMatch(/node scripts\/ci\/verify-staging-schema-drift\.mjs > schema-drift-verification\.json/);
    expect(workflow).toMatch(/docker:[\s\S]*?needs:\s*\[[\s\S]*?schema-drift-verification,[\s\S]*?\]/);
  });
});
