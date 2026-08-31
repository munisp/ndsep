import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyReadiness60Evidence } from "../../scripts/ci/verify-60-readiness-evidence.mjs";

const DIGEST = "a".repeat(64);
const IMAGE = `ghcr.io/munisp/ndsep@sha256:${DIGEST}`;
const temporaryDirectories: string[] = [];

async function createEvidenceDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "ndsep-readiness-60-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeEvidence(
  directory: string,
  filename: string,
  value: unknown
) {
  await writeFile(
    join(directory, filename),
    `${JSON.stringify(value, null, 2)}\n`
  );
}

async function writeValidEvidence(directory: string) {
  await writeEvidence(directory, "candidate.json", {
    image: IMAGE,
    sourceCommit: "b".repeat(40),
    builtAt: "2026-08-31T15:00:00.000Z",
  });
  await writeEvidence(directory, "trivy.json", {
    scanner: "trivy",
    mode: "direct-image",
    scanTarget: IMAGE,
    results: [],
  });
  await writeEvidence(directory, "artifact-evidence.json", {
    sbom: {
      imageDigest: DIGEST,
      verified: true,
      uri: "s3://evidence/sbom.cdx.json",
      format: "CycloneDX",
    },
    provenance: {
      imageDigest: DIGEST,
      verified: true,
      uri: "s3://evidence/provenance.json",
      format: "SLSA",
    },
    cosign: {
      imageDigest: DIGEST,
      verified: true,
      uri: "s3://evidence/cosign.json",
      certificateIdentity:
        "https://github.com/munisp/ndsep/.github/workflows/ci.yml@refs/heads/production",
    },
  });
  await writeEvidence(directory, "governance.json", {
    branch: "production",
    requiredApprovals: 2,
    requireCodeOwnerReviews: true,
    dismissStaleReviews: true,
    requireLastPushApproval: true,
    strictStatusChecks: true,
    enforceAdmins: true,
    allowForcePushes: false,
    allowDeletions: false,
    codeownersErrors: [],
    productionReleaseEnvironment: { protected: true, preventSelfReview: true },
  });
  await writeEvidence(directory, "staging-deployment.json", {
    environment: "staging",
    protectedEnvironment: true,
    deploymentDigest: DIGEST,
    status: "passed",
    mtlsContract: "passed",
    authorizationNegativePath: "passed",
    checks: [
      { name: "candidate-health", status: "passed" },
      { name: "image-lock", status: "passed" },
    ],
  });
  const services = [
    "postgresql",
    "tigerbeetle",
    "redis",
    "mojaloop",
    "kafka",
    "apisix",
    "keycloak",
    "openappsec",
    "permify",
    "opensearch",
    "fluvio",
  ].map(name => ({
    name,
    status: "passed",
    digest: DIGEST,
    evidenceUri: `s3://evidence/services/${name}.json`,
  }));
  await writeEvidence(directory, "service-matrix.json", { services });
  await writeEvidence(directory, "postgres-integrity.json", {
    status: "passed",
    checks: [
      "encrypted-backup-restore",
      "forced-rls-denial",
      "ledger-recompute",
      "advisory-lock-concurrency",
    ].map(name => ({ name, status: "passed" })),
  });
  await writeEvidence(directory, "resilience.json", {
    status: "passed",
    checks: [
      "stateful-service-fault-recovery",
      "alert-escalation",
      "reconciliation",
    ].map(name => ({ name, status: "passed" })),
  });
  await writeEvidence(directory, "residency-evidence.json", {
    status: "passed",
    checks: [
      "signed-evidence-verification",
      "replay-rejection",
      "merkle-transparency",
      "appeal-workflow",
    ].map(name => ({ name, status: "passed" })),
  });
  await writeEvidence(directory, "approvals.json", {
    candidateDigest: DIGEST,
    acceptances: [
      "release-security",
      "sre",
      "data-owner",
      "compliance-evidence-verifier",
      "security",
    ].map(role => ({ role, decision: "accepted" })),
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true }))
  );
});

describe("60-point readiness evidence verifier", () => {
  it("accepts a complete evidence pack bound to one candidate digest", async () => {
    const directory = await createEvidenceDirectory();
    await writeValidEvidence(directory);

    expect(verifyReadiness60Evidence(directory)).toEqual({
      status: "passed",
      threshold: "60/100",
      evidenceDirectory: directory,
      errors: [],
    });
  });

  it("fails closed when an SBOM is not in an explicitly accepted format", async () => {
    const directory = await createEvidenceDirectory();
    await writeValidEvidence(directory);
    await writeEvidence(directory, "artifact-evidence.json", {
      sbom: {
        imageDigest: DIGEST,
        verified: true,
        uri: "s3://evidence/sbom.unknown.json",
        format: "UNKNOWN",
      },
      provenance: {
        imageDigest: DIGEST,
        verified: true,
        uri: "s3://evidence/provenance.json",
        format: "SLSA",
      },
      cosign: {
        imageDigest: DIGEST,
        verified: true,
        uri: "s3://evidence/cosign.json",
        certificateIdentity:
          "https://github.com/munisp/ndsep/.github/workflows/ci.yml@refs/heads/production",
      },
    });

    const result = verifyReadiness60Evidence(directory);
    expect(result.status).toBe("blocked");
    expect(result.errors).toContain(
      "artifact-evidence.json: an SPDX or CycloneDX SBOM is required"
    );
  });

  it("fails closed when governance does not require code-owner review", async () => {
    const directory = await createEvidenceDirectory();
    await writeValidEvidence(directory);
    await writeEvidence(directory, "governance.json", {
      branch: "production",
      requiredApprovals: 2,
      requireCodeOwnerReviews: false,
      dismissStaleReviews: true,
      requireLastPushApproval: true,
      strictStatusChecks: true,
      enforceAdmins: true,
      allowForcePushes: false,
      allowDeletions: false,
      codeownersErrors: [],
      productionReleaseEnvironment: {
        protected: true,
        preventSelfReview: true,
      },
    });

    const result = verifyReadiness60Evidence(directory);
    expect(result.status).toBe("blocked");
    expect(result.errors).toContain(
      "governance.json: required CODEOWNER review is not enabled"
    );
  });

  it("fails closed when the direct image scan contains a critical vulnerability", async () => {
    const directory = await createEvidenceDirectory();
    await writeValidEvidence(directory);
    await writeEvidence(directory, "trivy.json", {
      scanner: "trivy",
      mode: "direct-image",
      scanTarget: IMAGE,
      results: [
        {
          vulnerabilities: [
            { vulnerabilityId: "CVE-2026-0001", severity: "CRITICAL" },
          ],
        },
      ],
    });

    const result = verifyReadiness60Evidence(directory);
    expect(result.status).toBe("blocked");
    expect(result.errors).toContain(
      "trivy.json: found 1 HIGH/CRITICAL vulnerability finding(s)"
    );
  });
});
