#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_SERVICES = [
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
];

const REQUIRED_ACCEPTANCE_ROLES = [
  "release-security",
  "sre",
  "data-owner",
  "compliance-evidence-verifier",
  "security",
];

const SHA256_IMAGE_REFERENCE = /^[a-z0-9./:_-]+@sha256:([a-f0-9]{64})$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;

function readJson(evidenceDir, filename, errors) {
  try {
    return JSON.parse(readFileSync(resolve(evidenceDir, filename), "utf8"));
  } catch (error) {
    errors.push(`${filename}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function requireCondition(errors, condition, message) {
  if (!condition) errors.push(message);
}

function digestFromReference(reference) {
  const match = typeof reference === "string" ? reference.match(SHA256_IMAGE_REFERENCE) : null;
  return match?.[1] ?? null;
}

function hasOnlyPassedChecks(record, label, errors) {
  requireCondition(errors, Array.isArray(record?.checks) && record.checks.length > 0, `${label}: checks must be a non-empty array`);
  for (const check of record?.checks ?? []) {
    requireCondition(
      errors,
      check?.status === "passed",
      `${label}: check '${check?.name ?? "unnamed"}' is not passed`
    );
  }
}

function verifyCandidate(candidate, errors) {
  const digest = digestFromReference(candidate?.image);
  requireCondition(errors, digest !== null, "candidate.json: image must be a lower-case immutable OCI sha256 reference");
  requireCondition(errors, COMMIT_SHA.test(candidate?.sourceCommit ?? ""), "candidate.json: sourceCommit must be a full lower-case commit SHA");
  requireCondition(errors, typeof candidate?.builtAt === "string" && !Number.isNaN(Date.parse(candidate.builtAt)), "candidate.json: builtAt must be an ISO-8601 timestamp");
  return digest;
}

function verifyTrivy(trivy, digest, errors) {
  requireCondition(errors, trivy?.scanTarget?.endsWith(`@sha256:${digest}`), "trivy.json: scanTarget must be the candidate image digest");
  requireCondition(errors, trivy?.scanner === "trivy", "trivy.json: scanner must identify Trivy");
  requireCondition(errors, trivy?.mode === "direct-image", "trivy.json: mode must be direct-image");
  const findings = trivy?.results?.flatMap((result) => result?.vulnerabilities ?? []) ?? [];
  const blocked = findings.filter((finding) => ["HIGH", "CRITICAL"].includes(finding?.severity));
  requireCondition(errors, blocked.length === 0, `trivy.json: found ${blocked.length} HIGH/CRITICAL vulnerability finding(s)`);
}

function verifyArtifactEvidence(artifact, digest, errors) {
  for (const [name, report] of Object.entries(artifact ?? {})) {
    requireCondition(errors, report?.imageDigest === digest, `artifact-evidence.json: ${name} is not bound to the candidate digest`);
    requireCondition(errors, report?.verified === true, `artifact-evidence.json: ${name} is not marked verified`);
    requireCondition(errors, typeof report?.uri === "string" && report.uri.length > 0, `artifact-evidence.json: ${name} is missing immutable evidence URI`);
  }
  requireCondition(errors, artifact?.sbom?.format === "SPDX", "artifact-evidence.json: an SPDX SBOM is required");
  requireCondition(errors, artifact?.provenance?.format === "SLSA", "artifact-evidence.json: SLSA provenance is required");
  requireCondition(errors, artifact?.cosign?.certificateIdentity?.includes(".github/workflows/ci.yml@refs/heads/production"), "artifact-evidence.json: cosign certificate identity must bind to the production release workflow");
}

function verifyGovernance(governance, errors) {
  requireCondition(errors, governance?.branch === "production", "governance.json: snapshot must describe production");
  requireCondition(errors, governance?.requiredApprovals >= 2, "governance.json: production requires at least two approvals");
  requireCondition(errors, governance?.requireCodeOwnerReviews === true, "governance.json: required CODEOWNER review is not enabled");
  requireCondition(errors, governance?.dismissStaleReviews === true, "governance.json: stale reviews are not dismissed");
  requireCondition(errors, governance?.requireLastPushApproval === true, "governance.json: last-push approval is not required");
  requireCondition(errors, governance?.strictStatusChecks === true, "governance.json: strict status checks are not enabled");
  requireCondition(errors, governance?.enforceAdmins === true, "governance.json: administrators can bypass controls");
  requireCondition(errors, governance?.allowForcePushes === false, "governance.json: force pushes are allowed");
  requireCondition(errors, governance?.allowDeletions === false, "governance.json: branch deletion is allowed");
  requireCondition(errors, governance?.codeownersErrors?.length === 0, "governance.json: CODEOWNERS contains unresolved errors");
  requireCondition(errors, governance?.productionReleaseEnvironment?.protected === true, "governance.json: production-release environment is not protected");
  requireCondition(errors, governance?.productionReleaseEnvironment?.preventSelfReview === true, "governance.json: production-release permits self-review");
}

function verifyStaging(staging, digest, errors) {
  requireCondition(errors, staging?.environment === "staging", "staging-deployment.json: evidence must be from protected staging");
  requireCondition(errors, staging?.protectedEnvironment === true, "staging-deployment.json: staging environment is not protected");
  requireCondition(errors, staging?.deploymentDigest === digest, "staging-deployment.json: deployed digest does not match candidate");
  requireCondition(errors, staging?.status === "passed", "staging-deployment.json: deployment status is not passed");
  requireCondition(errors, staging?.mtlsContract === "passed", "staging-deployment.json: mTLS contract test is not passed");
  requireCondition(errors, staging?.authorizationNegativePath === "passed", "staging-deployment.json: authorization negative-path test is not passed");
  hasOnlyPassedChecks(staging, "staging-deployment.json", errors);
}

function verifyServices(matrix, digest, errors) {
  const rows = new Map((matrix?.services ?? []).map((service) => [service?.name, service]));
  for (const name of REQUIRED_SERVICES) {
    const service = rows.get(name);
    requireCondition(errors, service !== undefined, `service-matrix.json: missing '${name}' evidence`);
    requireCondition(errors, service?.status === "passed", `service-matrix.json: ${name} is not passed`);
    requireCondition(errors, service?.digest === digest, `service-matrix.json: ${name} is not bound to candidate digest`);
    requireCondition(errors, typeof service?.evidenceUri === "string" && service.evidenceUri.length > 0, `service-matrix.json: ${name} is missing evidence URI`);
  }
}

function verifyOperationalEvidence(postgres, resilience, residency, errors) {
  for (const [label, record, requiredChecks] of [
    ["postgres-integrity.json", postgres, ["encrypted-backup-restore", "forced-rls-denial", "ledger-recompute", "advisory-lock-concurrency"]],
    ["resilience.json", resilience, ["stateful-service-fault-recovery", "alert-escalation", "reconciliation"]],
    ["residency-evidence.json", residency, ["signed-evidence-verification", "replay-rejection", "merkle-transparency", "appeal-workflow"]],
  ]) {
    requireCondition(errors, record?.status === "passed", `${label}: overall status is not passed`);
    const names = new Set((record?.checks ?? []).filter((check) => check?.status === "passed").map((check) => check.name));
    for (const check of requiredChecks) requireCondition(errors, names.has(check), `${label}: required check '${check}' is absent or failed`);
  }
}

function verifyAcceptances(approvals, digest, errors) {
  requireCondition(errors, approvals?.candidateDigest === digest, "approvals.json: approvals are not bound to candidate digest");
  const roles = new Set((approvals?.acceptances ?? []).filter((acceptance) => acceptance?.decision === "accepted").map((acceptance) => acceptance.role));
  for (const role of REQUIRED_ACCEPTANCE_ROLES) requireCondition(errors, roles.has(role), `approvals.json: missing accepted '${role}' sign-off`);
}

export function verifyReadiness60Evidence(evidenceDir) {
  const errors = [];
  const candidate = readJson(evidenceDir, "candidate.json", errors);
  const trivy = readJson(evidenceDir, "trivy.json", errors);
  const artifacts = readJson(evidenceDir, "artifact-evidence.json", errors);
  const governance = readJson(evidenceDir, "governance.json", errors);
  const staging = readJson(evidenceDir, "staging-deployment.json", errors);
  const services = readJson(evidenceDir, "service-matrix.json", errors);
  const postgres = readJson(evidenceDir, "postgres-integrity.json", errors);
  const resilience = readJson(evidenceDir, "resilience.json", errors);
  const residency = readJson(evidenceDir, "residency-evidence.json", errors);
  const approvals = readJson(evidenceDir, "approvals.json", errors);

  const digest = verifyCandidate(candidate, errors);
  if (digest) {
    verifyTrivy(trivy, digest, errors);
    verifyArtifactEvidence(artifacts, digest, errors);
    verifyStaging(staging, digest, errors);
    verifyServices(services, digest, errors);
    verifyAcceptances(approvals, digest, errors);
  }
  verifyGovernance(governance, errors);
  verifyOperationalEvidence(postgres, resilience, residency, errors);

  return {
    status: errors.length === 0 ? "passed" : "blocked",
    threshold: "60/100",
    evidenceDirectory: resolve(evidenceDir),
    errors,
  };
}

function parseArguments(argumentsList) {
  const position = argumentsList.indexOf("--evidence-dir");
  if (position === -1 || !argumentsList[position + 1]) {
    throw new Error("Usage: node scripts/ci/verify-60-readiness-evidence.mjs --evidence-dir /secure/path/to/evidence");
  }
  return argumentsList[position + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = verifyReadiness60Evidence(parseArguments(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === "passed" ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
