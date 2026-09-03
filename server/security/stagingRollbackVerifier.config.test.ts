import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("staging rollback verifier source contract", () => {
  it("is staging-scoped, candidate-bound, and requires immutable rollback identity", () => {
    const script = read("scripts/security/verify-staging-rollback.ts");
    expect(script).toContain("STAGING_TEST_BASE_URL");
    expect(script).toContain("must use HTTPS");
    expect(script).toContain("must target a staging hostname");
    expect(script).toContain("STAGING_CANDIDATE_IMAGE_DIGEST");
    expect(script).toContain("STAGING_ROLLBACK_IMAGE_DIGEST");
    expect(script).toContain("sha256 immutable image digest");
    expect(script).toContain("STAGING_SOURCE_COMMIT must be a full commit SHA");
    expect(script).toContain("STAGING_ROLLBACK_DRILL_ID");
  });

  it("uses a named read-only PostgreSQL principal and never mutates data or traffic", () => {
    const script = read("scripts/security/verify-staging-rollback.ts");
    expect(script).toContain("STAGING_READONLY_DATABASE_URL");
    expect(script).toContain("STAGING_READONLY_DATABASE_USER");
    expect(script).toContain("STAGING_READONLY_DB_HOSTS");
    expect(script).toContain("BEGIN READ ONLY");
    expect(script).toContain("transaction_read_only");
    expect(script).toContain("has_table_privilege");
    expect(script).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b[^\n]*(?:domain_event_outbox|payment_commands|webhook_deliveries|audit_logs)/i);
    expect(script).not.toMatch(/\b(?:kubectl|helm|docker\s+(?:push|compose|build)|psql\s+-c)\b/i);
  });

  it("enforces every rollback smoke domain and emits a fail-closed sanitized report", () => {
    const script = read("scripts/security/verify-staging-rollback.ts");
    for (const id of ["RB-01", "RB-02", "RB-03", "RB-04", "RB-05", "RB-06", "RB-07", "RB-08", "RB-09", "RB-10", "RB-11", "RB-12", "RB-13", "RB-14", "RB-15", "RB-16", "RB-17"]) {
      expect(script).toContain(id);
    }
    expect(script).toContain("report.checks.length === 17");
    expect(script).toContain("domain_event_outbox");
    expect(script).toContain("payment_commands");
    expect(script).toContain("webhook_deliveries");
    expect(script).toContain("verifyAuditChain");
    expect(script).toContain("STAGING_ASYNC_RECONCILIATION_FILE");
    expect(script).toContain("STAGING_OBSERVABILITY_EVIDENCE_FILE");
    expect(script).toContain("STAGING_AUDIT_CHAIN_START_ID");
    expect(script).toContain("no backfill is permitted during verification");
    expect(script).toContain("rollback-verification.json");
    expect(script).toContain("process.exitCode = 1");
  });

  it("requires the workflow to run only on the protected staging runner and retain evidence", () => {
    const workflow = read(".github/workflows/staging-rollback-verification.yml");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("name: staging");
    expect(workflow).toContain("[self-hosted, linux, ndsep-staging-internal]");
    expect(workflow).toContain("EXECUTE_STAGING_ROLLBACK_VERIFICATION");
    expect(workflow).toContain("STAGING_READONLY_DATABASE_URL");
    expect(workflow).toContain("STAGING_AUDIT_CHAIN_START_ID");
    expect(workflow).toContain("STAGING_ROLLBACK_EVIDENCE_DIR");
    expect(workflow).toContain("pnpm exec tsx scripts/security/verify-staging-rollback.ts");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("retention-days: 365");
    expect(workflow).not.toContain("kubectl");
    expect(workflow).not.toContain("docker/build-push-action");
    expect(workflow).not.toContain("packages: write");
  });
});
