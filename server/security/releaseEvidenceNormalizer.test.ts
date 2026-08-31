import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeReleaseEvidence } from "../../scripts/ci/normalize-release-evidence.mjs";

const DIGEST = "a".repeat(64);
const IMAGE = `ghcr.io/munisp/ndsep@sha256:${DIGEST}`;
const SOURCE_COMMIT = "b".repeat(40);
const CERTIFICATE_IDENTITY =
  "https://github.com/munisp/ndsep/.github/workflows/ci.yml@refs/heads/production";
const temporaryDirectories: string[] = [];

async function fixtureDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "ndsep-release-normalizer-"));
  temporaryDirectories.push(directory);
  const trivyPath = join(directory, "trivy-image.json");
  const sbomPath = join(directory, "image-sbom.cdx.json");
  const provenancePath = join(directory, "github-provenance-verify.txt");
  const cosignPath = join(directory, "cosign-verify.json");

  await writeFile(
    trivyPath,
    JSON.stringify({ Results: [{ Target: IMAGE, Vulnerabilities: [] }] })
  );
  await writeFile(
    sbomPath,
    JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      components: [],
    })
  );
  await writeFile(
    provenancePath,
    "Verified attestation for immutable candidate\n"
  );
  await writeFile(
    cosignPath,
    JSON.stringify([
      {
        critical: {
          image: { "docker-manifest-digest": `sha256:${DIGEST}` },
        },
      },
    ])
  );

  return { directory, trivyPath, sbomPath, provenancePath, cosignPath };
}

function normalize(paths: Awaited<ReturnType<typeof fixtureDirectory>>) {
  return normalizeReleaseEvidence({
    image: IMAGE,
    sourceCommit: SOURCE_COMMIT,
    builtAt: "2026-08-31T20:00:00.000Z",
    trivyPath: paths.trivyPath,
    trivyUri:
      "github://munisp/ndsep/actions/runs/1/artifacts/release-evidence/trivy-image.json",
    sbomPath: paths.sbomPath,
    sbomUri:
      "github://munisp/ndsep/actions/runs/1/artifacts/release-evidence/image-sbom.cdx.json",
    provenancePath: paths.provenancePath,
    provenanceUri:
      "github://munisp/ndsep/actions/runs/1/artifacts/release-evidence/github-provenance-verify.txt",
    cosignPath: paths.cosignPath,
    cosignUri:
      "github://munisp/ndsep/actions/runs/1/artifacts/release-evidence/cosign-verify.json",
    certificateIdentity: CERTIFICATE_IDENTITY,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true }))
  );
});

describe("release evidence normalizer", () => {
  it("preserves CycloneDX identity and binds all normalized evidence to the candidate digest", async () => {
    const paths = await fixtureDirectory();
    const normalized = normalize(paths);

    expect(normalized.candidate).toEqual({
      image: IMAGE,
      sourceCommit: SOURCE_COMMIT,
      builtAt: "2026-08-31T20:00:00.000Z",
    });
    expect(normalized.trivy).toMatchObject({
      scanner: "trivy",
      mode: "direct-image",
      scanTarget: IMAGE,
      results: [{ vulnerabilities: [] }],
    });
    expect(normalized.artifactEvidence.sbom).toMatchObject({
      imageDigest: DIGEST,
      verified: true,
      format: "CycloneDX",
      specVersion: "1.6",
    });
    expect(normalized.artifactEvidence.provenance).toMatchObject({
      imageDigest: DIGEST,
      verified: true,
      format: "SLSA",
    });
    expect(normalized.artifactEvidence.cosign).toMatchObject({
      imageDigest: DIGEST,
      verified: true,
      certificateIdentity: CERTIFICATE_IDENTITY,
    });
  });

  it("fails before emitting normalized evidence when the direct image scan contains a critical finding", async () => {
    const paths = await fixtureDirectory();
    await writeFile(
      paths.trivyPath,
      JSON.stringify({
        Results: [
          {
            Vulnerabilities: [
              { VulnerabilityID: "CVE-2026-test", Severity: "CRITICAL" },
            ],
          },
        ],
      })
    );

    expect(() => normalize(paths)).toThrow(
      "Trivy report contains 1 HIGH/CRITICAL finding(s)"
    );
  });

  it("rejects a Cosign verification whose manifest digest does not match the candidate", async () => {
    const paths = await fixtureDirectory();
    await writeFile(
      paths.cosignPath,
      JSON.stringify([
        {
          critical: {
            image: { "docker-manifest-digest": `sha256:${"c".repeat(64)}` },
          },
        },
      ])
    );

    expect(() => normalize(paths)).toThrow(
      "Cosign verification is not bound to the candidate digest"
    );
  });
});
