#!/usr/bin/env node
/**
 * Create a tamper-evident emergency-release evidence pack.
 *
 * The caller must already have independently verified the candidate digest's
 * Trivy, SBOM, Cosign, and GitHub provenance evidence. This command checks the
 * digest binding and creates a hash-chained audit ledger. It never publishes or
 * deploys an image.
 */
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sha256, stableStringify } from "./verify-break-glass-authorization.mjs";

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseCanonicalTimestamp(value, label) {
  assert(typeof value === "string" && ISO_UTC.test(value), `${label} must be a canonical UTC timestamp`);
  const parsed = new Date(value);
  assert(!Number.isNaN(parsed.getTime()) && parsed.toISOString() === value, `${label} must be a canonical UTC timestamp`);
  return parsed;
}

function requireObject(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be a JSON object`);
  return value;
}

async function readRegularBuffer(path, label) {
  const stat = await lstat(path);
  assert(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a regular non-symlink file`);
  const handle = await open(path, "r");
  try {
    const fromHandle = await handle.stat();
    assert(fromHandle.isFile(), `${label} must be a regular file`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function readJson(path, label) {
  const raw = await readRegularBuffer(path, label);
  try {
    return { value: JSON.parse(raw.toString("utf8")), sha256: sha256(raw) };
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function eventHash(event) {
  return sha256(stableStringify(event));
}

export function buildAuditEvents(context) {
  const rows = [];
  let previousEventHash = "sha256:" + "0".repeat(64);
  const append = (eventType, data) => {
    const event = {
      schemaVersion: "ndsep.break-glass-audit-event.v1",
      sequence: rows.length + 1,
      eventType,
      occurredAt: context.generatedAt,
      workflow: context.workflow,
      candidate: context.candidate,
      authorization: context.authorization,
      data,
      previousEventHash,
    };
    const hash = eventHash(event);
    const row = { ...event, eventHash: hash };
    rows.push(row);
    previousEventHash = hash;
  };
  append("break_glass.authorization_verified", {
    incidentId: context.authorization.incidentId,
    authorizationSha256: context.authorization.sha256,
    approvalActors: context.authorization.approvalActors,
    expiresAt: context.authorization.expiresAt,
  });
  append("break_glass.candidate_revalidated", {
    releaseEvidenceSha256: context.releaseEvidence.sha256,
    trivyHighCriticalCount: context.releaseEvidence.highCriticalCount,
    sbomSha256: context.releaseEvidence.sbomSha256,
  });
  append("break_glass.supply_chain_verified", {
    cosignVerificationSha256: context.cosignVerification.sha256,
    provenanceVerificationSha256: context.provenanceVerification.sha256,
  });
  append("break_glass.exception_consumed", {
    scopeServices: context.authorization.scopeServices,
    operation: "emergency-security-hotfix",
    noReadinessCredit: true,
  });
  return { rows, rootHash: previousEventHash };
}

function parseArgs(argv) {
  const accepted = new Set([
    "authorization-verification", "release-evidence", "cosign-verification",
    "provenance-verification", "repository", "source-commit", "candidate-digest",
    "run-id", "actor", "workflow-ref", "generated-at", "out-dir",
  ]);
  const values = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    assert(token.startsWith("--"), `Unexpected argument: ${token}`);
    const name = token.slice(2);
    assert(accepted.has(name), `Unexpected argument: --${name}`);
    assert(values[name] === undefined, `Duplicate argument: --${name}`);
    const value = argv[index + 1];
    assert(value && !value.startsWith("--"), `Argument --${name} requires a value`);
    values[name] = value;
    index += 1;
  }
  for (const required of accepted) assert(values[required], `Missing required argument: --${required}`);
  assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(values.repository), "--repository is invalid");
  assert(COMMIT_SHA.test(values["source-commit"]), "--source-commit must be a full lowercase SHA-1");
  assert(SHA256.test(values["candidate-digest"]), "--candidate-digest must be a lowercase sha256 digest");
  assert(/^[1-9][0-9]*$/.test(values["run-id"]), "--run-id must be a positive integer");
  assert(/^[a-z0-9](?:[a-z0-9-]{0,37})$/.test(values.actor), "--actor is invalid");
  assert(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/workflows\/.+@refs\/heads\/production$/.test(values["workflow-ref"]),
    "--workflow-ref must identify a production-branch GitHub Actions workflow");
  parseCanonicalTimestamp(values["generated-at"], "--generated-at");
  return values;
}

async function assertEmptyOutputDirectory(outDir) {
  try {
    const stat = await lstat(outDir);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), "Break-glass evidence output directory must be a real directory");
    assert((await readdir(outDir)).length === 0, "Break-glass evidence output directory must be empty");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(outDir, { recursive: true, mode: 0o700 });
  }
}

