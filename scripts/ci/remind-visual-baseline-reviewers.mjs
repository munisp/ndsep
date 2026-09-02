#!/usr/bin/env node
/**
 * Confirmation-gated reviewer reminder for the visual baseline decision set.
 *
 * Default mode is read-only planning. Send mode creates a single PR issue
 * comment that mentions only already-requested, independent reviewers. It does
 * not create approvals, alter review decisions, change snapshots, merge, or
 * modify branch/environment policies.
 *
 * Usage:
 *   node scripts/ci/remind-visual-baseline-reviewers.mjs \
 *     --repo owner/repo --pr 18 --reviewers login1,login2,login3,login4 --mode plan
 *
 *   node scripts/ci/remind-visual-baseline-reviewers.mjs \
 *     --repo owner/repo --pr 18 --reviewers login1,login2,login3,login4 \
 *     --mode send --confirm SEND_VISUAL_BASELINE_REVIEW_REMINDER
 */
import { execFileSync } from "node:child_process";

const FULL_SHA = /^[a-f0-9]{40}$/i;
const LOGIN = /^[A-Za-z0-9-]+$/;
const CONFIRMATION = "SEND_VISUAL_BASELINE_REVIEW_REMINDER";
const REQUIRED_REVIEWERS = 4;
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

function fail(message) {
  throw new Error(message);
}

function arg(args, name) {
  const position = args.indexOf(name);
  return position < 0 ? undefined : args[position + 1];
}

function readGh(args) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", CLICOLOR: "0", GH_FORCE_TTY: "0" },
    }).replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
  } catch (error) {
    const detail =
      error?.stderr?.toString().trim() || error?.message || String(error);
    fail(`GitHub read failed: ${detail}`);
  }
}

function writeGh(args) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", CLICOLOR: "0", GH_FORCE_TTY: "0" },
    }).replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
  } catch (error) {
    const detail =
      error?.stderr?.toString().trim() || error?.message || String(error);
    fail(`GitHub reminder send failed: ${detail}`);
  }
}

function parseReviewers(raw) {
  const reviewers = [
    ...new Set(
      String(raw ?? "")
        .split(",")
        .map(value => value.trim())
        .filter(Boolean)
    ),
  ];
  if (
    reviewers.length !== REQUIRED_REVIEWERS ||
    reviewers.some(value => !LOGIN.test(value))
  ) {
    fail(
      `--reviewers must contain exactly ${REQUIRED_REVIEWERS} distinct GitHub logins`
    );
  }
  return reviewers.sort();
}

function marker(head, reviewers) {
  return `<!-- ndsep-visual-baseline-reminder:${head}:${reviewers.join(",")} -->`;
}

function buildBody(pr, reviewers, reminderMarker) {
  const mentions = reviewers.map(login => `@${login}`).join(" ");
  return `${reminderMarker}\n\n${mentions}\n\n## Independent visual-baseline review requested\n\nPR #${pr.number} is blocked because all **12 Chromium visual baselines** require a recorded independent decision at the current source head \`${pr.headRefOid}\`. Please review the retained candidate capture set and, if acceptable, record your role-specific acceptance in \`e2e/visual-baseline-review.json\` with each PNG SHA-256 and rationale.\n\nRequired roles are product/UX owner, QA lead, accessibility owner, and independent engineering reviewer. Each reviewer must submit a GitHub **APPROVED** review at this exact source head. Do not approve if any capture does not meet product, accessibility, or regression expectations; request a functional correction and a fresh candidate instead.\n\nThis reminder does not approve a baseline, merge the PR, change snapshot tolerances, alter retry policy, or authorize deployment.`;
}

function main() {
  const args = process.argv.slice(2);
  const repo = arg(args, "--repo");
  const prNumber = Number(arg(args, "--pr"));
  const mode = arg(args, "--mode") ?? "plan";
  const reviewers = parseReviewers(arg(args, "--reviewers"));
  if (
    !repo ||
    !/^[\w.-]+\/[\w.-]+$/.test(repo) ||
    !Number.isInteger(prNumber) ||
    prNumber < 1 ||
    !["plan", "send"].includes(mode)
  ) {
    fail(
      "Usage: --repo owner/repo --pr positive-integer --reviewers four-logins --mode plan|send [--confirm SEND_VISUAL_BASELINE_REVIEW_REMINDER]"
    );
  }
  if (mode === "send" && arg(args, "--confirm") !== CONFIRMATION)
    fail(`--confirm must equal ${CONFIRMATION} for send mode`);

  const fields =
    "number,url,author,headRefOid,reviewDecision,mergeStateStatus,reviewRequests";
  const pr = JSON.parse(
    readGh(["pr", "view", String(prNumber), "--repo", repo, "--json", fields])
  );
  if (!FULL_SHA.test(pr.headRefOid ?? ""))
    fail("pull request has no full source head SHA");
  if (reviewers.includes(pr.author?.login))
    fail("the PR author cannot receive an independent-review reminder");

  const requested = new Set(
    (pr.reviewRequests ?? []).map(entry => entry?.login).filter(Boolean)
  );
  const unassigned = reviewers.filter(login => !requested.has(login));
  if (unassigned.length)
    fail(
      `refusing to notify unassigned reviewer(s): ${unassigned.join(", ")}; request review through the authorized governance process first`
    );

  const reminderMarker = marker(pr.headRefOid, reviewers);
  const comments = JSON.parse(
    readGh(["api", `repos/${repo}/issues/${prNumber}/comments?per_page=100`])
  );
  const recentMatching = comments.find(
    comment =>
      typeof comment?.body === "string" &&
      comment.body.includes(reminderMarker) &&
      Date.now() - Date.parse(comment.created_at) < REMINDER_WINDOW_MS
  );
  const body = buildBody(pr, reviewers, reminderMarker);
  const plan = {
    status: mode === "plan" ? "PLAN_READY" : "SENT",
    repository: repo,
    pullRequest: {
      number: pr.number,
      url: pr.url,
      head: pr.headRefOid,
      author: pr.author.login,
      reviewDecision: pr.reviewDecision,
      mergeStateStatus: pr.mergeStateStatus,
    },
    reviewers,
    reminderMarker,
    deduplicated: Boolean(recentMatching),
    proposedBody: body,
  };

  if (mode === "plan" || recentMatching) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  const response = JSON.parse(
    writeGh([
      "api",
      "--method",
      "POST",
      `repos/${repo}/issues/${prNumber}/comments`,
      "-f",
      `body=${body}`,
    ])
  );
  process.stdout.write(
    `${JSON.stringify({ ...plan, commentUrl: response.html_url, commentId: response.id }, null, 2)}\n`
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
