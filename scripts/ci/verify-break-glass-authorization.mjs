#!/usr/bin/env node
/**
 * Fail-closed verifier for a one-time, digest-bound emergency release authorization.
 *
 * Authorization record: a marked JSON block in a GitHub incident issue body.
 * Independent approvals: marked issue comments from source-controlled role allowlists.
 *
 * This verifier never publishes an image, changes a deployment, or mutates an issue.
 * It writes only a sanitized verification record after all checks pass.
 */
import { createHash } from "node:crypto";
import { lstat, mkdir, open, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const AUTH_SCHEMA = "ndsep.break-glass-authorization.v1";
const POLICY_SCHEMA = "ndsep.break-glass-authorization-policy.v1";
const AUTH_MARKER = "<!-- ndsep-break-glass-authorization:v1 -->";
const APPROVAL_MARKER = "<!-- ndsep-break-glass-approval:v1 -->";
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const FINGERPRINT = /^[a-f0-9]{32}$/;
const GITHUB_LOGIN = /^[a-z0-9](?:[a-z0-9-]{0,37})$/;
const INCIDENT_ID = /^(?:INC|SEC)-[0-9]{4}-[A-Z0-9-]{1,64}$/;
const AUTHORIZATION_ID = /^BG-[0-9]{4}-[A-Z0-9]{4,32}$/;
const SERVICE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ALLOWED_MISMATCHES = new Set(["column", "constraint", "index"]);
const REQUIRED_ROLES = ["incident_commander", "release_authority", "database_authority"];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function stableStringify(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    assert(Number.isFinite(value), "Canonical JSON cannot contain a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  assert(typeof value === "object", "Canonical JSON contains an unsupported value");
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseCanonicalTimestamp(value, label) {
  assert(typeof value === "string", `${label} must be an ISO-8601 UTC timestamp`);
  const parsed = new Date(value);
  assert(!Number.isNaN(parsed.getTime()) && parsed.toISOString() === value, `${label} must be a canonical UTC timestamp`);
  return parsed;
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

async function readRegularFile(path, label) {
  const stat = await lstat(path);
  assert(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a regular non-symlink file`);
  const handle = await open(path, "r");
  try {
    const statFromHandle = await handle.stat();
    assert(statFromHandle.isFile(), `${label} must be a regular file`);
    return await handle.readFile({ encoding: "utf8" });
  } finally {
    await handle.close();
  }
}

export async function readAuthorizationPolicy(path) {
  let policy;
  try {
    policy = JSON.parse(await readRegularFile(path, "Break-glass policy"));
  } catch (error) {
    throw new Error(`Unable to read break-glass policy: ${error instanceof Error ? error.message : String(error)}`);
  }
  requireObject(policy, "Break-glass policy");
  assert(policy.schemaVersion === POLICY_SCHEMA, "Break-glass policy schemaVersion is unsupported");
  requireString(policy.policyId, "Break-glass policy policyId", /^[a-z0-9][a-z0-9-]{2,63}$/);
  assert(policy.enabled === true, "Break-glass authorization is disabled until accountable approvers are configured and the policy is enabled through protected review");
  requireString(policy.repository, "Break-glass policy repository", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  requireString(policy.environment, "Break-glass policy environment", /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
  assert(Number.isInteger(policy.maximumAuthorizationMinutes) && policy.maximumAuthorizationMinutes > 0 && policy.maximumAuthorizationMinutes <= 240,
    "Break-glass policy maximumAuthorizationMinutes must be an integer from 1 to 240");
  assert(Array.isArray(policy.requiredIssueLabels) && policy.requiredIssueLabels.length >= 2,
    "Break-glass policy must require at least two incident labels");
  assert(policy.roles && typeof policy.roles === "object", "Break-glass policy roles are required");
  for (const role of REQUIRED_ROLES) {
    const allowed = policy.roles[role]?.allowedLogins;
    assert(Array.isArray(allowed) && allowed.length > 0, `Break-glass policy role ${role} must have at least one allowed login`);
    for (const login of allowed) {
      requireString(login, `Break-glass policy ${role} login`, GITHUB_LOGIN);
      assert(!login.includes("replace"), `Break-glass policy ${role} contains a placeholder identity`);
    }
  }
  return policy;
}

export function extractAuthorizationFromIssueBody(body) {
  assert(typeof body === "string" && body.includes(AUTH_MARKER), "Incident issue body is missing the break-glass authorization marker");
  const markerIndex = body.indexOf(AUTH_MARKER);
  const afterMarker = body.slice(markerIndex + AUTH_MARKER.length);
  const match = afterMarker.match(/^\s*```json\s*\n([\s\S]*?)\n```/);
  assert(match, "Incident issue body must place canonical authorization JSON immediately after the marker");
  try {
    return JSON.parse(match[1]);
  } catch {
    throw new Error("Incident issue authorization block is not valid JSON");
  }
}

export function validateAuthorizationRecord(authorization, expected, policy, now = new Date()) {
  requireObject(authorization, "Break-glass authorization");
  assert(authorization.schemaVersion === AUTH_SCHEMA, "Break-glass authorization schemaVersion is unsupported");
  requireString(authorization.authorizationId, "Break-glass authorizationId", AUTHORIZATION_ID);

  const incident = requireObject(authorization.incident, "Break-glass incident");
  requireString(incident.id, "Break-glass incident id", INCIDENT_ID);
  assert(incident.severity === "P0" || incident.severity === "P1", "Break-glass incident severity must be P0 or P1");
  requireString(incident.summarySha256, "Break-glass incident summarySha256", SHA256);

  const candidate = requireObject(authorization.candidate, "Break-glass candidate");
  assert(candidate.image === `ghcr.io/${expected.repository.toLowerCase()}`, "Break-glass candidate image does not match the repository");
  assert(candidate.digest === expected.candidateDigest, "Break-glass candidate digest does not match the dispatched digest");
  assert(candidate.sourceCommit === expected.sourceCommit, "Break-glass source commit does not match the dispatched commit");
  requireString(candidate.digest, "Break-glass candidate digest", SHA256);
  requireString(candidate.sourceCommit, "Break-glass sourceCommit", COMMIT_SHA);

  const schemaDrift = requireObject(authorization.schemaDrift, "Break-glass schemaDrift");
  requireString(String(schemaDrift.workflowRunId), "Break-glass schema-drift workflowRunId", /^[1-9][0-9]*$/);
  assert(ALLOWED_MISMATCHES.has(schemaDrift.expectedMismatch), "Break-glass schema-drift expectedMismatch is invalid");
  requireString(schemaDrift.baselineFingerprint, "Break-glass baselineFingerprint", FINGERPRINT);
  requireString(schemaDrift.stagingFingerprint, "Break-glass stagingFingerprint", FINGERPRINT);
  assert(schemaDrift.baselineFingerprint !== schemaDrift.stagingFingerprint, "Break-glass schema-drift fingerprints must differ");
  requireString(schemaDrift.queryPackSha256, "Break-glass queryPackSha256", SHA256);
  requireString(schemaDrift.falsePositiveAnalysisSha256, "Break-glass falsePositiveAnalysisSha256", SHA256);

  const scope = requireObject(authorization.scope, "Break-glass scope");
  assert(scope.environment === policy.environment, "Break-glass authorization targets an unapproved environment");
  assert(scope.operation === "emergency-security-hotfix", "Break-glass authorization operation is invalid");
  assert(Array.isArray(scope.services) && scope.services.length > 0 && scope.services.length <= 32,
    "Break-glass scope must contain 1 to 32 services");
  const services = new Set();
  for (const service of scope.services) {
    requireString(service, "Break-glass service", SERVICE);
    assert(!services.has(service), "Break-glass scope services must be unique");
    services.add(service);
  }
  const notBefore = parseCanonicalTimestamp(scope.notBefore, "Break-glass scope notBefore");
  const expiresAt = parseCanonicalTimestamp(scope.expiresAt, "Break-glass scope expiresAt");
  assert(expiresAt > notBefore, "Break-glass authorization expiry must be after notBefore");
  assert(expiresAt.getTime() - notBefore.getTime() <= policy.maximumAuthorizationMinutes * 60_000,
    "Break-glass authorization exceeds the policy maximum duration");
  assert(now >= notBefore && now <= expiresAt, "Break-glass authorization is not currently active");

  requireString(authorization.hotfixAuthor, "Break-glass hotfixAuthor", GITHUB_LOGIN);
  return { authorization, authorizationSha256: sha256(stableStringify(authorization)), notBefore, expiresAt };
}

export function parseApprovalComment(comment) {
  const body = typeof comment?.body === "string" ? comment.body : "";
  if (!body.includes(APPROVAL_MARKER)) return null;
  assert(body.indexOf(APPROVAL_MARKER) === body.lastIndexOf(APPROVAL_MARKER), "Approval comment contains multiple authorization markers");
  const markerIndex = body.indexOf(APPROVAL_MARKER);
  const block = body.slice(markerIndex + APPROVAL_MARKER.length).split("\n\n")[0];
  const fields = Object.create(null);
  const allowedFields = new Set(["role", "authorization_id", "authorization_sha256", "expires_at"]);
  for (const line of block.split("\n")) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-z0-9_]+):\s*(.+)$/i);
    assert(match, "Approval comment contains an invalid authorization field");
    const fieldName = match[1].toLowerCase();
    assert(allowedFields.has(fieldName), `Approval comment contains an unsupported authorization field: ${fieldName}`);
    assert(fields[fieldName] === undefined, `Approval comment contains a duplicate authorization field: ${fieldName}`);
    fields[fieldName] = match[2].trim();
  }
  for (const fieldName of allowedFields) assert(typeof fields[fieldName] === "string", `Approval comment is missing required authorization field: ${fieldName}`);
  return fields;
}

async function fetchJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchAllComments(fetchImpl, apiUrl, repository, issueNumber, token) {
  const comments = [];
  for (let page = 1; page <= 20; page += 1) {
    const batch = await fetchJson(fetchImpl,
      `${apiUrl}/repos/${encodeURIComponent(repository)}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
      token);
    assert(Array.isArray(batch), "GitHub issue comments response is invalid");
    comments.push(...batch);
    if (batch.length < 100) return comments;
  }
  throw new Error("GitHub issue has too many comments for break-glass verification; split or archive the incident record");
}

export function verifyIndependentApprovals(comments, verified, policy, dispatchActor) {
  const selected = [];
  const usedActors = new Set([verified.authorization.hotfixAuthor, dispatchActor]);
  const byRole = new Map();
  const candidates = comments
    .map(comment => ({ comment, fields: parseApprovalComment(comment) }))
    .filter(entry => entry.fields !== null)
    .sort((left, right) => String(left.comment.created_at).localeCompare(String(right.comment.created_at)));

  for (const role of REQUIRED_ROLES) {
    const allowed = new Set(policy.roles[role].allowedLogins);
    for (const { comment, fields } of candidates) {
      const actor = String(comment?.user?.login ?? "").toLowerCase();
      if (fields.role !== role || fields.authorization_id !== verified.authorization.authorizationId ||
        fields.authorization_sha256 !== verified.authorizationSha256 || fields.expires_at !== verified.expiresAt.toISOString() ||
        !allowed.has(actor) || usedActors.has(actor)) continue;
      const createdAt = parseCanonicalTimestamp(comment.created_at, `Approval comment for ${role} created_at`);
      const updatedAt = parseCanonicalTimestamp(comment.updated_at ?? comment.created_at, `Approval comment for ${role} updated_at`);
      assert(createdAt >= verified.notBefore && createdAt <= verified.expiresAt,
        `Approval comment for ${role} is outside the authorization window`);
      assert(updatedAt >= createdAt && updatedAt <= verified.expiresAt,
        `Approval comment for ${role} was edited outside the authorization window`);
      assert(typeof comment.html_url === "string" && /^https:\/\//.test(comment.html_url), `Approval comment for ${role} lacks a safe URL`);
      byRole.set(role, {
        role,
        actor,
        commentId: String(comment.id),
        commentUrl: comment.html_url,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      });
      usedActors.add(actor);
      break;
    }
    assert(byRole.has(role), `Missing independent ${role} approval bound to authorization ${verified.authorization.authorizationId}`);
  }
  selected.push(...REQUIRED_ROLES.map(role => byRole.get(role)));
  assert(new Set(selected.map(approval => approval.actor)).size === REQUIRED_ROLES.length,
    "Break-glass approvals must be performed by three distinct identities");
  return selected;
}

function parseArgs(argv) {
  const values = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    assert(token.startsWith("--"), `Unexpected argument: ${token}`);
    const name = token.slice(2);
    assert(["issue", "repository", "candidate-digest", "source-commit", "dispatch-actor", "policy", "out-dir", "now", "github-api-url"].includes(name),
      `Unexpected argument: --${name}`);
    assert(values[name] === undefined, `Duplicate argument: --${name}`);
    const value = argv[index + 1];
    assert(value && !value.startsWith("--"), `Argument --${name} requires a value`);
    values[name] = value;
    index += 1;
  }
  for (const required of ["issue", "repository", "candidate-digest", "source-commit", "dispatch-actor", "policy", "out-dir"]) {
    assert(values[required], `Missing required argument: --${required}`);
  }
  assert(/^[1-9][0-9]*$/.test(values.issue), "--issue must be a positive issue number");
  requireString(values.repository, "--repository", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  requireString(values["candidate-digest"], "--candidate-digest", SHA256);
  requireString(values["source-commit"], "--source-commit", COMMIT_SHA);
  requireString(values["dispatch-actor"], "--dispatch-actor", GITHUB_LOGIN);
  const apiUrl = values["github-api-url"] ?? process.env.GITHUB_API_URL ?? "https://api.github.com";
  assert(/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?(?:\/api\/v3)?$/.test(apiUrl), "--github-api-url must be an HTTPS GitHub API origin");
  return { ...values, "github-api-url": apiUrl.replace(/\/$/, "") };
}

export async function verifyBreakGlassAuthorization(args, options = {}) {
  const policy = await readAuthorizationPolicy(args.policy);
  assert(policy.repository.toLowerCase() === args.repository.toLowerCase(), "Break-glass policy repository does not match dispatched repository");
  const now = args.now ? parseCanonicalTimestamp(args.now, "--now") : new Date();
  const token = options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  assert(typeof token === "string" && token.length > 0, "A GitHub token is required to read the incident record and approvals");
  const fetchImpl = options.fetchImpl ?? fetch;
  const issue = await fetchJson(fetchImpl,
    `${args["github-api-url"]}/repos/${encodeURIComponent(args.repository)}/issues/${args.issue}`,
    token);
  assert(!issue.pull_request, "Break-glass authorization must be recorded in an incident issue, not a pull request");
  const issueLabels = new Set((issue.labels ?? []).map(label => typeof label === "string" ? label : label?.name).filter(Boolean));
  for (const requiredLabel of policy.requiredIssueLabels) {
    assert(issueLabels.has(requiredLabel), `Incident issue is missing required label: ${requiredLabel}`);
  }
  const verified = validateAuthorizationRecord(extractAuthorizationFromIssueBody(issue.body), {
    repository: args.repository,
    candidateDigest: args["candidate-digest"],
    sourceCommit: args["source-commit"],
  }, policy, now);
  const commit = await fetchJson(fetchImpl,
    `${args["github-api-url"]}/repos/${encodeURIComponent(args.repository)}/commits/${args["source-commit"]}`,
    token);
  const commitAuthor = String(commit?.author?.login ?? "").toLowerCase();
  assert(GITHUB_LOGIN.test(commitAuthor), "The dispatched source commit must have a resolvable GitHub author identity");
  assert(verified.authorization.hotfixAuthor === commitAuthor,
    "Break-glass hotfixAuthor does not match the dispatched source commit author");
  const comments = await fetchAllComments(fetchImpl, args["github-api-url"], args.repository, args.issue, token);
  const approvals = verifyIndependentApprovals(comments, verified, policy, args["dispatch-actor"]);
  const output = {
    schemaVersion: "ndsep.break-glass-authorization-verification.v1",
    verifiedAt: now.toISOString(),
    repository: args.repository.toLowerCase(),
    issue: { number: Number(args.issue), url: issue.html_url },
    policy: { id: policy.policyId, sha256: sha256(stableStringify(policy)), environment: policy.environment },
    authorization: {
      id: verified.authorization.authorizationId,
      sha256: verified.authorizationSha256,
      incidentId: verified.authorization.incident.id,
      severity: verified.authorization.incident.severity,
      candidate: verified.authorization.candidate,
      schemaDrift: verified.authorization.schemaDrift,
      scope: verified.authorization.scope,
      hotfixAuthor: verified.authorization.hotfixAuthor,
      expiresAt: verified.expiresAt.toISOString(),
    },
    independentApprovals: approvals,
    dispatchActor: args["dispatch-actor"],
    noReadinessCredit: true,
  };
  await mkdir(args["out-dir"], { recursive: true, mode: 0o700 });
  const outputPath = resolve(args["out-dir"], "break-glass-authorization-verification.json");
  assert(dirname(outputPath) === resolve(args["out-dir"]), "Break-glass output path escaped its target directory");
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return { output, outputPath };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { output, outputPath } = await verifyBreakGlassAuthorization(args);
    console.log(JSON.stringify({ status: "verified", authorizationId: output.authorization.id, output: outputPath }, null, 2));
  } catch (error) {
    console.error(`Break-glass authorization verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

export { parseArgs };