function validateAuthorizationVerification(value, expected) {
  requireObject(value, "Authorization verification");
  assert(value.schemaVersion === "ndsep.break-glass-authorization-verification.v1", "Authorization verification schema is unsupported");
  assert(value.repository === expected.repository.toLowerCase(), "Authorization verification repository mismatch");
  const candidate = requireObject(value.authorization?.candidate, "Authorization verification candidate");
  assert(candidate.digest === expected.digest, "Authorization verification candidate digest mismatch");
  assert(candidate.sourceCommit === expected.sourceCommit, "Authorization verification source commit mismatch");
  assert(Array.isArray(value.independentApprovals) && value.independentApprovals.length === 3,
    "Authorization verification must contain three independent approvals");
  const roles = new Set(value.independentApprovals.map(approval => approval.role));
  const actors = new Set(value.independentApprovals.map(approval => approval.actor));
  assert(roles.size === 3 && actors.size === 3, "Authorization verification approvals must have three distinct roles and actors");
  assert(value.noReadinessCredit === true, "Authorization verification must preserve no-readiness-credit semantics");
  return {
    id: value.authorization.id,
    sha256: value.authorization.sha256,
    incidentId: value.authorization.incidentId,
    expiresAt: value.authorization.expiresAt,
    scopeServices: value.authorization.scope.services,
    approvalActors: [...actors].sort(),
  };
}

function validateReleaseEvidence(value, expected) {
  requireObject(value, "Release evidence");
  assert(value.schema === "ndsep.release-evidence.v1", "Release evidence schema is unsupported");
  assert(value.image?.name === `ghcr.io/${expected.repository.toLowerCase()}`, "Release evidence image name mismatch");
  assert(value.image?.digest === expected.digest, "Release evidence digest mismatch");
  assert(value.source_sha === expected.sourceCommit, "Release evidence source commit mismatch");
  assert(value.trivy?.high_critical_count === 0, "Release evidence contains HIGH/CRITICAL findings");
  assert(SHA256.test(value.sbom?.sha256), "Release evidence SBOM hash is invalid");
  return { highCriticalCount: value.trivy.high_critical_count, sbomSha256: value.sbom.sha256 };
}

async function writePrivateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

async function writePrivateBuffer(path, value) {
  await writeFile(path, value, { mode: 0o600, flag: "wx" });
}

