#!/usr/bin/env node
/**
 * Publish a sanitized alert when a protected break-glass evidence verification
 * fails. Default mode is dry-run; live delivery is disabled by source policy
 * and requires explicit protected-environment confirmation.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sha256 } from "./verify-break-glass-authorization.mjs";
import {
  DELIVERY_CONFIRMATION,
  SIEM_MODES,
  buildElasticPayload,
  buildSplunkPayload,
  nonSecretEnvironment,
  normalizeElasticIndex,
  postJson,
  readAlertDeliveryPolicy,
} from "./publish-break-glass-alerts.mjs";

const DEFAULT_ALERT_DELIVERY_POLICY = ".github/security/break-glass-alert-delivery-policy.json";
const DELIVERY_SCOPE = "break-glass evidence-tamper detection only; no deployment performed";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cleanErrorCode(value) {
  assert(typeof value === "string" && /^[a-z0-9][a-z0-9._-]{2,95}$/.test(value),
    "--failure-code must be a lowercase sanitized error code");
  return value;
}

function cleanRepository(value) {
  assert(typeof value === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value), "--repository is invalid");
  return value.toLowerCase();
}

function cleanCommit(value) {
  assert(/^[a-f0-9]{40}$/.test(value ?? ""), "--source-commit must be a full lowercase SHA-1");
  return value;
}

function cleanDigest(value) {
  assert(/^sha256:[a-f0-9]{64}$/.test(value ?? ""), "--candidate-digest must be a lowercase sha256 digest");
  return value;
}

function cleanRunId(value) {
  assert(/^[1-9][0-9]*$/.test(value ?? ""), "--run-id must be a positive integer");
  return value;
}

export function buildTamperDetectionAlert(args) {
  const repository = cleanRepository(args.repository);
  const sourceCommit = cleanCommit(args.sourceCommit);
  const candidateDigest = cleanDigest(args.candidateDigest);
  const workflowRunId = cleanRunId(args.runId);
  const failureCode = cleanErrorCode(args.failureCode);
  const eventId = sha256(`ndsep.break-glass-tamper-detection.v1\n${repository}\n${sourceCommit}\n${candidateDigest}\n${workflowRunId}\n${failureCode}`);
  return {
    schemaVersion: "ndsep.break-glass-siem-event.v1",
    eventId,
    eventType: "break_glass.evidence_tamper_detected",
    severity: "critical",
    timestamp: args.occurredAt,
    repository,
    candidate: {
      image: `ghcr.io/${repository}`,
      digest: candidateDigest,
      sourceCommit,
    },
    tamperDetection: {
      failureCode,
      verificationWorkflowRunId: workflowRunId,
      attestationVerificationRequired: true,
      externalImmutableRetentionRequired: true,
    },
    audit: { noReadinessCredit: true },
    deliveryScope: DELIVERY_SCOPE,
    links: { workflowRun: `https://github.com/${repository}/actions/runs/${workflowRunId}` },
  };
}

function buildTamperPagerDutyPayload(alert, routingKey) {
  assert(/^[a-zA-Z0-9]{32}$/.test(routingKey), "PAGERDUTY_ROUTING_KEY must be a 32-character integration key");
  const dedupKey = `ndsep-break-glass-tamper-${alert.tamperDetection.verificationWorkflowRunId}-${alert.eventId.slice(7, 31)}`;
  return {
    routing_key: routingKey,
    event_action: "trigger",
    dedup_key: dedupKey,
    client: "NDSEP protected release",
    client_url: `https://github.com/${alert.repository}`,
    payload: {
      summary: `NDSEP break-glass evidence tamper detection requires SOC review`,
      source: `github-actions:${alert.repository}`,
      severity: "critical",
      timestamp: alert.timestamp,
      component: "break-glass-evidence-verification",
      group: "production-release",
      class: "tamper-detection",
      custom_details: {
        event_id: alert.eventId,
        failure_code: alert.tamperDetection.failureCode,
        verification_workflow_run_id: alert.tamperDetection.verificationWorkflowRunId,
        candidate_digest: alert.candidate.digest,
        source_commit: alert.candidate.sourceCommit,
        no_readiness_credit: true,
        deployment_performed: false,
      },
    },
    links: [{ href: alert.links.workflowRun, text: "Protected emergency workflow" }],
  };
}

function parseArgs(argv) {
  const accepted = new Set(["repository", "source-commit", "candidate-digest", "run-id", "failure-code", "out-dir"]);
  const result = { deliver: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--deliver") {
      assert(result.deliver === false, "Duplicate argument: --deliver");
      result.deliver = true;
      continue;
    }
    assert(token.startsWith("--") && accepted.has(token.slice(2)), `Unexpected argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    assert(value && !value.startsWith("--"), `Argument ${token} requires a value`);
    assert(result[key] === undefined, `Duplicate argument: ${token}`);
    result[key] = value;
    index += 1;
  }
  for (const key of accepted) assert(result[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())], `Missing required argument: --${key}`);
  return result;
}

export async function publishBreakGlassTamperAlert(args, options = {}) {
  const alert = buildTamperDetectionAlert({ ...args, occurredAt: args.occurredAt ?? new Date().toISOString() });
  const receipt = {
    schemaVersion: "ndsep.break-glass-tamper-alert-receipt.v1",
    generatedAt: new Date().toISOString(),
    eventId: alert.eventId,
    eventType: alert.eventType,
    failureCode: alert.tamperDetection.failureCode,
    mode: args.deliver ? "deliver" : "dry-run",
    siem: { configured: false, delivered: false },
    pagerDuty: { configured: false, delivered: false },
    noReadinessCredit: true,
    deploymentPerformed: false,
  };
  if (args.deliver) {
    assert(process.env.BREAK_GLASS_DELIVERY_CONFIRMATION === DELIVERY_CONFIRMATION,
      "BREAK_GLASS_DELIVERY_CONFIRMATION must explicitly authorize sanitized alert delivery");
    const mode = process.env.BREAK_GLASS_SIEM_MODE;
    assert(SIEM_MODES.has(mode), "BREAK_GLASS_SIEM_MODE must be splunk-hec or elastic");
    const policy = await readAlertDeliveryPolicy(process.env.BREAK_GLASS_ALERT_DELIVERY_POLICY ?? DEFAULT_ALERT_DELIVERY_POLICY, { repository: alert.repository });
    assert(policy.allowedSiemModes.includes(mode), "Break-glass alert delivery policy does not permit the requested SIEM mode");
    const endpoint = nonSecretEnvironment("BREAK_GLASS_SIEM_ENDPOINT");
    const siemPayload = mode === "splunk-hec"
      ? buildSplunkPayload(alert, endpoint, process.env.BREAK_GLASS_SPLUNK_INDEX ?? "ndsep_security")
      : buildElasticPayload(alert, endpoint, normalizeElasticIndex(process.env.BREAK_GLASS_ELASTIC_INDEX ?? "ndsep-break-glass"));
    const pagerPayload = buildTamperPagerDutyPayload(alert, nonSecretEnvironment("PAGERDUTY_ROUTING_KEY"));
    const fetchImpl = options.fetchImpl ?? fetch;
    receipt.siem = { configured: true, delivered: false, mode };
    receipt.pagerDuty = { configured: true, delivered: false };
    const siemResult = await postJson(fetchImpl, siemPayload.endpoint, siemPayload.headers, siemPayload.body, "SIEM tamper alert");
    receipt.siem = { configured: true, delivered: true, mode, status: siemResult.status };
    const pagerResult = await postJson(fetchImpl, policy.pagerDutyEndpoint, {}, pagerPayload, "PagerDuty tamper alert");
    receipt.pagerDuty = { configured: true, delivered: true, status: pagerResult.status };
  }
  await mkdir(args.outDir, { recursive: true, mode: 0o700 });
  const receiptPath = resolve(args.outDir, "break-glass-tamper-alert-receipt.json");
  assert(dirname(receiptPath) === resolve(args.outDir), "Tamper alert receipt path escaped its output directory");
  await writeFile(receiptPath, `${JSON.stringify({ receipt, alert }, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return { receipt, alert, receiptPath };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await publishBreakGlassTamperAlert(args);
    console.log(JSON.stringify({ status: result.receipt.mode, receipt: result.receiptPath, eventId: result.receipt.eventId }, null, 2));
  } catch (error) {
    console.error(`Break-glass tamper alert publication failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

export { parseArgs };
