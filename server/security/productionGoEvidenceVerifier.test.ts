import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyProductionGoEvidence } from "../../scripts/ci/verify-production-go-evidence.mjs";

const DIGEST = "a".repeat(64);
const SOURCE = "b".repeat(40);
const IMAGE = `ghcr.io/munisp/ndsep@sha256:${DIGEST}`;
const URI = "https://github.com/munisp/ndsep/actions/runs/123/artifacts/evidence";
const directories: string[] = [];

async function directory() {
  const value = await mkdtemp(join(tmpdir(), "ndsep-production-go-"));
  directories.push(value);
  return value;
}

async function put(dir: string, name: string, value: unknown) {
  await writeFile(join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
}

const passedChecks = (names: string[]) => names.map(name => ({ name, status: "passed" }));

async function writeCompleteEvidence(dir: string) {
  await put(dir, "candidate.json", {
    image: IMAGE,
    sourceCommit: SOURCE,
    builtAt: "2026-09-01T20:00:00.000Z",
    releaseWorkflow: { path: ".github/workflows/ci.yml", runId: 123, evidenceUri: URI },
  });
  await put(dir, "trivy.json", { scanner: "trivy", mode: "direct-image", scanTarget: IMAGE, results: [] });
  await put(dir, "artifact-evidence.json", {
    sbom: { imageDigest: DIGEST, verified: true, uri: `${URI}/sbom`, sha256: "c".repeat(64), format: "CycloneDX" },
    provenance: {
      imageDigest: DIGEST, verified: true, uri: `${URI}/provenance`, sha256: "d".repeat(64), format: "SLSA",
      verification: { subjectDigestBound: true },
    },
    cosign: {
      imageDigest: DIGEST, verified: true, uri: `${URI}/cosign`, sha256: "e".repeat(64),
      certificateIdentity: "https://github.com/munisp/ndsep/.github/workflows/ci.yml@refs/heads/production",
      verification: { issuer: "https://token.actions.githubusercontent.com" },
    },
  });
  await put(dir, "governance.json", {
    branch: "production", requiredApprovals: 2, requireCodeOwnerReviews: true,
    dismissStaleReviews: true, requireLastPushApproval: true, strictStatusChecks: true,
    enforceAdmins: true, allowForcePushes: false, allowDeletions: false, codeownersErrors: [],
    productionReleaseEnvironment: { protected: true, preventSelfReview: true, requiredReviewers: true, allowAdminBypass: false },
    mergedPullRequest: {
      number: 18, merged: true, mergeCommit: SOURCE, author: "pr-author", mergedAt: "2026-09-01T19:00:00.000Z", evidenceUri: `${URI}/merge`,
      approvals: [
        { state: "APPROVED", actor: "security-reviewer", submittedAt: "2026-09-01T18:00:00.000Z", evidenceUri: `${URI}/review-security` },
        { state: "APPROVED", actor: "platform-reviewer", submittedAt: "2026-09-01T18:05:00.000Z", evidenceUri: `${URI}/review-platform` },
      ],
    },
  });
  await put(dir, "staging-deployment.json", {
    environment: "staging", protectedEnvironment: true, deploymentDigest: DIGEST, deploymentCommit: SOURCE,
    status: "passed", mtlsContract: "passed", authorizationNegativePath: "passed", workflowRunId: 456, evidenceUri: `${URI}/staging`,
    checks: passedChecks(["candidate-health", "image-lock", "rollback", "database-recovery", "network-policy", "pwa-smoke", "mobile-smoke"]),
  });
  const services = ["postgresql", "tigerbeetle", "redis", "mojaloop", "kafka", "apisix", "keycloak", "openappsec", "permify", "opensearch", "fluvio", "dapr", "temporal", "lakehouse"]
    .map(name => ({ name, status: "passed", digest: DIGEST, evidenceUri: `${URI}/services/${name}`, workflowRunId: 456 }));
  await put(dir, "service-matrix.json", { services });
  await put(dir, "postgres-integrity.json", {
    status: "passed", candidateDigest: DIGEST, workflowRunId: 457, evidenceUri: `${URI}/postgres`,
    checks: passedChecks(["encrypted-backup-restore", "forced-rls-denial", "ledger-recompute", "advisory-lock-concurrency"]),
  });
  await put(dir, "resilience.json", {
    status: "passed", candidateDigest: DIGEST, workflowRunId: 458, evidenceUri: `${URI}/resilience`,
    checks: passedChecks(["stateful-service-fault-recovery", "alert-escalation", "reconciliation"]),
  });
  await put(dir, "residency-evidence.json", {
    status: "passed", candidateDigest: DIGEST, workflowRunId: 459, evidenceUri: `${URI}/residency`,
    checks: passedChecks(["signed-evidence-verification", "replay-rejection", "merkle-transparency", "appeal-workflow"]),
  });
  const roles = ["release-security", "security", "sre", "data-owner", "compliance-evidence-verifier", "engineering-owner", "compliance-officer", "business-owner", "release-manager"];
  await put(dir, "approvals.json", {
    candidateDigest: DIGEST,
    acceptances: roles.map((role, index) => ({
      role, decision: "accepted", actor: `${role}-approver`, acceptedAt: `2026-09-01T20:0${index}:00.000Z`, evidenceUri: `${URI}/approvals/${role}`,
    })),
  });
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(item => rm(item, { recursive: true, force: true })));
});

describe("95-point production GO evidence verifier", () => {
  it("accepts complete digest-bound, independently approved production evidence", async () => {
    const dir = await directory();
    await writeCompleteEvidence(dir);
    expect(verifyProductionGoEvidence(dir)).toEqual({ status: "passed", threshold: "95/100", evidenceDirectory: dir, errors: [] });
  });

  it("blocks self-approval even when basic readiness evidence is complete", async () => {
    const dir = await directory();
    await writeCompleteEvidence(dir);
    const governance = JSON.parse(await (await import("node:fs/promises")).readFile(join(dir, "governance.json"), "utf8"));
    governance.mergedPullRequest.approvals[0].actor = "pr-author";
    await put(dir, "governance.json", governance);
    const result = verifyProductionGoEvidence(dir);
    expect(result.status).toBe("blocked");
    expect(result.errors).toContain("governance.json: two independent, timestamped approval records are required");
  });

  it("blocks an otherwise complete pack without a passed protected-staging recovery check", async () => {
    const dir = await directory();
    await writeCompleteEvidence(dir);
    const staging = JSON.parse(await (await import("node:fs/promises")).readFile(join(dir, "staging-deployment.json"), "utf8"));
    staging.checks = staging.checks.filter((item: { name: string }) => item.name !== "database-recovery");
    await put(dir, "staging-deployment.json", staging);
    const result = verifyProductionGoEvidence(dir);
    expect(result.status).toBe("blocked");
    expect(result.errors).toContain("staging-deployment.json: mandatory 'database-recovery' check is absent or failed");
  });
});
