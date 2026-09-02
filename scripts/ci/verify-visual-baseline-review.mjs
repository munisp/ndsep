#!/usr/bin/env node
/**
 * Validates that visual snapshots were reviewed by independent accountable roles.
 * The program is read-only: it never writes snapshots, reviews, pull requests,
 * workflow state, environment configuration, or deployment state.
 *
 * Required environment:
 *   VISUAL_BASELINE_CONTRACT_PATH     declarative 12-snapshot contract
 *   VISUAL_BASELINE_REVIEW_PATH       approved review record
 *   VISUAL_SNAPSHOT_DIRECTORY         committed Playwright baseline directory
 *   VISUAL_REVIEW_HEAD_COMMIT         full pull-request source head SHA
 *   GITHUB_EVENT_PATH                 pull_request event payload
 *   GITHUB_REPOSITORY                 owner/repository
 *   GITHUB_TOKEN                      read-only pull-request metadata token
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const FULL_SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const REQUIRED_ROLES = [
  "product-ux-owner",
  "qa-lead",
  "accessibility-owner",
  "independent-engineering-reviewer",
];

function fail(message) {
  throw new Error(message);
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is required`);
  return value;
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(
      `${label} could not be read: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function gitHubReviews(repository, prNumber) {
  try {
    const output = execFileSync(
      "gh",
      [
        "api",
        `repos/${repository}/pulls/${prNumber}/reviews?per_page=100`,
        "--paginate",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NO_COLOR: "1",
          CLICOLOR: "0",
          GH_FORCE_TTY: "0",
        },
      }
    );
    return JSON.parse(output.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, ""));
  } catch (error) {
    const detail =
      error?.stderr?.toString().trim() || error?.message || String(error);
    fail(`GitHub review read failed: ${detail}`);
  }
}

function verifyContract(contract) {
  if (contract?.schemaVersion !== 1)
    fail("visual baseline contract schemaVersion must equal 1");
  if (contract?.project !== "chromium")
    fail("visual baseline contract must target chromium");
  if (contract?.matrix?.workers !== 1 || contract?.matrix?.retries !== 0)
    fail("visual baseline contract must require one worker and zero retries");
  if (!Array.isArray(contract?.snapshots) || contract.snapshots.length !== 12)
    fail("visual baseline contract must contain exactly 12 snapshots");
  const ids = new Set();
  const snapshots = new Set();
  for (const entry of contract.snapshots) {
    if (typeof entry?.id !== "string" || !entry.id || ids.has(entry.id))
      fail(
        "visual baseline contract contains a missing or duplicate snapshot id"
      );
    if (
      typeof entry?.snapshot !== "string" ||
      !entry.snapshot.endsWith(".png") ||
      snapshots.has(entry.snapshot)
    )
      fail(
        "visual baseline contract contains a missing, non-PNG, or duplicate snapshot filename"
      );
    if (
      !Number.isInteger(entry?.viewport?.width) ||
      !Number.isInteger(entry?.viewport?.height) ||
      typeof entry?.fullPage !== "boolean"
    )
      fail(
        `visual baseline contract entry ${entry.id} has invalid viewport/fullPage metadata`
      );
    ids.add(entry.id);
    snapshots.add(entry.snapshot);
  }
  return { ids, snapshots };
}

function verifyReview(review, candidate, expectedIds, event) {
  if (review?.schemaVersion !== 1)
    fail("visual baseline review schemaVersion must equal 1");
  if (review?.candidateCommit !== candidate)
    fail(
      "visual baseline review candidateCommit must equal VISUAL_REVIEW_HEAD_COMMIT"
    );
  if (
    review?.pullRequest?.number !== event.pull_request.number ||
    review?.pullRequest?.headCommit !== candidate
  )
    fail(
      "visual baseline review must bind to the current pull request and current head commit"
    );
  if (
    review?.matrix?.project !== "chromium" ||
    review?.matrix?.workers !== 1 ||
    review?.matrix?.retries !== 0
  )
    fail(
      "visual baseline review must record chromium, one worker, and zero retries"
    );
  if (!Array.isArray(review?.snapshots) || review.snapshots.length !== 12)
    fail("visual baseline review must contain exactly 12 snapshot decisions");
  const reviewedIds = new Set();
  const byId = new Map();
  for (const entry of review.snapshots) {
    if (!expectedIds.has(entry?.id) || reviewedIds.has(entry.id))
      fail(
        "visual baseline review has a missing, unknown, or duplicate snapshot decision"
      );
    if (entry?.decision !== "accepted" || !SHA256.test(entry?.sha256 ?? ""))
      fail(
        `visual baseline review snapshot ${entry.id} is not accepted with a SHA-256 hash`
      );
    if (
      typeof entry?.rationale !== "string" ||
      entry.rationale.trim().length < 12
    )
      fail(
        `visual baseline review snapshot ${entry.id} needs a substantive rationale`
      );
    reviewedIds.add(entry.id);
    byId.set(entry.id, entry);
  }
  if (reviewedIds.size !== expectedIds.size)
    fail("visual baseline review does not cover every declared snapshot");
  if (
    !Array.isArray(review?.approvals) ||
    review.approvals.length !== REQUIRED_ROLES.length
  )
    fail(
      "visual baseline review must contain exactly four accountable-role approvals"
    );
  const roles = new Set();
  const actors = new Set();
  for (const approval of review.approvals) {
    if (!REQUIRED_ROLES.includes(approval?.role) || roles.has(approval.role))
      fail("visual baseline review has a missing or duplicate approval role");
    if (
      typeof approval?.actor !== "string" ||
      !approval.actor ||
      approval.actor === event.pull_request.user.login ||
      actors.has(approval.actor)
    )
      fail(
        "visual baseline approvals must be by four distinct actors independent of the PR author"
      );
    if (
      approval?.decision !== "accepted" ||
      !ISO_UTC.test(approval?.reviewedAt ?? "") ||
      !/^https:\/\//.test(approval?.evidenceUri ?? "")
    )
      fail(`visual baseline approval for ${approval.role} is incomplete`);
    roles.add(approval.role);
    actors.add(approval.actor);
  }
  return { byId, actors };
}

function verifyGitHubApprovals(reviews, actors, candidate) {
  const atHead = new Set(
    reviews
      .filter(
        review =>
          review?.state === "APPROVED" && review?.commit_id === candidate
      )
      .map(review => review?.user?.login)
      .filter(Boolean)
  );
  for (const actor of actors) {
    if (!atHead.has(actor))
      fail(
        `visual baseline reviewer ${actor} has no GitHub APPROVED review at the current candidate commit`
      );
  }
}

function verifySnapshotHashes(contract, reviewById, snapshotDirectory) {
  for (const entry of contract.snapshots) {
    const file = resolve(snapshotDirectory, entry.snapshot);
    if (!existsSync(file))
      fail(`approved visual baseline file is missing: ${entry.snapshot}`);
    if (basename(file) !== entry.snapshot)
      fail(`unsafe visual baseline filename: ${entry.snapshot}`);
    if (sha256(file) !== reviewById.get(entry.id).sha256)
      fail(`approved visual baseline hash mismatch: ${entry.snapshot}`);
  }
}

function main() {
  const contractPath = resolve(
    requiredEnvironment("VISUAL_BASELINE_CONTRACT_PATH")
  );
  const reviewPath = resolve(
    requiredEnvironment("VISUAL_BASELINE_REVIEW_PATH")
  );
  const snapshotDirectory = resolve(
    requiredEnvironment("VISUAL_SNAPSHOT_DIRECTORY")
  );
  const candidate = requiredEnvironment("VISUAL_REVIEW_HEAD_COMMIT");
  if (!FULL_SHA.test(candidate))
    fail("VISUAL_REVIEW_HEAD_COMMIT must be a full lower-case SHA");
  const repository = requiredEnvironment("GITHUB_REPOSITORY");
  requiredEnvironment("GITHUB_TOKEN");
  const event = readJson(
    requiredEnvironment("GITHUB_EVENT_PATH"),
    "GitHub event payload"
  );
  if (
    event?.pull_request?.head?.sha !== candidate ||
    !Number.isInteger(event?.pull_request?.number) ||
    typeof event?.pull_request?.user?.login !== "string"
  )
    fail(
      "pull_request event must bind to VISUAL_REVIEW_HEAD_COMMIT and author"
    );

  const contract = readJson(contractPath, "visual baseline contract");
  const review = readJson(reviewPath, "visual baseline review");
  const { ids } = verifyContract(contract);
  const { byId, actors } = verifyReview(review, candidate, ids, event);
  verifySnapshotHashes(contract, byId, snapshotDirectory);
  verifyGitHubApprovals(
    gitHubReviews(repository, event.pull_request.number),
    actors,
    candidate
  );
  process.stdout.write(
    `${JSON.stringify({ status: "passed", candidate, snapshots: ids.size, reviewers: actors.size }, null, 2)}\n`
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
