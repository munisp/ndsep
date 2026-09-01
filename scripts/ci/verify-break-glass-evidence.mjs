#!/usr/bin/env node
/**
 * Verify the tamper-evident break-glass evidence bundle before it is disclosed
 * to an enterprise SIEM, alerting system, or external evidence reader.
 *
 * The verifier is intentionally offline: GitHub/Sigstore attestation validation
 * is a separate authenticated step in the protected workflow. This command
 * verifies the complete local evidence-root, manifest, copied-artifact hashes,
 * and append-only audit ledger without contacting a network service.
 */
import { lstat, open } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { sha256, stableStringify } from "./verify-break-glass-authorization.mjs";

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const EXPECTED_EVENTS = [
  "break_glass.authorization_verified",
  "break_glass.candidate_revalidated",
  "break_glass.supply_chain_verified",
  "break_glass.exception_consumed",
];
const REQUIRED_ARTIFACTS = [
  "authorizationVerification",
  "releaseEvidence",
  "cosignVerification",
  "provenanceVerification",
  "auditEvents",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireObject(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be a JSON object`);
  return value;
}

function requireString(value, label, pattern) {
  assert(typeof value === "string" && value.length > 0, `${label} must be a non-empty string`);
  if (pattern) assert(pattern.test(value), `${label} is invalid`);
  return value;
}

function parseCanonicalTimestamp(value, label) {
  requireString(value, label);
  const parsed = new Date(value);
  assert(!Number.isNaN(parsed.getTime()) && parsed.toISOString() === value, `${label} must be a canonical UTC timestamp`);
  return parsed;
}

async function readRegularBuffer(path, label) {
  const stat = await lstat(path);
  assert(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a regular non-symlink file`);
  const handle = await open(path, "r");
  try {
    const opened = await handle.stat();
    assert(opened.isFile(), `${label} must be a regular file`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function readJson(path, label) {
  const raw = await readRegularBuffer(path, label);
  try {
    return { raw, value: JSON.parse(raw.toString("utf8")) };
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function resolveBundlePath(evidenceDir, relativePath, label) {
  requireString(relativePath, `${label} path`);
  assert(relativePath === basename(relativePath), `${label} path must not contain directory components`);
  const target = resolve(evidenceDir, relativePath);
  assert(dirname(target) === resolve(evidenceDir), `${label} path escaped the evidence directory`);
  return target;
}

function verifyAuditEvent(row, expectedSequence, previousHash, common) {
  requireObject(row, `Audit event ${expectedSequence}`);
  assert(row.schemaVersion === "ndsep.break-glass-audit-event.v1", `Audit event ${expectedSequence} schema is unsupported`);
  assert(row.sequence === expectedSequence, `Audit event sequence ${expectedSequence} is invalid`);
  assert(row.eventType === EXPECTED_EVENTS[expectedSequence - 1], `Audit event ${expectedSequence} type is invalid`);
  parseCanonicalTimestamp(row.occurredAt, `Audit event ${expectedSequence} occurredAt`);
  assert(row.previousEventHash === previousHash, `Audit event ${expectedSequence} previousEventHash mismatch`);
  requireString(row.eventHash, `Audit event ${expectedSequence} eventHash`, SHA256);
  assert(row.candidate?.image === common.candidate.image, `Audit event ${expectedSequence} candidate image mismatch`);
  assert(row.candidate?.digest === common.candidate.digest, `Audit event ${expectedSequence} candidate digest mismatch`);
  assert(row.candidate?.sourceCommit === common.candidate.sourceCommit, `Audit event ${expectedSequence} source commit mismatch`);
  assert(row.authorization?.id === common.authorization.id, `Audit event ${expectedSequence} authorization id mismatch`);
  assert(row.authorization?.sha256 === common.authorization.sha256, `Audit event ${expectedSequence} authorization hash mismatch`);
  const { eventHash, ...unsigned } = row;
  assert(sha256(stableStringify(unsigned)) === eventHash, `Audit event ${expectedSequence} hash mismatch`);
  return eventHash;
}

function verifyManifestShape(manifest, root) {
  requireObject(manifest, "Break-glass evidence manifest");
  requireObject(root, "Break-glass evidence root");
  assert(manifest.schemaVersion === "ndsep.break-glass-evidence-manifest.v1", "Break-glass evidence manifest schema is unsupported");
  assert(root.schemaVersion === "ndsep.break-glass-evidence-root.v1", "Break-glass evidence root schema is unsupported");
  parseCanonicalTimestamp(manifest.generatedAt, "Break-glass manifest generatedAt");
  assert(root.generatedAt === manifest.generatedAt, "Break-glass root generatedAt mismatch");
  requireString(manifest.repository, "Break-glass manifest repository", /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/);
  assert(manifest.candidate?.image === `ghcr.io/${manifest.repository}`, "Break-glass manifest candidate image mismatch");
  requireString(manifest.candidate?.digest, "Break-glass candidate digest", SHA256);
  requireString(manifest.candidate?.sourceCommit, "Break-glass source commit", COMMIT_SHA);
  assert(root.candidate?.image === manifest.candidate.image && root.candidate?.digest === manifest.candidate.digest && root.candidate?.sourceCommit === manifest.candidate.sourceCommit,
    "Break-glass root candidate binding mismatch");
  assert(root.authorization?.id === manifest.authorization?.id && root.authorization?.sha256 === manifest.authorization?.sha256,
    "Break-glass root authorization binding mismatch");
  assert(manifest.integrity?.algorithm === "sha256", "Break-glass manifest integrity algorithm is unsupported");
  assert(manifest.integrity?.attestationRequired === true, "Break-glass manifest must require an attestation");
  assert(manifest.integrity?.externalImmutableRetentionRequired === true, "Break-glass manifest must require external immutable retention");
  assert(manifest.integrity?.noReadinessCredit === true && root.noReadinessCredit === true,
    "Break-glass evidence must preserve no-readiness-credit semantics");
  return manifest;
}

export async function verifyBreakGlassEvidence(evidenceDir) {
  const directoryStat = await lstat(evidenceDir);
  assert(directoryStat.isDirectory() && !directoryStat.isSymbolicLink(), "Evidence directory must be a real non-symlink directory");
  const normalizedDir = resolve(evidenceDir);
  const manifestPath = resolveBundlePath(normalizedDir, "break-glass-evidence-manifest.json", "Manifest");
  const rootPath = resolveBundlePath(normalizedDir, "break-glass-evidence-root.json", "Root");
  const [{ raw: manifestRaw, value: manifest }, { raw: rootRaw, value: root }] = await Promise.all([
    readJson(manifestPath, "Break-glass evidence manifest"),
    readJson(rootPath, "Break-glass evidence root"),
  ]);
  verifyManifestShape(manifest, root);
  assert(root.manifest?.path === "break-glass-evidence-manifest.json", "Break-glass root manifest path is invalid");
  assert(root.manifest?.sha256 === sha256(manifestRaw), "Break-glass root manifest hash mismatch");
  requireString(root.audit?.path, "Break-glass root audit path");
  requireString(root.audit?.sha256, "Break-glass root audit hash", SHA256);
  requireString(root.audit?.rootHash, "Break-glass root audit rootHash", SHA256);

  requireObject(manifest.artifacts, "Break-glass manifest artifacts");
  for (const artifactName of REQUIRED_ARTIFACTS) assert(manifest.artifacts[artifactName], `Break-glass manifest is missing required artifact: ${artifactName}`);
  const artifactDigests = {};
  for (const [artifactName, descriptor] of Object.entries(manifest.artifacts)) {
    requireObject(descriptor, `Artifact ${artifactName}`);
    const path = resolveBundlePath(normalizedDir, descriptor.path, `Artifact ${artifactName}`);
    const contents = await readRegularBuffer(path, `Artifact ${artifactName}`);
    requireString(descriptor.sha256, `Artifact ${artifactName} sha256`, SHA256);
    assert(sha256(contents) === descriptor.sha256, `Artifact ${artifactName} sha256 mismatch`);
    artifactDigests[artifactName] = descriptor.sha256;
  }
  const authorizationArtifact = manifest.artifacts.authorizationVerification;
  const releaseArtifact = manifest.artifacts.releaseEvidence;
  const cosignArtifact = manifest.artifacts.cosignVerification;
  const provenanceArtifact = manifest.artifacts.provenanceVerification;
  const [{ value: authorizationVerification }, { value: releaseEvidence }, cosignContents, provenanceContents] = await Promise.all([
    readJson(resolveBundlePath(normalizedDir, authorizationArtifact.path, "Authorization verification artifact"), "Authorization verification artifact"),
    readJson(resolveBundlePath(normalizedDir, releaseArtifact.path, "Release evidence artifact"), "Release evidence artifact"),
    readRegularBuffer(resolveBundlePath(normalizedDir, cosignArtifact.path, "Cosign verification artifact"), "Cosign verification artifact"),
    readRegularBuffer(resolveBundlePath(normalizedDir, provenanceArtifact.path, "Provenance verification artifact"), "Provenance verification artifact"),
  ]);
  assert(authorizationVerification.schemaVersion === "ndsep.break-glass-authorization-verification.v1", "Authorization verification artifact schema is unsupported");
  assert(authorizationVerification.authorization?.id === manifest.authorization.id && authorizationVerification.authorization?.sha256 === manifest.authorization.sha256,
    "Authorization verification artifact does not match manifest authorization");
  assert(authorizationVerification.authorization?.candidate?.digest === manifest.candidate.digest && authorizationVerification.authorization?.candidate?.sourceCommit === manifest.candidate.sourceCommit,
    "Authorization verification artifact candidate binding mismatch");
  assert(Array.isArray(authorizationVerification.independentApprovals) && new Set(authorizationVerification.independentApprovals.map(approval => approval.actor)).size === 3,
    "Authorization verification artifact must contain three independent approval actors");
  assert(authorizationVerification.noReadinessCredit === true, "Authorization verification artifact must not grant readiness credit");
  assert(releaseEvidence.schema === "ndsep.release-evidence.v1", "Release evidence artifact schema is unsupported");
  assert(releaseEvidence.image?.name === manifest.candidate.image && releaseEvidence.image?.digest === manifest.candidate.digest && releaseEvidence.source_sha === manifest.candidate.sourceCommit,
    "Release evidence artifact candidate binding mismatch");
  assert(releaseEvidence.trivy?.high_critical_count === 0, "Release evidence artifact contains HIGH/CRITICAL findings");
  assert(cosignContents.length > 0 && provenanceContents.length > 0, "Supply-chain verification artifacts must not be empty");

  const audit = manifest.artifacts.auditEvents;
  requireObject(audit, "Break-glass audit artifact");
  assert(audit.path === root.audit.path, "Break-glass audit path differs between manifest and root");
  assert(audit.sha256 === root.audit.sha256, "Break-glass audit hash differs between manifest and root");
  const auditPath = resolveBundlePath(normalizedDir, audit.path, "Break-glass audit artifact");
  const auditRaw = await readRegularBuffer(auditPath, "Break-glass audit artifact");
  assert(sha256(auditRaw) === audit.sha256, "Break-glass audit file hash mismatch");
  const lines = auditRaw.toString("utf8").split("\n").filter(Boolean);
  assert(lines.length === EXPECTED_EVENTS.length && audit.count === EXPECTED_EVENTS.length,
    "Break-glass audit ledger has an unexpected event count");
  const rows = lines.map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`Break-glass audit event ${index + 1} is not valid JSON`); }
  });
  const common = { candidate: manifest.candidate, authorization: manifest.authorization };
  let previousHash = `sha256:${"0".repeat(64)}`;
  for (let index = 0; index < rows.length; index += 1) previousHash = verifyAuditEvent(rows[index], index + 1, previousHash, common);
  assert(previousHash === audit.rootHash && previousHash === root.audit.rootHash,
    "Break-glass audit root hash mismatch");
  assert(rows[0].data?.authorizationSha256 === manifest.authorization.sha256,
    "Authorization audit event is not bound to the manifest authorization hash");
  assert(rows[1].data?.trivyHighCriticalCount === 0, "Candidate revalidation audit event is not clean");
  assert(rows[3].data?.noReadinessCredit === true, "Exception-consumed audit event must not grant readiness credit");

  return {
    schemaVersion: "ndsep.break-glass-evidence-verification.v1",
    evidenceDirectory: normalizedDir,
    repository: manifest.repository,
    generatedAt: manifest.generatedAt,
    workflow: manifest.workflow,
    rootSha256: sha256(rootRaw),
    manifestSha256: sha256(manifestRaw),
    auditRootHash: previousHash,
    candidate: manifest.candidate,
    authorization: {
      id: manifest.authorization.id,
      sha256: manifest.authorization.sha256,
      incidentId: manifest.authorization.incidentId,
      expiresAt: manifest.authorization.expiresAt,
    },
    artifactDigests,
    verifiedEventTypes: rows.map(row => row.eventType),
    noReadinessCredit: true,
  };
}

function parseArgs(argv) {
  assert(argv.length === 2 && argv[0] === "--evidence-dir", "usage: verify-break-glass-evidence.mjs --evidence-dir <directory>");
  assert(argv[1] && !argv[1].startsWith("--"), "--evidence-dir requires a value");
  return argv[1];
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const result = await verifyBreakGlassEvidence(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify({ status: "verified", ...result }, null, 2));
  } catch (error) {
    console.error(`Break-glass evidence verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
