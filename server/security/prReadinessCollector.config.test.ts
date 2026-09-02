import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relative: string) =>
  fs.readFileSync(path.join(root, relative), "utf8");

describe("PR readiness collector source contract", () => {
  it("collects current review/check evidence read-only and never performs a GitHub mutation", () => {
    const script = read("scripts/ci/collect-pr-readiness-evidence.mjs");
    expect(script).toContain("READ_ONLY_PR_READINESS_COLLECTION");
    expect(script).toContain('"pr", "view"');
    expect(script).toContain("review.commit?.oid === head");
    expect(script).toContain("independentApprovalAtHead");
    expect(script).not.toContain('["pr", "review"');
    expect(script).not.toContain('["pr", "merge"');
    expect(script).not.toContain('["workflow", "run"');
    expect(script).not.toContain('["api", "--method", "POST"');
    expect(script).not.toContain('["api", "--method", "PUT"');
    expect(script).not.toContain('["api", "--method", "PATCH"');
    expect(script).not.toContain('["api", "--method", "DELETE"');
    expect(script).not.toContain('"--update-snapshots"');
  });

  it("uses exact Playwright discovery rather than a hard-coded visual baseline list", () => {
    const script = read("scripts/ci/collect-pr-readiness-evidence.mjs");
    expect(script).toContain('"e2e/visual-regression.spec.ts"');
    expect(script).toContain(
      '"--project=chromium", "--list", "--reporter=line"'
    );
    expect(script).toContain('PLAYWRIGHT_HTML_OPEN: "never"');
    expect(script).toContain("Visual baseline review set");
    expect(script).not.toContain('"login-page", "dashboard-home"');
  });

  it("records missing immediate and production evidence as blocked rather than creating approvals", () => {
    const script = read("scripts/ci/collect-pr-readiness-evidence.mjs");
    expect(script).toContain("GOV-001");
    expect(script).toContain("E2E-001");
    expect(script).toContain("SEC-001");
    expect(script).toContain("complianceBaselineRegister");
    expect(script).toContain("not evidenced by this read-only PR collector");
    expect(script).toContain(
      'process.exitCode = report.decision.status === "BLOCKED" ? 1 : 0'
    );
  });

  it("is wired into the protected source-control security gate", () => {
    const workflow = read(".github/workflows/security-gate.yml");
    expect(workflow).toContain(
      "server/security/prReadinessCollector.config.test.ts"
    );
  });
});
