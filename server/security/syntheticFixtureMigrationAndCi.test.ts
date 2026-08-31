import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REMAINING_FIXTURE_TABLES,
  requireFixtureTablesPopulated,
} from "../../scripts/seed-remaining-synthetic-fixtures.mjs";

const root = resolve(import.meta.dirname, "../..");
const schemaMigrationPath = resolve(root, "drizzle/0035_digital_twin_noc_runtime_schema.sql");
const journalPath = resolve(root, "drizzle/meta/_journal.json");
const fixtureSqlPath = resolve(root, "scripts/fixtures/seed_remaining_synthetic_fixtures.sql");
const securityWorkflowPath = resolve(root, ".github/workflows/security-gate.yml");
const fixtureRunnerPath = resolve(root, "scripts/seed-remaining-synthetic-fixtures.mjs");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("synthetic fixture schema and CI controls", () => {
  it("registers a DDL-only active migration for the digital-twin and NOC parent schemas", () => {
    const migration = read(schemaMigrationPath);
    const journal = JSON.parse(read(journalPath)) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries).toContainEqual({
      idx: 35,
      version: "7",
      when: 1788219175186,
      tag: "0035_digital_twin_noc_runtime_schema",
      breakpoints: true,
    });
    expect(migration).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|COPY)\b/im);
    for (const table of [
      "dt_jurisdictions",
      "dt_policies",
      "dt_org_agents",
      "dt_simulations",
      "dt_simulation_results",
      "dt_monte_carlo_stats",
      "dt_policy_impacts",
      "dt_sandboxes",
      "noc_agent_memory",
    ]) {
      expect(migration).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`));
    }
  });

  it("ships an idempotent synthetic-only SQL extension for all 15 truly uncovered tables", () => {
    const fixtureSql = read(fixtureSqlPath);
    expect(REMAINING_FIXTURE_TABLES).toHaveLength(15);
    expect(new Set(REMAINING_FIXTURE_TABLES).size).toBe(15);
    for (const table of REMAINING_FIXTURE_TABLES) {
      expect(fixtureSql).toMatch(new RegExp(`INSERT INTO ${table}\\s*\\(`));
    }
    expect(read(fixtureRunnerPath)).toContain("SYNTHETIC_SEED_CONFIRMATION");
    expect(fixtureSql).toContain("https://example.invalid/");
    expect(fixtureSql).toContain("not_production_evidence");
    expect(fixtureSql).not.toMatch(/^\s*(COMMIT|ROLLBACK|START\s+TRANSACTION)\b/im);
  });

  it("fails if its intended 15-table fixture scope is not populated", () => {
    expect(() => requireFixtureTablesPopulated({ emptyTables: ["dt_simulations", "noc_agent_memory"] })).toThrow(
      "Synthetic fixture extension did not populate required table(s): dt_simulations, noc_agent_memory"
    );
    expect(requireFixtureTablesPopulated({ emptyTables: ["unrelated_table"] })).toEqual({
      emptyTables: ["unrelated_table"],
    });
  });

  it("makes source-level fixture, governance, and collector tamper checks a dependency of the aggregate Security Gate", () => {
    const workflow = read(securityWorkflowPath);
    expect(workflow).toContain("evidence-contract-verification:");
    expect(workflow).toContain("name: evidence-contract-verification");
    expect(workflow).toContain("permissions:\n      contents: read");
    expect(workflow).toContain("persist-credentials: false");
    for (const testPath of [
      "server/security/syntheticSeedSafety.test.ts",
      "server/security/syntheticFixturePlan.test.ts",
      "server/security/stagingReleaseEvidenceCollector.test.ts",
      "server/security/releaseEvidenceNormalizer.test.ts",
      "server/security/postMergeGovernanceVerifier.test.ts",
      "server/security/releaseArtifactHardening.config.test.ts",
    ]) {
      expect(workflow).toContain(testPath);
    }
    expect(workflow).toContain("- evidence-contract-verification");
    expect(workflow).toContain('[[ "${{ needs.evidence-contract-verification.result }}" == "success" ]]');
    expect(workflow).toContain("SYNTHETIC_SEED_CONFIRMATION");
    expect(workflow).toContain("0035_digital_twin_noc_runtime_schema");
  });
});
