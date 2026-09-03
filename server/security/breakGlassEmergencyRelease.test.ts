import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAuditEvents,
  generateBreakGlassEvidence,
} from "../../scripts/ci/generate-break-glass-evidence.mjs";
import {
  parseApprovalComment,
  readAuthorizationPolicy,
  sha256,
  validateAuthorizationRecord,
  verifyBreakGlassAuthorization,
  verifyIndependentApprovals,
} from "../../scripts/ci/verify-break-glass-authorization.mjs";

const root = resolve(import.meta.dirname, "../..");
const repository = "munisp/ndsep";
const commit = "b".repeat(40);
const digest = `sha256:${"a".repeat(64)}`;
const now = new Date("2026-09-01T01:00:00.000Z");

function enabledPolicy() {
  return {
    schemaVersion: "ndsep.break-glass-authorization-policy.v1",
    policyId: "ndsep-production-break-glass",
    repository,
    environment: "production-release",
    enabled: true,
    maximumAuthorizationMinutes: 60,
    requiredIssueLabels: ["incident", "break-glass"],
    roles: {
      incident_commander: { allowedLogins: ["incident-lead"] },
      release_authority: { allowedLogins: ["release-lead"] },
      database_authority: { allowedLogins: ["database-lead"] },
    },
  };
}

function authorization() {
  return {
    schemaVersion: "ndsep.break-glass-authorization.v1",
    authorizationId: "BG-2026-ABCD",
    incident: {
      id: "INC-2026-SCHEMA-HOTFIX",
      severity: "P1",
      summarySha256: `sha256:${"c".repeat(64)}`,
    },
    candidate: {
      image: "ghcr.io/munisp/ndsep",
      digest,
      sourceCommit: commit,
    },
    schemaDrift: {
      workflowRunId: "123456",
      expectedMismatch: "column",
      baselineFingerprint: "d".repeat(32),
      stagingFingerprint: "e".repeat(32),
      queryPackSha256: `sha256:${"f".repeat(64)}`,
      falsePositiveAnalysisSha256: `sha256:${"1".repeat(64)}`,
    },
    scope: {
      environment: "production-release",
      operation: "emergency-security-hotfix",
      services: ["api"],
      notBefore: "2026-09-01T00:30:00.000Z",
      expiresAt: "2026-09-01T01:30:00.000Z",
    },
    hotfixAuthor: "hotfix-author",
  };
}

function approvalComment(role: string, actor: string, verified: ReturnType<typeof validateAuthorizationRecord>) {
  return {
    id: `${role}-${actor}`,
    body: `<!-- ndsep-break-glass-approval:v1 -->\nrole: ${role}\nauthorization_id: ${verified.authorization.authorizationId}\nauthorization_sha256: ${verified.authorizationSha256}\nexpires_at: ${verified.expiresAt.toISOString()}`,
    user: { login: actor },
    created_at: "2026-09-01T01:01:00.000Z",
    html_url: `https://github.com/${repository}/issues/99#issuecomment-${actor}`,
  };
}

