import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectStagingReleaseEvidence,
  parseCollectorArguments,
} from "../../scripts/ci/collect-staging-release-evidence.mjs";

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

async function runCollectorCli(argumentsList: string[]) {
  return new Promise<{ exitCode: number | null; stderr: string; stdout: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [
        join(process.cwd(), "scripts/ci/collect-staging-release-evidence.mjs"),
        ...argumentsList,
      ]);
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", chunk => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", chunk => {
        stderr += String(chunk);
      });
      child.once("error", reject);
      child.once("close", exitCode => resolve({ exitCode, stderr, stdout }));
    }
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

  it("writes a validated manifest and copies only validated upstream evidence after explicit collection", async () => {
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
    expect((await stat(join(output, "candidate.json"))).mode & 0o777).toBe(
      0o600
    );
    expect((await stat(join(output, "evidence-manifest.json"))).mode & 0o777).toBe(
      0o600
    );
  });

  it("rejects malformed upstream JSON without creating an output bundle", async () => {
    const source = await createDirectory("ndsep-staging-source-");
    const output = join(
      await createDirectory("ndsep-staging-output-parent-"),
      "bundle"
    );
    await writeCompleteEvidence(source);
    await writeFile(join(source, "candidate.json"), "{ invalid-json\\n");

    expect(() =>
      collectStagingReleaseEvidence({
        sourceDirectory: source,
        outputDirectory: output,
        write: true,
      })
    ).toThrow("candidate.json: must be valid JSON");
    expect(existsSync(output)).toBe(false);
  });

  it("rejects a direct-image scan that reports a critical finding", async () => {
    const source = await createDirectory("ndsep-staging-source-");
    const output = join(
      await createDirectory("ndsep-staging-output-parent-"),
      "bundle"
    );
    await writeCompleteEvidence(source);
    await writeJson(source, "trivy.json", {
      scanner: "trivy",
      mode: "direct-image",
      scanTarget: IMAGE,
      results: [{ vulnerabilities: [{ severity: "CRITICAL" }] }],
    });

    expect(() =>
      collectStagingReleaseEvidence({
        sourceDirectory: source,
        outputDirectory: output,
      })
    ).toThrow("trivy.json: found 1 HIGH/CRITICAL finding(s)");
    expect(existsSync(output)).toBe(false);
  });

  it("rejects malformed supply-chain evidence before output creation", async () => {
    const source = await createDirectory("ndsep-staging-source-");
    const output = join(
      await createDirectory("ndsep-staging-output-parent-"),
      "bundle"
    );
    await writeCompleteEvidence(source);
    await writeJson(source, "artifact-evidence.json", {
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
        sha256: "not-a-sha256",
        certificateIdentity:
          "https://github.com/munisp/ndsep/.github/workflows/ci.yml@refs/heads/production",
      },
    });

    expect(() =>
      collectStagingReleaseEvidence({
        sourceDirectory: source,
        outputDirectory: output,
      })
    ).toThrow("artifact-evidence.json: cosign SHA-256 is required");
    expect(existsSync(output)).toBe(false);
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

  it("rejects a core-service result without an evidence URI", async () => {
    const source = await createDirectory("ndsep-staging-source-");
    const output = join(
      await createDirectory("ndsep-staging-output-parent-"),
      "bundle"
    );
    await writeCompleteEvidence(source);
    await writeJson(source, "service-matrix.json", {
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
      ].map((name, index) => ({
        name,
        status: "passed",
        digest: DIGEST,
        evidenceUri:
          index === 0 ? "" : `github://evidence/services/${name}.json`,
      })),
    });

    expect(() =>
      collectStagingReleaseEvidence({
        sourceDirectory: source,
        outputDirectory: output,
      })
    ).toThrow("service-matrix.json: postgresql lacks evidenceUri");
    expect(existsSync(output)).toBe(false);
  });

  it("requires the explicit CLI confirmation token before write mode", async () => {
    const source = await createDirectory("ndsep-staging-source-");
    const output = join(
      await createDirectory("ndsep-staging-output-parent-"),
      "bundle"
    );
    await writeCompleteEvidence(source);

    const rejected = await runCollectorCli([
      "--source-dir",
      source,
      "--out-dir",
      output,
      "--write",
    ]);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toContain(
      "--write requires --confirm COLLECT_REAL_EVIDENCE"
    );
    expect(existsSync(output)).toBe(false);

    const accepted = await runCollectorCli([
      "--source-dir",
      source,
      "--out-dir",
      output,
      "--write",
      "--confirm",
      "COLLECT_REAL_EVIDENCE",
    ]);
    expect(accepted.exitCode).toBe(0);
    expect(JSON.parse(accepted.stdout)).toMatchObject({ status: "collected" });
    expect(existsSync(join(output, "evidence-manifest.json"))).toBe(true);
  });

  it("rejects a non-canonical candidate timestamp before any write", async () => {
    const source = await createDirectory("ndsep-staging-source-");
    const output = join(
      await createDirectory("ndsep-staging-output-parent-"),
      "bundle"
    );
    await writeCompleteEvidence(source);
    await writeJson(source, "candidate.json", {
      image: IMAGE,
      sourceCommit: "b".repeat(40),
      builtAt: "2026-08-31",
    });

    expect(() =>
      collectStagingReleaseEvidence({
        sourceDirectory: source,
        outputDirectory: output,
      })
    ).toThrow("candidate.json: builtAt must be a canonical ISO-8601 UTC timestamp");
    expect(existsSync(output)).toBe(false);
  });

  it("rejects an invalid calendar timestamp even when it matches the UTC shape", async () => {
    const source = await createDirectory("ndsep-staging-source-");
    const output = join(
      await createDirectory("ndsep-staging-output-parent-"),
      "bundle"
    );
    await writeCompleteEvidence(source);
    await writeJson(source, "candidate.json", {
      image: IMAGE,
      sourceCommit: "b".repeat(40),
      builtAt: "2026-02-30T20:00:00.000Z",
    });

    expect(() =>
      collectStagingReleaseEvidence({
        sourceDirectory: source,
        outputDirectory: output,
      })
    ).toThrow(
      "candidate.json: builtAt must be a canonical ISO-8601 UTC timestamp"
    );
    expect(existsSync(output)).toBe(false);
  });

  it("rejects non-object upstream evidence records before field access", async () => {
    const source = await createDirectory("ndsep-staging-source-");
    const output = join(
      await createDirectory("ndsep-staging-output-parent-"),
      "bundle"
    );
    await writeCompleteEvidence(source);
    await writeJson(source, "service-matrix.json", []);

    expect(() =>
      collectStagingReleaseEvidence({
        sourceDirectory: source,
        outputDirectory: output,
      })
    ).toThrow("service-matrix.json: must be a JSON object");
    expect(existsSync(output)).toBe(false);
  });

  it("rejects malformed nested Trivy result entries before any write", async () => {
    const source = await createDirectory("ndsep-staging-source-");
    const output = join(
      await createDirectory("ndsep-staging-output-parent-"),
      "bundle"
    );
    await writeCompleteEvidence(source);
    await writeJson(source, "trivy.json", {
      scanner: "trivy",
      mode: "direct-image",
      scanTarget: IMAGE,
      results: [{ target: "runtime" }],
    });

    expect(() =>
      collectStagingReleaseEvidence({
        sourceDirectory: source,
        outputDirectory: output,
      })
    ).toThrow("trivy.json: results[0].vulnerabilities must be an array");
    expect(existsSync(output)).toBe(false);
  });

  it("rejects malformed Trivy result collections before any write", async () => {
    const source = await createDirectory("ndsep-staging-source-");
    const output = join(
      await createDirectory("ndsep-staging-output-parent-"),
      "bundle"
    );
    await writeCompleteEvidence(source);
    await writeJson(source, "trivy.json", {
      scanner: "trivy",
      mode: "direct-image",
      scanTarget: IMAGE,
      results: { vulnerabilities: [] },
    });

    expect(() =>
      collectStagingReleaseEvidence({
        sourceDirectory: source,
        outputDirectory: output,
      })
    ).toThrow("trivy.json: results must be an array");
    expect(existsSync(output)).toBe(false);
  });

  it("rejects symbolic links in upstream evidence inputs", async () => {
    const source = await createDirectory("ndsep-staging-source-");
    const alternate = await createDirectory("ndsep-staging-alternate-");
    const output = join(
      await createDirectory("ndsep-staging-output-parent-"),
      "bundle"
    );
    await writeCompleteEvidence(source);
    await writeJson(alternate, "candidate.json", {
      image: IMAGE,
      sourceCommit: "b".repeat(40),
      builtAt: "2026-08-31T20:00:00.000Z",
    });
    await rm(join(source, "candidate.json"));
    await symlink(
      join(alternate, "candidate.json"),
      join(source, "candidate.json")
    );

    expect(() =>
      collectStagingReleaseEvidence({
        sourceDirectory: source,
        outputDirectory: output,
      })
    ).toThrow("candidate.json: source evidence must be a regular non-symlink file");
    expect(existsSync(output)).toBe(false);
  });

  it("rejects symbolic-link output paths before copying evidence", async () => {
    const source = await createDirectory("ndsep-staging-source-");
    const outputTarget = await createDirectory("ndsep-staging-output-target-");
    const output = join(
      await createDirectory("ndsep-staging-output-parent-"),
      "bundle"
    );
    await writeCompleteEvidence(source);
    await symlink(outputTarget, output);

    expect(() =>
      collectStagingReleaseEvidence({
        sourceDirectory: source,
        outputDirectory: output,
        write: true,
      })
    ).toThrow("output directory must not be a symbolic link");
    expect(existsSync(join(outputTarget, "evidence-manifest.json"))).toBe(false);
  });

  it("fails closed for incomplete, malformed, or unconfirmed CLI arguments", () => {
    expect(() => parseCollectorArguments([])).toThrow(
      "--source-dir and --out-dir are required"
    );
    expect(() =>
      parseCollectorArguments([
        "--source-dir",
        "/tmp/source",
        "--out-dir",
        "/tmp/output",
        "--write",
        "--confirm",
        "wrong-token",
      ])
    ).toThrow("--write requires --confirm COLLECT_REAL_EVIDENCE");
    expect(parseCollectorArguments([
      "--source-dir",
      "/tmp/source",
      "--out-dir",
      "/tmp/output",
      "--write",
      "--confirm",
      "COLLECT_REAL_EVIDENCE",
    ])).toEqual({
      sourceDirectory: "/tmp/source",
      outputDirectory: "/tmp/output",
      write: true,
      confirmation: "COLLECT_REAL_EVIDENCE",
    });
    expect(() =>
      parseCollectorArguments([
        "--source-dir",
        "/tmp/source",
        "--out-dir",
        "/tmp/output",
        "--unexpected",
      ])
    ).toThrow("Usage: collect-staging-release-evidence.mjs");
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
