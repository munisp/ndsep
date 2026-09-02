#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyReadiness60Evidence } from "./verify-60-readiness-evidence.mjs";

const FULL_SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const REQUIRED_GO_SERVICES = [
  "postgresql", "tigerbeetle", "redis", "mojaloop", "kafka", "apisix",
  "keycloak", "openappsec", "permify", "opensearch", "fluvio", "dapr",
  "temporal", "lakehouse",
];
const REQUIRED_GO_ROLES = [
  "release-security", "security", "sre", "data-owner", "compliance-evidence-verifier",
  "engineering-owner", "compliance-officer", "business-owner", "release-manager",
];

function requireCondition(errors, condition, message) {
  if (!condition) errors.push(message);
}

function readJson(evidenceDir, name, errors) {
  try {
    return JSON.parse(readFileSync(resolve(evidenceDir, name), "utf8"));
  } catch (error) {
    errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function validTimestamp(value) {
  return typeof value === "string" && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value));
}

function validEvidenceUri(value) {
  return typeof value === "string" && /^https:\/\//.test(value);
}

function verifyMergedGovernance(candidate, governance, errors) {
  const merged = governance?.mergedPullRequest;
  requireCondition(errors, Number.isInteger(merged?.number) && merged.number > 0, "governance.json: mergedPullRequest.number is required");
  requireCondition(errors, merged?.merged === true, "governance.json: mergedPullRequest must be normally merged");
  requireCondition(errors, merged?.mergeCommit === candidate?.sourceCommit, "governance.json: mergedPullRequest.mergeCommit must equal candidate sourceCommit");
  requireCondition(errors, typeof merged?.author === "string" && merged.author.length > 0, "governance.json: mergedPullRequest.author is required");
  requireCondition(errors, validTimestamp(merged?.mergedAt), "governance.json: mergedPullRequest.mergedAt must be canonical UTC evidence");
  requireCondition(errors, validEvidenceUri(merged?.evidenceUri), "governance.json: mergedPullRequest.evidenceUri must be an HTTPS immutable record");

  const approved = Array.isArray(merged?.approvals) ? merged.approvals : [];
  const independentActors = new Set();
  for (const review of approved) {
    if (review?.state !== "APPROVED") continue;
    if (typeof review.actor !== "string" || review.actor.length === 0 || review.actor === merged.author) continue;
    if (!validTimestamp(review.submittedAt) || !validEvidenceUri(review.evidenceUri)) continue;
    independentActors.add(review.actor);
  }
  requireCondition(errors, independentActors.size >= 2, "governance.json: two independent, timestamped approval records are required");
  requireCondition(errors, governance?.productionReleaseEnvironment?.requiredReviewers === true, "governance.json: production-release required reviewers are not verified");
  requireCondition(errors, governance?.productionReleaseEnvironment?.allowAdminBypass === false, "governance.json: production-release administrator bypass must be disabled");
}

function verifyCandidateAndArtifacts(candidate, artifacts, errors) {
  requireCondition(errors, candidate?.releaseWorkflow?.path === ".github/workflows/ci.yml", "candidate.json: production release workflow path is required");
  requireCondition(errors, Number.isInteger(candidate?.releaseWorkflow?.runId) && candidate.releaseWorkflow.runId > 0, "candidate.json: production release workflow runId is required");
  requireCondition(errors, validEvidenceUri(candidate?.releaseWorkflow?.evidenceUri), "candidate.json: production release workflow evidenceUri must be HTTPS");
  for (const name of ["sbom", "provenance", "cosign"]) {
    const record = artifacts?.[name];
    requireCondition(errors, SHA256.test(record?.sha256 ?? ""), `artifact-evidence.json: ${name} requires a SHA-256 evidence hash`);
    requireCondition(errors, validEvidenceUri(record?.uri), `artifact-evidence.json: ${name} URI must be HTTPS`);
  }
  requireCondition(errors, artifacts?.cosign?.verification?.issuer === "https://token.actions.githubusercontent.com", "artifact-evidence.json: Cosign OIDC issuer verification is required");
  requireCondition(errors, artifacts?.provenance?.verification?.subjectDigestBound === true, "artifact-evidence.json: provenance must verify the candidate digest subject");
}