export async function generateBreakGlassEvidence(args) {
  await assertEmptyOutputDirectory(args["out-dir"]);
  const expected = {
    repository: args.repository,
    sourceCommit: args["source-commit"],
    digest: args["candidate-digest"],
  };
  const [{ value: authorizationVerification, sha256: authorizationVerificationSha256 }, { value: releaseEvidence, sha256: releaseEvidenceSha256 }, cosignRaw, provenanceRaw] = await Promise.all([
    readJson(args["authorization-verification"], "Authorization verification"),
    readJson(args["release-evidence"], "Release evidence"),
    readRegularBuffer(args["cosign-verification"], "Cosign verification"),
    readRegularBuffer(args["provenance-verification"], "GitHub provenance verification"),
  ]);
  assert(cosignRaw.length > 0, "Cosign verification is empty");
  assert(provenanceRaw.length > 0, "GitHub provenance verification is empty");
  const authorization = validateAuthorizationVerification(authorizationVerification, expected);
  const release = validateReleaseEvidence(releaseEvidence, expected);
  const generatedAt = parseCanonicalTimestamp(args["generated-at"], "--generated-at").toISOString();
  const context = {
    generatedAt,
    workflow: {
      runId: Number(args["run-id"]),
      actor: args.actor,
      workflowRef: args["workflow-ref"],
    },
    candidate: {
      image: `ghcr.io/${args.repository.toLowerCase()}`,
      digest: expected.digest,
      sourceCommit: expected.sourceCommit,
    },
    authorization,
    releaseEvidence: { sha256: releaseEvidenceSha256, ...release },
    cosignVerification: { sha256: sha256(cosignRaw) },
    provenanceVerification: { sha256: sha256(provenanceRaw) },
  };
  const authorizationCopyPath = resolve(args["out-dir"], "break-glass-authorization-verification.json");
  const releaseEvidenceCopyPath = resolve(args["out-dir"], "break-glass-release-evidence.json");
  const cosignCopyPath = resolve(args["out-dir"], "break-glass-cosign-verification.json");
  const provenanceCopyPath = resolve(args["out-dir"], "break-glass-github-provenance-verification.txt");
  await writePrivateJson(authorizationCopyPath, authorizationVerification);
  await writePrivateJson(releaseEvidenceCopyPath, releaseEvidence);
  await writePrivateBuffer(cosignCopyPath, cosignRaw);
  await writePrivateBuffer(provenanceCopyPath, provenanceRaw);

  const ledger = buildAuditEvents(context);
  const auditPath = resolve(args["out-dir"], "break-glass-audit-events.ndjson");
  const auditContents = `${ledger.rows.map(row => JSON.stringify(row)).join("\n")}\n`;
  await writeFile(auditPath, auditContents, { encoding: "utf8", mode: 0o600, flag: "wx" });
  const manifest = {
    schemaVersion: "ndsep.break-glass-evidence-manifest.v1",
    generatedAt,
    repository: args.repository.toLowerCase(),
    workflow: context.workflow,
    candidate: context.candidate,
    authorization: {
      ...authorization,
      verificationSha256: authorizationVerificationSha256,
    },
    artifacts: {
      authorizationVerification: { path: "break-glass-authorization-verification.json", sha256: authorizationVerificationSha256 },
      releaseEvidence: { path: "break-glass-release-evidence.json", sha256: releaseEvidenceSha256 },
      cosignVerification: { path: "break-glass-cosign-verification.json", ...context.cosignVerification },
      provenanceVerification: { path: "break-glass-github-provenance-verification.txt", ...context.provenanceVerification },
      auditEvents: { path: "break-glass-audit-events.ndjson", sha256: sha256(auditContents), rootHash: ledger.rootHash, count: ledger.rows.length },
    },
    integrity: {
      algorithm: "sha256",
      attestationRequired: true,
      externalImmutableRetentionRequired: true,
      noReadinessCredit: true,
    },
  };
  const manifestPath = resolve(args["out-dir"], "break-glass-evidence-manifest.json");
  await writePrivateJson(manifestPath, manifest);
  const manifestContents = await readRegularBuffer(manifestPath, "Break-glass evidence manifest");
  const root = {
    schemaVersion: "ndsep.break-glass-evidence-root.v1",
    generatedAt,
    candidate: context.candidate,
    authorization: { id: authorization.id, sha256: authorization.sha256 },
    manifest: { path: "break-glass-evidence-manifest.json", sha256: sha256(manifestContents) },
    audit: { path: "break-glass-audit-events.ndjson", sha256: sha256(auditContents), rootHash: ledger.rootHash },
    noReadinessCredit: true,
  };
  const rootPath = resolve(args["out-dir"], "break-glass-evidence-root.json");
  await writePrivateJson(rootPath, root);
  return { auditPath, manifestPath, rootPath, manifest, root };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const result = await generateBreakGlassEvidence(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify({
      status: "generated",
      manifest: result.manifestPath,
      root: result.rootPath,
      candidate: result.root.candidate,
    }, null, 2));
  } catch (error) {
    console.error(`Break-glass evidence generation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

export { parseArgs };
