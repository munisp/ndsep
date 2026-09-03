#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const IMAGE_REFERENCE = /^[a-z0-9./:_-]+@sha256:([a-f0-9]{64})$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function digestFromImage(image) {
  const match = image.match(IMAGE_REFERENCE);
  requireCondition(
    match,
    "image must be a lower-case immutable OCI sha256 reference"
  );
  return match[1];
}

function relativeUri(uri, label) {
  requireCondition(
    typeof uri === "string" && uri.length > 0,
    `${label} URI is required`
  );
  return uri;
}

function normalizeTrivy(raw, image, trivyUri, trivyPath) {
  const rawResults = Array.isArray(raw?.Results) ? raw.Results : [];
  const results = rawResults.map(result => ({
    target: typeof result?.Target === "string" ? result.Target : "unknown",
    class: typeof result?.Class === "string" ? result.Class : "unknown",
    vulnerabilities: (Array.isArray(result?.Vulnerabilities)
      ? result.Vulnerabilities
      : []
    ).map(finding => ({
      vulnerabilityId: finding?.VulnerabilityID ?? "unknown",
      severity: finding?.Severity ?? "UNKNOWN",
      packageName: finding?.PkgName ?? "unknown",
      installedVersion: finding?.InstalledVersion ?? "unknown",
      fixedVersion: finding?.FixedVersion ?? null,
    })),
  }));
  const blocked = results
    .flatMap(result => result.vulnerabilities)
    .filter(finding => ["HIGH", "CRITICAL"].includes(finding.severity));
  requireCondition(
    blocked.length === 0,
    `Trivy report contains ${blocked.length} HIGH/CRITICAL finding(s)`
  );

  return {
    scanner: "trivy",
    mode: "direct-image",
    scanTarget: image,
    rawReport: {
      uri: relativeUri(trivyUri, "Trivy report"),
      sha256: sha256(trivyPath),
    },
    results,
  };
}

function normalizeEvidence({
  image,
  digest,
  sbomPath,
  sbomUri,
  provenancePath,
  provenanceUri,
  cosignPath,
  cosignUri,
  certificateIdentity,
}) {
  const sbom = readJson(sbomPath, "CycloneDX SBOM");
  requireCondition(
    sbom?.bomFormat === "CycloneDX",
    "SBOM must preserve bomFormat: CycloneDX"
  );
  requireCondition(
    typeof sbom?.specVersion === "string" && sbom.specVersion.length > 0,
    "CycloneDX SBOM specVersion is required"
  );

  const cosign = readJson(cosignPath, "Cosign verification");
  requireCondition(
    Array.isArray(cosign) && cosign.length > 0,
    "Cosign verification must contain at least one verified signature"
  );
  const expectedManifestDigest = `sha256:${digest}`;
  const digestMatches = cosign.some(
    entry =>
      entry?.critical?.image?.["docker-manifest-digest"] ===
      expectedManifestDigest
  );
  requireCondition(
    digestMatches,
    "Cosign verification is not bound to the candidate digest"
  );

  const provenance = readFileSync(provenancePath, "utf8");
  requireCondition(
    provenance.trim().length > 0,
    "GitHub provenance verification output is empty"
  );

  return {
    sbom: {
      imageDigest: digest,
      verified: true,
      uri: relativeUri(sbomUri, "SBOM"),
      sha256: sha256(sbomPath),
      format: "CycloneDX",
      specVersion: sbom.specVersion,
    },
    provenance: {
      imageDigest: digest,
      verified: true,
      uri: relativeUri(provenanceUri, "Provenance"),
      sha256: sha256(provenancePath),
      format: "SLSA",
    },
    cosign: {
      imageDigest: digest,
      verified: true,
      uri: relativeUri(cosignUri, "Cosign verification"),
      sha256: sha256(cosignPath),
      certificateIdentity,
    },
  };
}

export function normalizeReleaseEvidence(options) {
  const image = options.image;
  const digest = digestFromImage(image);
  requireCondition(
    COMMIT_SHA.test(options.sourceCommit ?? ""),
    "sourceCommit must be a full lower-case commit SHA"
  );
  requireCondition(
    ISO_TIMESTAMP.test(options.builtAt ?? "") &&
      !Number.isNaN(Date.parse(options.builtAt)),
    "builtAt must be an ISO-8601 UTC timestamp"
  );
  requireCondition(
    typeof options.certificateIdentity === "string" &&
      options.certificateIdentity.includes(
        ".github/workflows/ci.yml@refs/heads/production"
      ),
    "certificate identity must bind to the production release workflow"
  );

  const rawTrivy = readJson(options.trivyPath, "Trivy report");
  const trivy = normalizeTrivy(
    rawTrivy,
    image,
    options.trivyUri,
    options.trivyPath
  );
  const artifactEvidence = normalizeEvidence({
    image,
    digest,
    sbomPath: options.sbomPath,
    sbomUri: options.sbomUri,
    provenancePath: options.provenancePath,
    provenanceUri: options.provenanceUri,
    cosignPath: options.cosignPath,
    cosignUri: options.cosignUri,
    certificateIdentity: options.certificateIdentity,
  });

  return {
    candidate: {
      image,
      sourceCommit: options.sourceCommit,
      builtAt: options.builtAt,
    },
    trivy,
    artifactEvidence,
  };
}

function parseArguments(argumentsList) {
  const values = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const option = argumentsList[index];
    const value = argumentsList[index + 1];
    requireCondition(
      option?.startsWith("--") && value,
      "Usage: normalize-release-evidence.mjs --image <oci-digest> --source-commit <sha> --built-at <utc> --trivy <file> --trivy-uri <uri> --sbom <file> --sbom-uri <uri> --provenance <file> --provenance-uri <uri> --cosign <file> --cosign-uri <uri> --certificate-identity <identity> --out-dir <directory>"
    );
    values[option.slice(2)] = value;
  }
  for (const required of [
    "image",
    "source-commit",
    "built-at",
    "trivy",
    "trivy-uri",
    "sbom",
    "sbom-uri",
    "provenance",
    "provenance-uri",
    "cosign",
    "cosign-uri",
    "certificate-identity",
    "out-dir",
  ]) {
    requireCondition(values[required], `Missing required --${required} option`);
  }
  return {
    image: values.image,
    sourceCommit: values["source-commit"],
    builtAt: values["built-at"],
    trivyPath: values.trivy,
    trivyUri: values["trivy-uri"],
    sbomPath: values.sbom,
    sbomUri: values["sbom-uri"],
    provenancePath: values.provenance,
    provenanceUri: values["provenance-uri"],
    cosignPath: values.cosign,
    cosignUri: values["cosign-uri"],
    certificateIdentity: values["certificate-identity"],
    outputDirectory: values["out-dir"],
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = normalizeReleaseEvidence(options);
    mkdirSync(options.outputDirectory, { recursive: true });
    for (const [filename, record] of Object.entries({
      "candidate.json": result.candidate,
      "trivy.json": result.trivy,
      "artifact-evidence.json": result.artifactEvidence,
    })) {
      writeFileSync(
        resolve(options.outputDirectory, filename),
        `${JSON.stringify(record, null, 2)}\n`,
        { mode: 0o600 }
      );
    }
    console.log(
      JSON.stringify(
        { status: "passed", outputDirectory: resolve(options.outputDirectory) },
        null,
        2
      )
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