function verifyStagingAndServices(candidate, staging, services, errors) {
  requireCondition(errors, Number.isInteger(staging?.workflowRunId) && staging.workflowRunId > 0, "staging-deployment.json: protected staging workflowRunId is required");
  requireCondition(errors, validEvidenceUri(staging?.evidenceUri), "staging-deployment.json: protected staging evidenceUri must be HTTPS");
  requireCondition(errors, staging?.deploymentCommit === candidate?.sourceCommit, "staging-deployment.json: deploymentCommit must equal candidate sourceCommit");
  for (const check of ["rollback", "database-recovery", "network-policy", "pwa-smoke", "mobile-smoke"]) {
    requireCondition(errors, staging?.checks?.some(item => item?.name === check && item?.status === "passed"), `staging-deployment.json: mandatory '${check}' check is absent or failed`);
  }

  const rows = new Map((services?.services ?? []).map(service => [service?.name, service]));
  for (const name of REQUIRED_GO_SERVICES) {
    const service = rows.get(name);
    requireCondition(errors, service?.status === "passed", `service-matrix.json: '${name}' GO acceptance is absent or failed`);
    requireCondition(errors, service?.digest === candidate?.image?.split("@sha256:")[1], `service-matrix.json: '${name}' is not bound to candidate digest`);
    requireCondition(errors, Number.isInteger(service?.workflowRunId) && service.workflowRunId > 0, `service-matrix.json: '${name}' has no protected workflowRunId`);
    requireCondition(errors, validEvidenceUri(service?.evidenceUri), `service-matrix.json: '${name}' evidenceUri must be HTTPS`);
  }
}

function verifyOperationalProof(candidate, postgres, resilience, residency, errors) {
  for (const [name, record] of [
    ["postgres-integrity.json", postgres],
    ["resilience.json", resilience],
    ["residency-evidence.json", residency],
  ]) {
    requireCondition(errors, record?.candidateDigest === candidate?.image?.split("@sha256:")[1], `${name}: candidateDigest must bind to candidate`);
    requireCondition(errors, Number.isInteger(record?.workflowRunId) && record.workflowRunId > 0, `${name}: protected workflowRunId is required`);
    requireCondition(errors, validEvidenceUri(record?.evidenceUri), `${name}: evidenceUri must be HTTPS`);
  }
}

function verifyAccountableAcceptance(candidate, approvals, errors) {
  requireCondition(errors, approvals?.candidateDigest === candidate?.image?.split("@sha256:")[1], "approvals.json: candidateDigest must bind to candidate");
  for (const role of REQUIRED_GO_ROLES) {
    const acceptance = approvals?.acceptances?.find(item => item?.role === role && item?.decision === "accepted");
    requireCondition(errors, acceptance !== undefined, `approvals.json: missing accepted '${role}' approval`);
    requireCondition(errors, typeof acceptance?.actor === "string" && acceptance.actor.length > 0, `approvals.json: '${role}' approval needs accountable actor`);
    requireCondition(errors, validTimestamp(acceptance?.acceptedAt), `approvals.json: '${role}' approval needs canonical UTC acceptedAt`);
    requireCondition(errors, validEvidenceUri(acceptance?.evidenceUri), `approvals.json: '${role}' approval needs HTTPS evidenceUri`);
  }
}

export function verifyProductionGoEvidence(evidenceDirectory) {
  const foundation = verifyReadiness60Evidence(evidenceDirectory);
  const errors = [...foundation.errors];
  const candidate = readJson(evidenceDirectory, "candidate.json", errors);
  const artifacts = readJson(evidenceDirectory, "artifact-evidence.json", errors);
  const governance = readJson(evidenceDirectory, "governance.json", errors);
  const staging = readJson(evidenceDirectory, "staging-deployment.json", errors);
  const services = readJson(evidenceDirectory, "service-matrix.json", errors);
  const postgres = readJson(evidenceDirectory, "postgres-integrity.json", errors);
  const resilience = readJson(evidenceDirectory, "resilience.json", errors);
  const residency = readJson(evidenceDirectory, "residency-evidence.json", errors);
  const approvals = readJson(evidenceDirectory, "approvals.json", errors);

  requireCondition(errors, FULL_SHA.test(candidate?.sourceCommit ?? ""), "candidate.json: sourceCommit must be a full lower-case SHA");
  verifyMergedGovernance(candidate, governance, errors);
  verifyCandidateAndArtifacts(candidate, artifacts, errors);
  verifyStagingAndServices(candidate, staging, services, errors);
  verifyOperationalProof(candidate, postgres, resilience, residency, errors);
  verifyAccountableAcceptance(candidate, approvals, errors);

  return {
    status: errors.length === 0 ? "passed" : "blocked",
    threshold: "95/100",
    evidenceDirectory: resolve(evidenceDirectory),
    errors,
  };
}

function parseArguments(argumentsList) {
  const index = argumentsList.indexOf("--evidence-dir");
  if (index === -1 || !argumentsList[index + 1]) {
    throw new Error("Usage: node scripts/ci/verify-production-go-evidence.mjs --evidence-dir /secure/path/to/evidence");
  }
  return argumentsList[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = verifyProductionGoEvidence(parseArguments(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === "passed" ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