async function withTempDirectory<T>(callback: (directory: string) => Promise<T> | T): Promise<T> {
  const directory = mkdtempSync(resolve(tmpdir(), "ndsep-break-glass-"));
  try {
    return await callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("digest-bound break-glass emergency controls", () => {
  it("fails closed while the committed policy has no authorized approvers", async () => {
    await expect(readAuthorizationPolicy(resolve(root, ".github/security/break-glass-authorization-policy.json")))
      .rejects.toThrow(/disabled until accountable approvers are configured/);
  });

  it("requires a live, digest-bound authorization and three distinct independent approvers", () => {
    const policy = enabledPolicy();
    const verified = validateAuthorizationRecord(authorization(), { repository, candidateDigest: digest, sourceCommit: commit }, policy, now);
    const incidentApproval = approvalComment("incident_commander", "incident-lead", verified);
    expect(parseApprovalComment(incidentApproval)).toMatchObject({
      role: "incident_commander",
      authorization_id: verified.authorization.authorizationId,
      authorization_sha256: verified.authorizationSha256,
      expires_at: verified.expiresAt.toISOString(),
    });
    const approvals = verifyIndependentApprovals([
      incidentApproval,
      approvalComment("release_authority", "release-lead", verified),
      approvalComment("database_authority", "database-lead", verified),
    ], verified, policy, "dispatch-actor");
    expect(approvals.map(approval => approval.actor)).toEqual(["incident-lead", "release-lead", "database-lead"]);
    expect(() => verifyIndependentApprovals([
      approvalComment("incident_commander", "incident-lead", verified),
      approvalComment("release_authority", "incident-lead", verified),
      approvalComment("database_authority", "database-lead", verified),
    ], verified, policy, "dispatch-actor")).toThrow(/Missing independent release_authority approval/);
    expect(() => validateAuthorizationRecord({ ...authorization(), candidate: { ...authorization().candidate, digest: `sha256:${"9".repeat(64)}` } },
      { repository, candidateDigest: digest, sourceCommit: commit }, policy, now)).toThrow(/candidate digest does not match/);
  });

  it("binds the issue authorization to the GitHub source-commit author and three read-only approval comments", async () => {
    await withTempDirectory(async directory => {
      const policyPath = resolve(directory, "policy.json");
      writeFileSync(policyPath, JSON.stringify(enabledPolicy()));
      const verified = validateAuthorizationRecord(authorization(), { repository, candidateDigest: digest, sourceCommit: commit }, enabledPolicy(), now);
      const issueBody = `<!-- ndsep-break-glass-authorization:v1 -->\n\`\`\`json\n${JSON.stringify(authorization())}\n\`\`\``;
      const comments = [
        approvalComment("incident_commander", "incident-lead", verified),
        approvalComment("release_authority", "release-lead", verified),
        approvalComment("database_authority", "database-lead", verified),
      ];
      const calls: string[] = [];
      const fetchImpl = async (url: string) => {
        calls.push(url);
        if (url.includes(`/issues/99/comments`)) return { ok: true, status: 200, statusText: "OK", json: async () => comments };
        if (url.includes(`/issues/99`)) return { ok: true, status: 200, statusText: "OK", json: async () => ({ body: issueBody, labels: [{ name: "incident" }, { name: "break-glass" }], html_url: `https://github.com/${repository}/issues/99` }) };
        if (url.includes(`/commits/${commit}`)) return { ok: true, status: 200, statusText: "OK", json: async () => ({ author: { login: "hotfix-author" } }) };
        throw new Error(`Unexpected URL ${url}`);
      };
      const result = await verifyBreakGlassAuthorization({
        issue: "99", repository, "candidate-digest": digest, "source-commit": commit,
        "dispatch-actor": "dispatch-actor", policy: policyPath, "out-dir": resolve(directory, "out"),
        now: now.toISOString(), "github-api-url": "https://api.github.com",
      }, { token: "test-token", fetchImpl });
      expect(result.output.independentApprovals).toHaveLength(3);
      expect(calls).toHaveLength(3);
      expect(readFileSync(result.outputPath, "utf8")).toContain("INC-2026-SCHEMA-HOTFIX");
    });
  });

  it("rejects expired authorizations and builds a chained audit ledger", () => {
    const policy = enabledPolicy();
    expect(() => validateAuthorizationRecord(authorization(), { repository, candidateDigest: digest, sourceCommit: commit }, policy,
      new Date("2026-09-01T01:31:00.000Z"))).toThrow(/not currently active/);
    const ledger = buildAuditEvents({
      generatedAt: now.toISOString(),
      workflow: { runId: 42, actor: "dispatch-actor", workflowRef: "https://github.com/munisp/ndsep/actions/workflows/digest-bound-emergency-release.yml@refs/heads/production" },
      candidate: { image: "ghcr.io/munisp/ndsep", digest, sourceCommit: commit },
      authorization: { id: "BG-2026-ABCD", sha256: `sha256:${"2".repeat(64)}`, incidentId: "INC-2026-SCHEMA-HOTFIX", expiresAt: "2026-09-01T01:30:00.000Z", scopeServices: ["api"], approvalActors: ["database-lead", "incident-lead", "release-lead"] },
      releaseEvidence: { sha256: `sha256:${"3".repeat(64)}`, highCriticalCount: 0, sbomSha256: `sha256:${"4".repeat(64)}` },
      cosignVerification: { sha256: `sha256:${"5".repeat(64)}` },
      provenanceVerification: { sha256: `sha256:${"6".repeat(64)}` },
    });
    expect(ledger.rows).toHaveLength(4);
    expect(ledger.rows[0].previousEventHash).toBe(`sha256:${"0".repeat(64)}`);
    expect(ledger.rows[1].previousEventHash).toBe(ledger.rows[0].eventHash);
    expect(ledger.rootHash).toBe(ledger.rows[3].eventHash);
  });

  it("writes a digest-bound evidence manifest and hashed source artifacts", async () => {
    await withTempDirectory(async directory => {
      const authorizationVerification = {
        schemaVersion: "ndsep.break-glass-authorization-verification.v1",
        repository,
        authorization: {
          id: "BG-2026-ABCD", sha256: `sha256:${"2".repeat(64)}`, incidentId: "INC-2026-SCHEMA-HOTFIX",
          candidate: { image: "ghcr.io/munisp/ndsep", digest, sourceCommit: commit },
          scope: { services: ["api"] }, expiresAt: "2026-09-01T01:30:00.000Z",
        },
        independentApprovals: [
          { role: "incident_commander", actor: "incident-lead" },
          { role: "release_authority", actor: "release-lead" },
          { role: "database_authority", actor: "database-lead" },
        ],
        noReadinessCredit: true,
      };
      const releaseEvidence = {
        schema: "ndsep.release-evidence.v1",
        image: { name: "ghcr.io/munisp/ndsep", digest },
        source_sha: commit,
        trivy: { high_critical_count: 0 },
        sbom: { sha256: `sha256:${"3".repeat(64)}` },
      };
      const authorizationPath = resolve(directory, "authorization.json");
      const releasePath = resolve(directory, "release.json");
      const cosignPath = resolve(directory, "cosign.json");
      const provenancePath = resolve(directory, "provenance.txt");
      writeFileSync(authorizationPath, JSON.stringify(authorizationVerification));
      writeFileSync(releasePath, JSON.stringify(releaseEvidence));
      writeFileSync(cosignPath, "[{\"critical\":{}}]\n");
      writeFileSync(provenancePath, "Verified attestation\n");
      const output = resolve(directory, "out");
      const result = await generateBreakGlassEvidence({
        "authorization-verification": authorizationPath,
        "release-evidence": releasePath,
        "cosign-verification": cosignPath,
        "provenance-verification": provenancePath,
        repository,
        "source-commit": commit,
        "candidate-digest": digest,
        "run-id": "42",
        actor: "dispatch-actor",
        "workflow-ref": "https://github.com/munisp/ndsep/actions/workflows/digest-bound-emergency-release.yml@refs/heads/production",
        "generated-at": now.toISOString(),
        "out-dir": output,
      });
      expect(result.manifest.integrity.attestationRequired).toBe(true);
      expect(result.manifest.artifacts.auditEvents.count).toBe(4);
      expect(readFileSync(result.rootPath, "utf8")).toContain("break-glass-evidence-manifest.json");
      expect(sha256(JSON.stringify(authorizationVerification))).toBe(result.manifest.authorization.verificationSha256);
      expect(readFileSync(result.auditPath, "utf8").trim().split("\n")).toHaveLength(4);
    });
  });

  it("keeps preflight and authorization workflows manual, protected, and non-deploying", () => {
    const authorizationWorkflow = readFileSync(resolve(root, ".github/workflows/digest-bound-emergency-release.yml"), "utf8");
    const preflightWorkflow = readFileSync(resolve(root, ".github/workflows/emergency-candidate-preflight.yml"), "utf8");
    expect(authorizationWorkflow).toContain("workflow_dispatch:");
    expect(authorizationWorkflow).toContain("AUTHORIZE_DIGEST_BOUND_BREAK_GLASS");
    expect(authorizationWorkflow).toContain("name: production-release");
    expect(authorizationWorkflow).toContain("issues: read");
    expect(authorizationWorkflow).toContain("packages: read");
    expect(authorizationWorkflow).toContain("verify-break-glass-authorization.mjs");
    expect(authorizationWorkflow).toContain("generate-break-glass-evidence.mjs");
    expect(authorizationWorkflow).toContain("actions/attest@0fae56888724ae3bba68e14ff82712d5c3d8e1f0");
    expect(authorizationWorkflow).toContain("Deployment performed: **no**");
    expect(authorizationWorkflow).not.toMatch(/git push|force push|--admin|bypass/i);
    expect(preflightWorkflow).toContain("PREPARE_SIGNED_EMERGENCY_CANDIDATE");
    expect(preflightWorkflow).toContain("deploymentPerformed:false");
    expect(preflightWorkflow).toContain("verify-release-image-evidence.sh");
  });
});
