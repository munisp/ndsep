#!/usr/bin/env node
/**
 * Read-only PR readiness collector.
 *
 * This program never creates reviews, approves, merges, dispatches workflows, changes
 * GitHub settings, publishes artifacts, or updates visual snapshots. It collects the
 * visible PR review/check state and records missing evidence as missing.
 *
 * Usage:
 *   node scripts/ci/collect-pr-readiness-evidence.mjs \
 *     --repo munisp/ndsep --pr 18 --out-dir /secure/evidence/pr-18
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const FULL_SHA = /^[a-f0-9]{40}$/i;
const CONFIRMATION = "READ_ONLY_PR_READINESS_COLLECTION";
const REQUIRED_ACCOUNTABLE_ROLES = [
  "independent engineering reviewer",
  "release manager",
  "repository administrator",
  "environment administrator",
  "security owner",
  "DBA/platform operations",
  "IAM and authorization owners",
  "payments and finance control owner",
  "SOC/compliance owner",
  "SRE/data-protection owner",
  "product, QA, and accessibility owners",
  "business release owner",
];

function usage() {
  throw new Error(
    "Usage: node scripts/ci/collect-pr-readiness-evidence.mjs --repo owner/repo --pr number --out-dir absolute-path [--confirm READ_ONLY_PR_READINESS_COLLECTION]"
  );
}

function argument(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function runGh(args) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", CLICOLOR: "0", GH_FORCE_TTY: "0" },
    });
  } catch (error) {
    const detail =
      error?.stderr?.toString().trim() || error?.message || String(error);
    throw new Error(`GitHub read failed: ${detail}`);
  }
}

function runPlaywrightList() {
  try {
    const output = execFileSync(
      "pnpm",
      [
        "exec",
        "playwright",
        "test",
        "e2e/visual-regression.spec.ts",
        "--project=chromium",
        "--list",
        "--reporter=line",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PLAYWRIGHT_HTML_OPEN: "never" },
      }
    );
    return output
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.includes("snapshot:"));
  } catch (error) {
    const detail =
      error?.stderr?.toString().trim() || error?.message || String(error);
    return [`Playwright discovery unavailable: ${detail}`];
  }
}

function normalizeChecks(items) {
  return (items ?? []).map(item => ({
    name: item.name ?? "unnamed-check",
    status: item.status ?? "UNKNOWN",
    conclusion: item.conclusion ?? "",
    detailsUrl: item.detailsUrl ?? null,
  }));
}

function isPassing(check) {
  return check.status === "COMPLETED" && check.conclusion === "SUCCESS";
}

function markdownEscaped(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function gitHubReviewSummary(pr) {
  const head = pr.headRefOid;
  const author = pr.author?.login;
  const reviews = (pr.reviews ?? []).map(review => ({
    actor: review.author?.login ?? "unknown",
    state: review.state,
    submittedAt: review.submittedAt ?? null,
    commitOid: review.commit?.oid ?? null,
    independent: Boolean(
      review.author?.login && review.author.login !== author
    ),
    atCurrentHead: review.commit?.oid === head,
  }));
  const independentApprovalAtHead = reviews.some(
    review =>
      review.state === "APPROVED" && review.independent && review.atCurrentHead
  );
  return { author, reviews, independentApprovalAtHead };
}

function buildImmediateBlockers(pr, review, checks) {
  const blockers = [];
  if (!review.independentApprovalAtHead)
    blockers.push({
      id: "GOV-001",
      priority: "P0",
      owner: "Independent reviewer / release manager",
      reason: "No independent approval bound to the current PR head",
    });
  for (const check of checks.filter(entry => !isPassing(entry))) {
    const lower = check.name.toLowerCase();
    if (lower.includes("visual-regression"))
      blockers.push({
        id: "E2E-001",
        priority: "P0",
        owner: "Product, UX, QA, accessibility and independent code reviewer",
        reason:
          "Visual regression evidence is not passing; each discovered snapshot requires explicit review before a baseline commit",
      });
    else if (
      lower.includes("extended e2e") ||
      lower.includes("matrix evidence")
    )
      blockers.push({
        id: "E2E-002",
        priority: "P0",
        owner: "QA / release engineering",
        reason:
          "Mandatory fan-in has no complete all-green, zero-retry evidence set",
      });
    else if (
      lower.includes("trivy") ||
      lower === "security scan" ||
      lower === "security-gate"
    )
      blockers.push({
        id: "SEC-001",
        priority: "P0",
        owner: "Go service owner / product security",
        reason:
          "A security gate is failing; do not merge until a fresh scan succeeds or an authorized, time-bounded exception is independently approved",
      });
  }
  if (pr.mergeStateStatus !== "CLEAN")
    blockers.push({
      id: "GOV-002",
      priority: "P0",
      owner: "Release manager",
      reason: `PR merge state is ${pr.mergeStateStatus ?? "UNKNOWN"}`,
    });
  return blockers.filter(
    (blocker, index, rows) =>
      rows.findIndex(other => other.id === blocker.id) === index
  );
}

function complianceBaselineRegister() {
  return [
    [
      "GOV-003",
      "Protected environments",
      "Repository/environment/security administrators",
      "Protected staging and production-release environments, reviewer rules, branch restrictions, no-bypass proof, and scoped deployment identities.",
    ],
    [
      "REL-001",
      "Immutable artifact",
      "Release engineering",
      "Normal merge SHA plus immutable image digest and retained build record.",
    ],
    [
      "SEC-002",
      "Digest-bound assurance",
      "Product security / release engineering",
      "Direct digest scan, SBOM, provenance, Cosign/Fulcio verification, and policy result bound to one digest.",
    ],
    [
      "DB-001",
      "Database/recovery",
      "DBA / platform operations / security",
      "Migration, schema drift, TLS/role proof, backup/restore, forward/rollback compatibility, HA/failover, and approved RTO/RPO evidence.",
    ],
    [
      "IAM-001",
      "Identity and authorization",
      "IAM / security / application owners",
      "Real Keycloak discovery/key rotation and valid/invalid token traces; Permify schema/version and allow/deny traces.",
    ],
    [
      "MID-001",
      "Gateway and middleware",
      "Platform and service owners",
      "APISIX, Redis, Kafka/Dapr/Fluvio, Temporal, OpenSearch, Lakehouse success and controlled-failure evidence with correlation IDs.",
    ],
    [
      "FIN-001",
      "Financial settlement",
      "Payments / finance control / authorized partner operator",
      "TigerBeetle and Mojaloop staging/sandbox reconciliation, callback integrity, duplicate/reversal/recovery outcomes.",
    ],
    [
      "OPS-001",
      "Security operations",
      "SOC / security / compliance",
      "SIEM/Pager delivery, audit-chain/break-glass verification, mTLS/CA rotation drill, and incident response evidence.",
    ],
    [
      "RES-001",
      "Resilience and residency",
      "SRE / DBA / data-protection owner",
      "Failure injection, recovery/RTO/RPO, residency, retention/deletion, and dependency-outage evidence.",
    ],
    [
      "UX-001",
      "Product and accessibility",
      "Product / QA / accessibility / operations representatives",
      "Device/browser, critical journeys, offline/sync/replay, accessibility, UX, and UAT acceptance.",
    ],
    [
      "GOV-004",
      "Final release authorization",
      "Engineering / security / operations / compliance / business / release owners",
      "Digest-bound decision, verified evidence index, named approvals, risk statement, exception register, rollback owner, and communications plan.",
    ],
  ].map(([id, baseline, owner, evidence]) => ({
    id,
    baseline,
    owner,
    evidence,
    status: "not evidenced by this read-only PR collector",
  }));
}

function writeMarkdown(report, file) {
  const lines = [
    "# NDSEP Pull-Request Readiness Evidence Report",
    "",
    `**Generated at:** ${report.generatedAt}`,
    `**Repository:** ${report.repository}`,
    `**Pull request:** #${report.pullRequest.number} (${report.pullRequest.url})`,
    `**Current head:** \`${report.pullRequest.headRefOid}\``,
    "",
    "## Collection scope",
    "",
    "This report is generated by a read-only collector. It does not approve, merge, dispatch, deploy, create a baseline, set an environment secret, create an exception, or infer external-service acceptance. A missing item is recorded as missing.",
    "",
    "## Immediate merge state",
    "",
    `| Field | Observed value |`,
    `|---|---|`,
    `| Merge state | ${markdownEscaped(report.pullRequest.mergeStateStatus)} |`,
    `| Review decision | ${markdownEscaped(report.pullRequest.reviewDecision)} |`,
    `| Independent approval at current head | ${report.review.independentApprovalAtHead ? "yes" : "no"} |`,
    `| Automated check counts | ${report.summary.passingChecks} passing / ${report.summary.nonPassingChecks} non-passing or skipped / ${report.summary.totalChecks} total |`,
    "",
    "## Check rollup",
    "",
    "| Check | Status | Conclusion | Evidence |",
    "|---|---|---|---|",
    ...report.checks.map(
      check =>
        `| ${markdownEscaped(check.name)} | ${markdownEscaped(check.status)} | ${markdownEscaped(check.conclusion || "—")} | ${check.detailsUrl ? `[log](${check.detailsUrl})` : "—"} |`
    ),
    "",
    "## Immediate blockers",
    "",
    "| ID | Priority | Accountable owner | Required closure |",
    "|---|---|---|---|",
    ...report.immediateBlockers.map(
      entry =>
        `| ${entry.id} | ${entry.priority} | ${entry.owner} | ${entry.reason} |`
    ),
    "",
    "## Visual baseline review set",
    "",
    "The discovered tests listed below require an explicit reviewed baseline decision. A candidate image is not accepted merely because it exists; the protected matrix must continue to run without `--update-snapshots`, with one worker and zero retries.",
    "",
    ...report.visualBaselineTests.map(entry => `- ${entry}`),
    "",
    "## Required compliance approvals and evidence",
    "",
    "| ID | Baseline | Accountable owner | Required evidence | Status |",
    "|---|---|---|---|---|",
    ...report.complianceBaselines.map(
      entry =>
        `| ${entry.id} | ${entry.baseline} | ${entry.owner} | ${entry.evidence} | ${entry.status} |`
    ),
    "",
    "## Required accountable roles",
    "",
    ...report.requiredAccountableRoles.map(role => `- ${role}`),
    "",
    "## Decision",
    "",
    `**${report.decision.status}: ${report.decision.reason}**`,
    "",
  ];
  writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
}

function main() {
  const args = process.argv.slice(2);
  const repo = argument(args, "--repo");
  const prNumber = Number(argument(args, "--pr"));
  const outDirRaw = argument(args, "--out-dir");
  const confirm = argument(args, "--confirm") ?? CONFIRMATION;
  if (
    !repo ||
    !/^[\w.-]+\/[\w.-]+$/.test(repo) ||
    !Number.isInteger(prNumber) ||
    prNumber < 1 ||
    !outDirRaw ||
    !resolve(outDirRaw).startsWith("/")
  )
    usage();
  if (confirm !== CONFIRMATION)
    throw new Error(`--confirm must equal ${CONFIRMATION}`);

  const outDir = resolve(outDirRaw);
  const fields =
    "number,url,headRefOid,baseRefName,headRefName,mergeStateStatus,reviewDecision,author,reviews,statusCheckRollup";
  const raw = runGh([
    "pr",
    "view",
    String(prNumber),
    "--repo",
    repo,
    "--json",
    fields,
  ]);
  const pr = JSON.parse(raw.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, ""));
  if (!FULL_SHA.test(pr.headRefOid ?? ""))
    throw new Error("GitHub response has no full pull-request head SHA");

  const review = gitHubReviewSummary(pr);
  const checks = normalizeChecks(pr.statusCheckRollup);
  const immediateBlockers = buildImmediateBlockers(pr, review, checks);
  const visualBaselineTests = runPlaywrightList();
  const complianceBaselines = complianceBaselineRegister();
  const passingChecks = checks.filter(isPassing).length;
  const report = {
    schemaVersion: 1,
    kind: "ndsep-pr-readiness-evidence",
    generatedAt: new Date().toISOString(),
    collectionMode: "read-only",
    repository: repo,
    pullRequest: {
      number: pr.number,
      url: pr.url,
      baseRefName: pr.baseRefName,
      headRefName: pr.headRefName,
      headRefOid: pr.headRefOid,
      mergeStateStatus: pr.mergeStateStatus,
      reviewDecision: pr.reviewDecision,
    },
    review,
    checks,
    visualBaselineTests,
    immediateBlockers,
    complianceBaselines,
    requiredAccountableRoles: REQUIRED_ACCOUNTABLE_ROLES,
    summary: {
      totalChecks: checks.length,
      passingChecks,
      nonPassingChecks: checks.length - passingChecks,
      immediateBlockers: immediateBlockers.length,
      requiredComplianceBaselines: complianceBaselines.length,
    },
    decision:
      immediateBlockers.length === 0
        ? {
            status: "REVIEW_REQUIRED",
            reason:
              "Immediate PR checks appear satisfied, but this collector cannot establish protected-environment, artifact, external integration, or accountable release evidence.",
          }
        : {
            status: "BLOCKED",
            reason:
              "One or more merge or security evidence blockers remain. See immediateBlockers; do not self-approve, force merge, or bypass a protected check.",
          },
  };

  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const jsonFile = resolve(outDir, "pr-readiness-evidence.json");
  const markdownFile = resolve(outDir, "pr-readiness-report.md");
  writeFileSync(jsonFile, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  writeMarkdown(report, markdownFile);
  process.stdout.write(
    `${JSON.stringify({ status: report.decision.status, jsonFile, markdownFile, summary: report.summary }, null, 2)}\n`
  );
  process.exitCode = report.decision.status === "BLOCKED" ? 1 : 0;
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 2;
}
