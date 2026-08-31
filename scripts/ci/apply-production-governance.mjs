#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const API_VERSION = "2026-03-10";
const DEFAULT_REPOSITORY = "munisp/ndsep";
const DEFAULT_BRANCH = "production";
const DEFAULT_ENVIRONMENT = "production-release";
const DEFAULT_PULL_REQUEST = 19;
const APPLY_CONFIRMATION = "APPLY_PRODUCTION_GOVERNANCE";

function stripAnsi(value) {
  return String(value).replace(/\u001B\[[0-9;]*[A-Za-z]/g, "");
}

function parseRepository(value) {
  const [owner, repo, ...extra] = String(value).split("/");
  if (!owner || !repo || extra.length > 0) throw new Error(`Invalid repository '${value}'; expected OWNER/REPO`);
  return { owner, repo };
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function runGh(argumentsList, { input } = {}) {
  return execFileSync("gh", argumentsList, {
    encoding: "utf8",
    input,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function apiJson(endpoint) {
  return JSON.parse(
    stripAnsi(
      runGh(["api", "-H", "Accept: application/vnd.github+json", "-H", `X-GitHub-Api-Version: ${API_VERSION}`, endpoint])
    )
  );
}

function putJson(endpoint, payload) {
  return JSON.parse(
    stripAnsi(
      runGh(
        [
          "api",
          "--method",
          "PUT",
          "-H",
          "Accept: application/vnd.github+json",
          "-H",
          `X-GitHub-Api-Version: ${API_VERSION}`,
          endpoint,
        ],
        { input: JSON.stringify(payload) }
      )
    )
  );
}

export function buildReviewProtectionPayload() {
  return {
    dismiss_stale_reviews: true,
    require_code_owner_reviews: true,
    required_approving_review_count: 2,
    require_last_push_approval: true,
  };
}

export function buildEnvironmentPayload(reviewerId) {
  assertCondition(Number.isInteger(reviewerId) && reviewerId > 0, "Reviewer ID must be a positive integer");
  return {
    wait_timer: 0,
    reviewers: [{ type: "User", id: reviewerId }],
    deployment_branch_policy: {
      protected_branches: true,
      custom_branch_policies: false,
    },
    prevent_self_review: true,
    can_admins_bypass: false,
  };
}

export function assessRootGaps({ pullRequest, codeowners, codeownersErrors, protection, environment }) {
  const gaps = [];
  const reviews = protection?.required_pull_request_reviews ?? {};
  const environmentRules = environment?.protection_rules ?? [];
  const requiredReviewers = environmentRules.find((rule) => rule?.type === "required_reviewers")?.reviewers ?? [];
  const policy = environment?.deployment_branch_policy ?? {};

  if (!pullRequest?.merged_at) gaps.push("pr-not-merged");
  if (codeowners?.path !== ".github/CODEOWNERS" || !codeowners?.content) gaps.push("codeowners-missing");
  if (!Array.isArray(codeownersErrors?.errors) || codeownersErrors.errors.length > 0) gaps.push("codeowners-invalid");
  if (reviews.required_approving_review_count < 2) gaps.push("two-approvals-disabled");
  if (reviews.require_code_owner_reviews !== true) gaps.push("codeowner-review-disabled");
  if (reviews.dismiss_stale_reviews !== true) gaps.push("stale-review-dismissal-disabled");
  if (reviews.require_last_push_approval !== true) gaps.push("last-push-approval-disabled");
  if (protection?.required_status_checks?.strict !== true) gaps.push("strict-status-checks-disabled");
  if (protection?.enforce_admins?.enabled !== true) gaps.push("admin-enforcement-disabled");
  if (protection?.allow_force_pushes?.enabled !== false) gaps.push("force-push-denial-disabled");
  if (protection?.allow_deletions?.enabled !== false) gaps.push("deletion-denial-disabled");
  if (environment?.name !== DEFAULT_ENVIRONMENT) gaps.push("production-release-missing");
  if (requiredReviewers.length === 0) gaps.push("production-release-reviewers-missing");
  if (environment?.prevent_self_review !== true) gaps.push("production-release-self-review-denial-disabled");
  if (environment?.can_admins_bypass !== false) gaps.push("production-release-admin-bypass-enabled");
  if (policy.protected_branches !== true || policy.custom_branch_policies !== false) gaps.push("production-release-branch-policy-disabled");

  return gaps;
}

function parseArguments(argumentsList) {
  const options = {
    repository: DEFAULT_REPOSITORY,
    branch: DEFAULT_BRANCH,
    environment: DEFAULT_ENVIRONMENT,
    pullRequest: DEFAULT_PULL_REQUEST,
    reviewer: null,
    apply: false,
    confirmation: null,
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    const value = argumentsList[index + 1];
    if (argument === "--repo" && value) {
      options.repository = value;
      index += 1;
    } else if (argument === "--branch" && value) {
      options.branch = value;
      index += 1;
    } else if (argument === "--environment" && value) {
      options.environment = value;
      index += 1;
    } else if (argument === "--pr" && value) {
      options.pullRequest = Number(value);
      index += 1;
    } else if (argument === "--reviewer" && value) {
      options.reviewer = value;
      index += 1;
    } else if (argument === "--apply") {
      options.apply = true;
    } else if (argument === "--confirm" && value) {
      options.confirmation = value;
      index += 1;
    } else {
      throw new Error("Usage: node scripts/ci/apply-production-governance.mjs [--repo OWNER/REPO] [--branch production] [--environment production-release] [--pr 19] [--reviewer GITHUB_LOGIN] [--apply --confirm APPLY_PRODUCTION_GOVERNANCE]");
    }
  }

  assertCondition(Number.isInteger(options.pullRequest) && options.pullRequest > 0, "--pr must be a positive integer");
  if (options.apply) {
    assertCondition(options.confirmation === APPLY_CONFIRMATION, `--apply requires --confirm ${APPLY_CONFIRMATION}`);
    assertCondition(Boolean(options.reviewer), "--apply requires --reviewer GITHUB_LOGIN for the production-release environment");
  }
  return options;
}

function loadLiveState({ owner, repo, branch, environment, pullRequest }) {
  const base = `repos/${owner}/${repo}`;
  const output = { pullRequest: apiJson(`${base}/pulls/${pullRequest}`) };
  try {
    output.codeowners = apiJson(`${base}/contents/.github/CODEOWNERS?ref=${encodeURIComponent(branch)}`);
  } catch {
    output.codeowners = null;
  }
  try {
    output.codeownersErrors = apiJson(`${base}/codeowners/errors`);
  } catch {
    output.codeownersErrors = null;
  }
  output.protection = apiJson(`${base}/branches/${encodeURIComponent(branch)}/protection`);
  try {
    output.environment = apiJson(`${base}/environments/${encodeURIComponent(environment)}`);
  } catch {
    output.environment = null;
  }
  return output;
}

function resolveReviewer({ owner, reviewer }) {
  const reviewerRecord = apiJson(`users/${encodeURIComponent(reviewer)}`);
  const actingUser = apiJson("user");
  assertCondition(reviewerRecord?.id, `Unable to resolve GitHub reviewer '${reviewer}'`);
  assertCondition(reviewerRecord.login !== actingUser.login, "Refusing to make the current administrator account the sole production-release reviewer");
  assertCondition(reviewerRecord.login !== owner, "Refusing to make the repository owner the sole production-release reviewer");
  return reviewerRecord;
}

function assertApplyPreconditions({ state, options }) {
  assertCondition(state.pullRequest?.merged_at, `PR #${options.pullRequest} is not merged; merge the CODEOWNERS bootstrap through independent review first`);
  assertCondition(state.pullRequest?.base?.ref === options.branch, `PR #${options.pullRequest} did not merge into ${options.branch}`);
  assertCondition(state.codeowners?.path === ".github/CODEOWNERS" && state.codeowners?.content, `${options.branch} does not contain a usable .github/CODEOWNERS file`);
  assertCondition(Array.isArray(state.codeownersErrors?.errors) && state.codeownersErrors.errors.length === 0, `${options.branch} CODEOWNERS validation is unavailable or reports errors`);
}

export function buildPlan({ repository, branch, environment, pullRequest, state }) {
  const { owner, repo } = parseRepository(repository);
  const gaps = assessRootGaps(state);
  return {
    mode: "plan",
    repository: `${owner}/${repo}`,
    branch,
    environment,
    pullRequest,
    gaps,
    actions: [
      "Require PR #19 to be independently approved and normally merged before applying CODEOWNER review enforcement.",
      "Validate .github/CODEOWNERS from the production base branch with GitHub's CODEOWNERS errors endpoint.",
      "Update only pull-request review protection to require two approvals, CODEOWNER review, stale-review dismissal, and last-push approval.",
      "Create or update production-release with required reviewer(s), self-review prevention, and protected-branch-only deployment policy.",
      "Run the read-only post-merge governance verifier and retain its live API-backed result.",
    ],
  };
}

export function applyGovernance(options) {
  const { owner, repo } = parseRepository(options.repository);
  const state = loadLiveState({ owner, repo, branch: options.branch, environment: options.environment, pullRequest: options.pullRequest });
  if (!options.apply) return buildPlan({ ...options, state });

  assertApplyPreconditions({ state, options });
  const reviewer = resolveReviewer({ owner, reviewer: options.reviewer });
  const base = `repos/${owner}/${repo}`;
  const reviewProtection = putJson(
    `${base}/branches/${encodeURIComponent(options.branch)}/protection/required_pull_request_reviews`,
    buildReviewProtectionPayload()
  );
  const environment = putJson(
    `${base}/environments/${encodeURIComponent(options.environment)}`,
    buildEnvironmentPayload(reviewer.id)
  );
  const verifierPath = resolve(dirname(fileURLToPath(import.meta.url)), "verify-post-merge-governance.mjs");
  const verification = execFileSync("node", [verifierPath, "--repo", options.repository, "--branch", options.branch, "--pr", String(options.pullRequest)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    mode: "applied",
    repository: `${owner}/${repo}`,
    branch: options.branch,
    environment: options.environment,
    reviewProtection,
    environmentResult: environment,
    verification: JSON.parse(verification),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = applyGovernance(parseArguments(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
