#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const IMAGE_REFERENCE = /^[a-z0-9./:_-]+@sha256:([a-f0-9]{64})$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const REQUIRED_ARTIFACTS = [
  "candidate.json",
  "trivy.json",
  "artifact-evidence.json",
  "governance.json",
  "staging-deployment.json",
  "service-matrix.json",
  "postgres-integrity.json",
  "resilience.json",
  "residency-evidence.json",
  "approvals.json",
];

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(directory, filename) {
  const path = resolve(directory, filename);
  requireCondition(
    existsSync(path),
    `${filename}: required source evidence file is missing`
  );
  try {
    return { path, value: JSON.parse(readFileSync(path, "utf8")) };
  } catch (error) {
    throw new Error(
      `${filename}: must be valid JSON (${error instanceof Error ? error.message : String(error)})`
    );
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function digestFromImage(image) {
  const match = String(image ?? "").match(IMAGE_REFERENCE);
  requireCondition(
    match,
    "candidate.json: image must be an immutable lower-case OCI sha256 reference"
  );
  return match[1];
}

function validateEvidence(sourceDirectory) {
  const records = Object.fromEntries(
    REQUIRED_ARTIFACTS.map(filename => {
      const record = readJson(sourceDirectory, filename);
      return [filename, record];
    })
  );
  const candidate = records["candidate.json"].value;
  const digest = digestFromImage(candidate.image);
  requireCondition(
    COMMIT_SHA.test(candidate.sourceCommit ?? ""),
    "candidate.json: sourceCommit must be a full lower-case Git SHA"
  );
  requireCondition(
    Number.isFinite(Date.parse(candidate.builtAt ?? "")),
    "candidate.json: builtAt must be an ISO-8601 timestamp"
  );

  const trivy = records["trivy.json"].value;
  requireCondition(
    trivy.scanner === "trivy" && trivy.mode === "direct-image",
    "trivy.json: must be a direct-image Trivy result"
  );
  requireCondition(
    trivy.scanTarget === candidate.image,
    "trivy.json: scanTarget must equal candidate image"
  );
  const highCritical = (Array.isArray(trivy.results) ? trivy.results : [])
    .flatMap(result =>
      Array.isArray(result?.vulnerabilities) ? result.vulnerabilities : []
    )
    .filter(finding => ["HIGH", "CRITICAL"].includes(finding?.severity));
  requireCondition(
    highCritical.length === 0,
    `trivy.json: found ${highCritical.length} HIGH/CRITICAL finding(s)`
  );

  const artifact = records["artifact-evidence.json"].value;
  for (const name of ["sbom", "provenance", "cosign"]) {
    const record = artifact?.[name];
    requireCondition(
      record?.imageDigest === digest,
      `artifact-evidence.json: ${name} is not bound to candidate digest`
    );
    requireCondition(
      record?.verified === true,
      `artifact-evidence.json: ${name} is not marked verified`
    );
    requireCondition(
      typeof record?.uri === "string" && record.uri.length > 0,
      `artifact-evidence.json: ${name} URI is required`
    );
    requireCondition(
      typeof record?.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(record.sha256),
      `artifact-evidence.json: ${name} SHA-256 is required`
    );
  }
  requireCondition(
    ["CycloneDX", "SPDX"].includes(artifact?.sbom?.format),
    "artifact-evidence.json: SBOM format must be CycloneDX or SPDX"
  );
  requireCondition(
    artifact?.provenance?.format === "SLSA",
    "artifact-evidence.json: provenance format must be SLSA"
  );
  requireCondition(
    artifact?.cosign?.certificateIdentity?.includes(
      ".github/workflows/ci.yml@refs/heads/production"
    ),
    "artifact-evidence.json: Cosign identity must bind to production workflow"
  );

  const governance = records["governance.json"].value;
  requireCondition(
    governance.branch === "production",
    "governance.json: must describe production"
  );
  requireCondition(
    governance.requiredApprovals >= 2 &&
      governance.requireCodeOwnerReviews === true,
    "governance.json: two approvals and CODEOWNER review are required"
  );
  requireCondition(
    governance.productionReleaseEnvironment?.protected === true &&
      governance.productionReleaseEnvironment?.preventSelfReview === true,
    "governance.json: protected production-release environment with self-review denial is required"
  );

  const staging = records["staging-deployment.json"].value;
  requireCondition(
    staging.status === "passed" && staging.protectedEnvironment === true,
    "staging-deployment.json: successful protected staging deployment is required"
  );
  requireCondition(
    staging.deploymentDigest === digest,
    "staging-deployment.json: deployment digest must equal candidate digest"
  );
  requireCondition(
    staging.mtlsContract === "passed" &&
      staging.authorizationNegativePath === "passed",
    "staging-deployment.json: mTLS and authorization-negative-path results must pass"
  );

  const serviceMatrix = records["service-matrix.json"].value;
  const services = Array.isArray(serviceMatrix.services)
    ? serviceMatrix.services
    : [];
  requireCondition(
    services.length === 11,
    "service-matrix.json: exactly 11 core-service records are required"
  );
  for (const service of services) {
    requireCondition(
      service?.status === "passed" && service?.digest === digest,
      `service-matrix.json: ${service?.name ?? "unknown"} is not passed on candidate digest`
    );
    requireCondition(
      typeof service?.evidenceUri === "string" &&
        service.evidenceUri.length > 0,
      `service-matrix.json: ${service?.name ?? "unknown"} lacks evidenceUri`
    );
  }

  requireCondition(
    records["postgres-integrity.json"].value.status === "passed",
    "postgres-integrity.json: must be passed"
  );
  requireCondition(
    records["resilience.json"].value.status === "passed",
    "resilience.json: must be passed"
  );
  requireCondition(
    records["residency-evidence.json"].value.status === "passed",
    "residency-evidence.json: must be passed"
  );
  const approvals = records["approvals.json"].value;
  requireCondition(
    approvals.candidateDigest === digest,
    "approvals.json: candidateDigest must equal candidate digest"
  );

  return { candidate, digest, records };
}

export function collectStagingReleaseEvidence({
  sourceDirectory,
  outputDirectory,
  write = false,
}) {
  const source = resolve(sourceDirectory);
  requireCondition(
    existsSync(source) && statSync(source).isDirectory(),
    "source directory must exist"
  );
  const evidence = validateEvidence(source);
  const manifest = {
    status: write ? "collected" : "planned",
    sourceDirectory: source,
    outputDirectory: resolve(outputDirectory),
    candidate: evidence.candidate,
    files: REQUIRED_ARTIFACTS.map(filename => ({
      filename,
      sha256: sha256(evidence.records[filename].path),
    })),
    integrityNotice:
      "This bundle copies validated upstream evidence; it does not perform deployments, scans, signatures, approvals, or compliance determinations.",
  };

  if (!write) return manifest;
  const output = resolve(outputDirectory);
  requireCondition(
    !existsSync(output) || readdirSync(output).length === 0,
    "output directory must be empty to prevent mixing evidence runs"
  );
  mkdirSync(output, { recursive: true, mode: 0o700 });
  for (const { filename } of manifest.files) {
    writeFileSync(
      resolve(output, filename),
      readFileSync(evidence.records[filename].path),
      { mode: 0o600 }
    );
  }
  writeFileSync(
    resolve(output, "evidence-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 }
  );
  return manifest;
}

function parseArguments(argumentsList) {
  const options = { write: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    const value = argumentsList[index + 1];
    if (argument === "--source-dir" && value) {
      options.sourceDirectory = value;
      index += 1;
    } else if (argument === "--out-dir" && value) {
      options.outputDirectory = value;
      index += 1;
    } else if (argument === "--write") {
      options.write = true;
    } else if (argument === "--confirm" && value) {
      options.confirmation = value;
      index += 1;
    } else {
      throw new Error(
        "Usage: collect-staging-release-evidence.mjs --source-dir <real-evidence-dir> --out-dir <empty-dir> [--write --confirm COLLECT_REAL_EVIDENCE]"
      );
    }
  }
  requireCondition(
    options.sourceDirectory && options.outputDirectory,
    "--source-dir and --out-dir are required"
  );
  requireCondition(
    !options.write || options.confirmation === "COLLECT_REAL_EVIDENCE",
    "--write requires --confirm COLLECT_REAL_EVIDENCE"
  );
  return options;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = collectStagingReleaseEvidence(
      parseArguments(process.argv.slice(2))
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
