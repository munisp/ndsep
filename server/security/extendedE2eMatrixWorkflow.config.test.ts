import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const workflow = readFileSync(path.join(root, ".github/workflows/extended-e2e-matrix.yml"), "utf8");
const verifier = readFileSync(path.join(root, "scripts/ci/verify-e2e-matrix-artifacts.mjs"), "utf8");
const manifestWriter = readFileSync(path.join(root, "scripts/ci/write-e2e-shard-manifest.mjs"), "utf8");
const visualSuite = readFileSync(path.join(root, "e2e/visual-regression.spec.ts"), "utf8");

describe("extended E2E matrix workflow contract", () => {
  it("declares exactly the eight required first-attempt Chromium shards", () => {
    const expected = [
      ["auth", "e2e/auth.spec.ts", 12],
      ["critical-flows", "e2e/critical-flows.spec.ts", 34],
      ["dpco-onboarding", "e2e/dpco-onboarding.spec.ts", 20],
      ["enforcement-loop", "e2e/enforcement-loop.spec.ts", 24],
      ["penalty-enforcement", "e2e/penalty-enforcement.spec.ts", 18],
      ["temporal-kafka", "e2e/temporal-kafka.spec.ts", 16],
      ["critical-workflows", "e2e/tests/critical-workflows.spec.ts", 15],
      ["visual-regression", "e2e/visual-regression.spec.ts", 12],
    ] as const;

    expect(workflow).toContain("fail-fast: false");
    expect(workflow.match(/^ {10}- id:/gm)).toHaveLength(8);
    for (const [id, spec, testCount] of expected) {
      expect(workflow).toContain(`          - id: ${id}`);
      expect(workflow).toContain(`            spec: ${spec}`);
      expect(workflow).toContain(`            expected_tests: ${testCount}`);
      expect(verifier).toContain(`{ id: "${id}", project: "chromium", expectedTests: ${testCount} }`);
    }
  });

  it("requires a disposable PostgreSQL database and a unique candidate-bound artifact directory per shard", () => {
    expect(workflow).toContain("image: postgres:16-alpine");
    expect(workflow).toContain("DATABASE_URL: postgresql://ndsep_user:ndsep_test_pass@127.0.0.1:5432/ndsep_test");
    expect(workflow).toContain("E2E_CANDIDATE_COMMIT: ${{ github.sha }}");
    expect(workflow).toContain("E2E_TEST_RUN_ID: ${{ github.run_id }}-${{ matrix.id }}-${{ matrix.project }}");
    expect(workflow).toContain("E2E_ARTIFACT_DIRECTORY: test-results/${{ matrix.id }}-${{ matrix.project }}");
    const testStep = workflow.indexOf("Run release-grade E2E shard without retry masking");
    const manifestStep = workflow.indexOf("Write candidate-bound shard manifest after Playwright output initialization");
    expect(testStep).toBeGreaterThan(-1);
    expect(manifestStep).toBeGreaterThan(testStep);
    expect(workflow.slice(manifestStep, manifestStep + 220)).toContain("if: always()");
    expect(workflow).toContain("node scripts/ci/write-e2e-shard-manifest.mjs");
    expect(manifestWriter).toContain("E2E_CANDIDATE_COMMIT must be a full 40-character Git commit SHA");
    expect(manifestWriter).toContain("candidateCommit");
  });

  it("forbids release-tier retry masking and requires per-shard retained diagnostics", () => {
    expect(workflow).toContain("--workers=1");
    expect(workflow).toContain("--retries=0");
    expect(workflow).toContain("--reporter=line,json");
    expect(workflow).toContain("Collect per-shard diagnostics in its evidence directory");
    expect(workflow).toContain("retention-days: 30");
  });

  it("keeps visual checks bound to the isolated shard URL and never updates baselines automatically", () => {
    expect(visualSuite).toContain('const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000"');
    expect(visualSuite).toContain("const SNAPSHOT_PAGES = [");
    expect((visualSuite.match(/name: "/g) ?? [])).toHaveLength(10);
    const visualMatrixEntry = workflow.slice(workflow.indexOf("- id: visual-regression"), workflow.indexOf("- name: Write candidate-bound shard manifest"));
    expect(visualMatrixEntry).not.toContain("--update-snapshots");
  });

  it("runs a mandatory artifact fan-in verifier that rejects missing or retried evidence", () => {
    expect(workflow).toContain("verify-e2e-matrix:");
    expect(workflow).toContain("actions/download-artifact@v4");
    expect(workflow).toContain("node scripts/ci/verify-e2e-matrix-artifacts.mjs");
    expect(verifier).toContain("missing required shard artifact directory");
    expect(verifier).toContain("flaky/retried test");
    expect(verifier).toContain("status: \"complete_without_retries\"");
  });
});
