#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API_VERSION = "2026-03-10";

function requireCondition(errors, condition, message) {
  if (!condition) errors.push(message);
}

function parseRepository(value) {
  const [owner, repo, ...extra] = String(value).split("/");
  if (!owner || !repo || extra.length > 0) throw new Error(`Invalid repository '${value}'; expected OWNER/REPO`);
  return { owner, repo };
}

function loadFixture(fixtureDirectory, filename) {
  return JSON.parse(readFileSync(resolve(fixtureDirectory, filename), "utf8"));
}

function ghJson(endpoint) {
  try {
    const output = execFileSync(
      "gh",
      ["api", "-H", "Accept: application/vnd.github+json", "-H", `X-GitHub-Api-Version: ${API_VERSION}`, endpoint],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return JSON.parse(output.replace(/\u001B\[[0-9;]*[A-Za-z]/g, ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { requestError: message };
  }
}

function loadEvidence({ owner, repo, branch, pullRequest, fixtureDirectory }) {
  if (fixtureDirectory) {
    return {
      codeowners: loadFixture(fixtureDirectory, "codeowners.json"),
      codeownersErrors: loadFixture(fixtureDirectory, "codeowners-errors.json"),
      protection: loadFixture(fixtureDirectory, "production-protection.json"),
      environment: loadFixture(fixtureDirectory, "production-release-environment.json"),
      pullRequest: loadFixture(fixtureDirectory, "pr19.json"),
    };
  }

  const base = `repos/${owner}/${repo}`;
  return {
    codeowners: ghJson(`${base}/contents/.github/CODEOWNERS?ref=${encodeURIComponent(branch)}`),
    codeownersErrors: ghJson(`${base}/codeowners/errors`),
    protection: ghJson(`${base}/branches/${encodeURIComponent(branch)}/protection`),
    environment: ghJson(`${base}/environments/production-release`),
    pullRequest: ghJson(`${base}/pulls/${pullRequest}`),
  };
}

function evaluatePostMergeGovernance({ owner, repo, branch, pullRequest, evidence }) {
  const errors = [];
  const protection = evidence.protection ?? {};
  const reviews = protection.required_pull_request_reviews ?? {};
  const requiredChecks = protection.required_status_checks ?? {};
  const environment = evidence.environment ?? {};
  const environmentRules = environment.protection_rules ?? [];
  const requiredReviewerRule = environmentRules.find((rule) => rule?.type === "required_reviewers");
  const waitTimerRule = environmentRules.find((rule) => rule?.type === "wait_timer");
  const branchPolicy = environment.deployment_branch_policy ?? {};
  const codeownerErrors = evidence.codeownersErrors?.errors ?? [];

  for (const [label, record] of Object.entries(evidence)) {
    requireCondition(errors, !record?.requestError, `${label}: GitHub evidence request failed (${record?.requestError ?? "unknown error"})`);
  }
  requireCondition(errors, evidence.pullRequest?.number === pullRequest, `PR #${pullRequest}: evidence is missing or identifies a different pull request`);
  requireCondition(errors, evidence.pullRequest?.merged_at, `PR #${pullRequest}: bootstrap pull request is not merged`);
  requireCondition(errors, evidence.pullRequest?.base?.ref === branch, `PR #${pullRequest}: bootstrap did not merge into ${branch}`);
  requireCondition(errors, evidence.codeowners?.path === ".github/CODEOWNERS", `${branch}: .github/CODEOWNERS is missing from the base branch`);
  requireCondition(errors, typeof evidence.codeowners?.content === "string" && evidence.codeowners.content.length > 0, `${branch}: CODEOWNERS content is empty or unavailable`);
  requireCondition(errors, !evidence.codeownersErrors?.requestError && codeownerErrors.length === 0, `${branch}: GitHub reports ${codeownerErrors.length} CODEOWNERS error(s)`);
  requireCondition(errors, reviews.required_approving_review_count >= 2, `${branch}: requires fewer than two approvals`);
  requireCondition(errors, reviews.require_code_owner_reviews === true, `${branch}: required CODEOWNER review is disabled`);
  requireCondition(errors, reviews.dismiss_stale_reviews === true, `${branch}: stale reviews are not dismissed`);
  requireCondition(errors, reviews.require_last_push_approval === true, `${branch}: last-push approval is disabled`);
  requireCondition(errors, requiredChecks.strict === true, `${branch}: strict required status checks are disabled`);
  requireCondition(errors, protection.enforce_admins?.enabled === true, `${branch}: administrator enforcement is disabled`);
  requireCondition(errors, protection.allow_force_pushes?.enabled === false, `${branch}: force pushes are allowed`);
  requireCondition(errors, protection.allow_deletions?.enabled === false, `${branch}: branch deletion is allowed`);
  requireCondition(errors, environment.name === "production-release", "production-release: environment is missing or misnamed");
  requireCondition(errors, requiredReviewerRule?.reviewers?.length > 0, "production-release: required reviewer protection is absent");
  requireCondition(errors, environment.prevent_self_review === true, "production-release: self-review prevention is disabled");
  requireCondition(errors, environment.can_admins_bypass === false, "production-release: administrator bypass is enabled");
  requireCondition(errors, branchPolicy.protected_branches === true && branchPolicy.custom_branch_policies === false, "production-release: protected-branch deployment policy is not enforced");
  requireCondition(errors, waitTimerRule === undefined || Number(waitTimerRule.wait_timer ?? 0) >= 0, "production-release: invalid wait-timer rule");

  return {
    status: errors.length === 0 ? "passed" : "blocked",
    repository: `${owner}/${repo}`,
    branch,
    pullRequest,
    errors,
  };
}

function parseArguments(argumentsList) {
  const options = { repository: "munisp/ndsep", branch: "production", pullRequest: 19, fixtureDirectory: null };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    const value = argumentsList[index + 1];
    if (argument === "--repo" && value) {
      options.repository = value;
      index += 1;
    } else if (argument === "--branch" && value) {
      options.branch = value;
      index += 1;
    } else if (argument === "--pr" && value) {
      options.pullRequest = Number(value);
      index += 1;
    } else if (argument === "--fixture-dir" && value) {
      options.fixtureDirectory = value;
      index += 1;
    } else {
      throw new Error("Usage: node scripts/ci/verify-post-merge-governance.mjs [--repo OWNER/REPO] [--branch production] [--pr 19] [--fixture-dir path]");
    }
  }
  if (!Number.isInteger(options.pullRequest) || options.pullRequest <= 0) {
    throw new Error("--pr must be a positive integer");
  }
  return options;
}

export function verifyPostMergeGovernance(options) {
  const { owner, repo } = parseRepository(options.repository);
  const evidence = loadEvidence({ owner, repo, branch: options.branch, pullRequest: options.pullRequest, fixtureDirectory: options.fixtureDirectory });
  return evaluatePostMergeGovernance({ owner, repo, branch: options.branch, pullRequest: options.pullRequest, evidence });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = verifyPostMergeGovernance(parseArguments(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === "passed" ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
