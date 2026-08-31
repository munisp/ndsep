import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectStagingReleaseEvidence } from "../../scripts/ci/collect-staging-release-evidence.mjs";

const DIGEST = "a".repeat(64);
const IMAGE = `ghcr.io/munisp/ndsep@sha256:${DIGEST}`;
const temporaryDirectories: string[] = [];

async function createDirectory(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeJson(directory: string, filename: string, value: unknown) {
  await writeFile(
    join(directory, filename),
    `${JSON.stringify(value, null, 2)}\n`
  );
}

async function writeCompleteEvidence(directory: string) {
  await writeJson(directory, "candidate.json", {
    image: IMAGE,
    sourceCommit: "b".repeat(40),
    builtAt: "2026-08-31T20:00:00.000Z",
  });
  await writeJson(directory, "trivy.json", {
    scanner: "trivy",
    mode: "direct-image",
    scanTarget: IMAGE,
    results: [],
  });
  await writeJson(directory, "artifact-evidence.json", {
    sbom: {
      imageDigest: DIGEST,
      verified: true,
      uri: "github://evidence/sbom.cdx.json",
      sha256: "c".repeat(64),
      format: "CycloneDX",
    },
    provenance: {
      imageDigest: DIGEST,
      verified: true,
      uri: "github://evidence/provenance.txt",
      sha256: "d".repeat(64),
      format: "SLSA",
    },
    cosign: {
      imageDigest: DIGEST,
      verified: true,
      uri: "github://evidence/cosign.json",
      sha256: "e".repeat(64),
      certificateIdentity:
        "https://github.com/munisp/ndsep/.github/workflows/ci.yml@refs/heads/production",
    },
  });
  await writeJson(directory, "governance.json", {
    branch: "production",
    requiredApprovals: 2,
    requireCodeOwnerReviews: true,
    productionReleaseEnvironment: { protected: true, preventSelfReview: true },
  });
  await writeJson(directory, "staging-deployment.json", {
    status: "passed",
    protectedEnvironment: true,
    deploymentDigest: DIGEST,
    mtlsContract: "passed",
    authorizationNegativePath: "passed",
  });
  await writeJson(directory, "service-matrix.json", {
    services: [
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
      evidenceUri: `github://evidence/services/${name}.json`,
    })),
  });
  await writeJson(directory, "postgres-integrity.json", { status: "passed" });
  await writeJson(directory, "resilience.json", { status: "passed" });
  await writeJson(directory, "residency-evidence.json", { status: "passed" });
  await writeJson(directory, "approvals.json", {
    candidateDigest: DIGEST,
    acceptances: [],
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true }))
  );
});

describe("staging release evidence collector", () => {
  it("plans a candidate-bound collection without writing a local evidence bundle", async () => {
    const source = await createDirectory("ndsep-staging-source-");
    const output = join(
      await createDirectory("ndsep-staging-output-parent-"),
      "bundle"
    );
    await writeCompleteEvidence(source);

    const result = collectStagingReleaseEvidence({
      sourceDirectory: source,
      outputDirectory: output,
    });

    expect(result).toMatchObject({
      status: "planned",
      candidate: { image: IMAGE },
    });
    expect(result.files).toHaveLength(10);
    expect(existsSync(output)).toBe(false);
  });

  it("writes an immutable manifest and copies only validated upstream evidence after explicit collection", async () => {
    const source = await createDirectory("ndsep-staging-source-");
    const output = join(
      await createDirectory("ndsep-staging-output-parent-"),
      "bundle"
    );
    await writeCompleteEvidence(source);

    const result = collectStagingReleaseEvidence({
      sourceDirectory: source,
      outputDirectory: output,
      write: true,
    });

    expect(result.status).toBe("collected");
    expect(
      JSON.parse(await readFile(join(output, "candidate.json"), "utf8"))
    ).toMatchObject({ image: IMAGE });
    const manifest = JSON.parse(
      await readFile(join(output, "evidence-manifest.json"), "utf8")
    );
    expect(manifest.files).toHaveLength(10);
    expect(manifest.integrityNotice).toContain("does not perform deployments");
  });

  it("rejects a staging deployment bound to a different candidate digest", async () => {
    const source = await createDirectory("ndsep-staging-source-");
    const output = join(
      await createDirectory("ndsep-staging-output-parent-"),
      "bundle"
    );
    await writeCompleteEvidence(source);
    await writeJson(source, "staging-deployment.json", {
      status: "passed",
      protectedEnvironment: true,
      deploymentDigest: "f".repeat(64),
      mtlsContract: "passed",
      authorizationNegativePath: "passed",
    });

    expect(() =>
      collectStagingReleaseEvidence({
        sourceDirectory: source,
        outputDirectory: output,
      })
    ).toThrow(
      "staging-deployment.json: deployment digest must equal candidate digest"
    );
  });

  it("refuses to mix a second evidence collection into a non-empty output directory", async () => {
    const source = await createDirectory("ndsep-staging-source-");
    const output = await createDirectory("ndsep-staging-existing-output-");
    await writeCompleteEvidence(source);
    await writeFile(join(output, "prior-evidence.txt"), "do not overwrite\n");

    expect(() =>
      collectStagingReleaseEvidence({
        sourceDirectory: source,
        outputDirectory: output,
        write: true,
      })
    ).toThrow("output directory must be empty to prevent mixing evidence runs");
  });
});
