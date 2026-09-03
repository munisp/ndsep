#!/usr/bin/env node
/**
 * Render or deliver sanitized break-glass alert events after offline evidence
 * verification. The default is dry-run; --deliver requires an explicit protected
 * environment confirmation and both SIEM + PagerDuty credentials.
 */
import { lstat, mkdir, open, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sha256 } from "./verify-break-glass-authorization.mjs";
import { verifyBreakGlassEvidence } from "./verify-break-glass-evidence.mjs";

export const SIEM_MODES = new Set(["splunk-hec", "elastic"]);
export const DELIVERY_CONFIRMATION = "DELIVER_SANITIZED_BREAK_GLASS_EVENTS";
const DEFAULT_ALERT_DELIVERY_POLICY = ".github/security/break-glass-alert-delivery-policy.json";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseHttpsUrl(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} is required`);
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label} must be an HTTPS URL`); }
  assert(parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash,
    `${label} must be a credential-free HTTPS URL without query or fragment`);
  return parsed;
}

export async function readAlertDeliveryPolicy(path, verified) {
  const stat = await lstat(path);
  assert(stat.isFile() && !stat.isSymbolicLink(), "Break-glass alert delivery policy must be a regular non-symlink file");
  const handle = await open(path, "r");
  let raw;
  try {
    const opened = await handle.stat();
    assert(opened.isFile(), "Break-glass alert delivery policy must be a regular file");
    raw = await handle.readFile();
  } finally {
    await handle.close();
  }
  let policy;
  try { policy = JSON.parse(raw.toString("utf8")); } catch { throw new Error("Break-glass alert delivery policy is not valid JSON"); }
  assert(policy !== null && typeof policy === "object" && !Array.isArray(policy), "Break-glass alert delivery policy must be a JSON object");
  assert(policy.schemaVersion === "ndsep.break-glass-alert-delivery-policy.v1", "Break-glass alert delivery policy schema is unsupported");
  assert(policy.repository === verified.repository, "Break-glass alert delivery policy repository mismatch");
  assert(policy.environment === "production-release", "Break-glass alert delivery policy environment mismatch");
  assert(policy.enabled === true, "Break-glass alert delivery is disabled until accountable maintainers enable the reviewed policy");
  assert(Array.isArray(policy.allowedSiemModes) && policy.allowedSiemModes.every(mode => SIEM_MODES.has(mode)),
    "Break-glass alert delivery policy SIEM modes are invalid");
  assert(policy.pagerDutyEndpoint === "https://events.pagerduty.com/v2/enqueue", "Break-glass alert delivery policy PagerDuty endpoint is invalid");
  assert(policy.attestationRequired === true && policy.externalImmutableRetentionRequired === true && policy.noReadinessCredit === true,
    "Break-glass alert delivery policy must preserve attestation, retention, and no-readiness requirements");
  return policy;
}

export function nonSecretEnvironment(name) {
  const value = process.env[name];
  assert(typeof value === "string" && value.length > 0, `${name} is required`);
  return value;
}

export function normalizeElasticIndex(value) {
  assert(/^[a-z0-9][a-z0-9._-]{0,254}$/.test(value), "BREAK_GLASS_ELASTIC_INDEX is invalid");
  assert(!value.includes(".."), "BREAK_GLASS_ELASTIC_INDEX is invalid");
  return value;
}

function compactSha(value) {
  return value.replace(/^sha256:/, "");
}

export function buildSanitizedAlert(verified) {
  const eventId = sha256(`${verified.rootSha256}\n${verified.auditRootHash}`);
  const workflowRunUrl = `https://github.com/${verified.repository}/actions/runs/${verified.workflow.runId}`;
  return {
    schemaVersion: "ndsep.break-glass-siem-event.v1",
    eventId,
    eventType: "break_glass.exception_consumed",
    severity: "critical",
    timestamp: verified.generatedAt,
    repository: verified.repository,
    incidentId: verified.authorization.incidentId,
    authorizationId: verified.authorization.id,
    authorizationSha256: verified.authorization.sha256,
    authorizationExpiresAt: verified.authorization.expiresAt,
    candidate: verified.candidate,
    evidence: {
      rootSha256: verified.rootSha256,
      manifestSha256: verified.manifestSha256,
      auditRootHash: verified.auditRootHash,
      artifactDigests: verified.artifactDigests,
      attestationVerificationRequired: true,
      externalImmutableRetentionRequired: true,
    },
    audit: {
      eventTypes: verified.verifiedEventTypes,
      noReadinessCredit: true,
    },
    deliveryScope: "break-glass authorization evidence only; no deployment performed",
    links: {
      workflowRun: workflowRunUrl,
    },
  };
}

export function buildSplunkPayload(alert, endpoint, index) {
  const target = parseHttpsUrl(endpoint, "BREAK_GLASS_SIEM_ENDPOINT");
  assert(/\/services\/collector\/event\/?$/.test(target.pathname),
    "Splunk HEC endpoint must end with /services/collector/event");
  assert(/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(index), "BREAK_GLASS_SPLUNK_INDEX is invalid");
  return {
    endpoint: target.toString(),
    headers: { Authorization: `Splunk ${nonSecretEnvironment("BREAK_GLASS_SIEM_TOKEN")}` },
    body: {
      time: Date.parse(alert.timestamp) / 1000,
      host: "ndsep-github-actions",
      source: "ndsep.break-glass",
      sourcetype: "ndsep:break_glass:v1",
      index,
      event: alert,
    },
  };
}

export function buildElasticPayload(alert, endpoint, index) {
  const target = parseHttpsUrl(endpoint, "BREAK_GLASS_SIEM_ENDPOINT");
  assert(target.pathname === "/" || target.pathname === "", "Elasticsearch endpoint must be an origin without a path");
  const documentId = compactSha(alert.eventId);
  target.pathname = `/${encodeURIComponent(index)}/_create/${documentId}`;
  return {
    endpoint: target.toString(),
    headers: { Authorization: `ApiKey ${nonSecretEnvironment("BREAK_GLASS_SIEM_TOKEN")}` },
    body: alert,
  };
}

export function buildPagerDutyPayload(alert, routingKey) {
  assert(/^[a-zA-Z0-9]{32}$/.test(routingKey), "PAGERDUTY_ROUTING_KEY must be a 32-character integration key");
  const dedupKey = `ndsep-break-glass-${alert.authorizationId}-${compactSha(alert.candidate.digest).slice(0, 24)}`;
  assert(dedupKey.length <= 255, "PagerDuty deduplication key is too long");
  return {
    routing_key: routingKey,
    event_action: "trigger",
    dedup_key: dedupKey,
    client: "NDSEP protected release",
    client_url: `https://github.com/${alert.repository}`,
    payload: {
      summary: `NDSEP break-glass authorization ${alert.authorizationId} requires SOC review`,
      source: `github-actions:${alert.repository}`,
      severity: "critical",
      timestamp: alert.timestamp,
      component: "break-glass-authorization",
      group: "production-release",
      class: "schema-drift-emergency-exception",
      custom_details: {
        event_id: alert.eventId,
        incident_id: alert.incidentId,
        authorization_id: alert.authorizationId,
        authorization_expires_at: alert.authorizationExpiresAt,
        candidate_digest: alert.candidate.digest,
        source_commit: alert.candidate.sourceCommit,
        evidence_root_sha256: alert.evidence.rootSha256,
        audit_root_hash: alert.evidence.auditRootHash,
        no_readiness_credit: true,
        deployment_performed: false,
      },
    },
    links: [{ href: alert.links.workflowRun, text: "Protected authorization workflow" }],
  };
}

export async function postJson(fetchImpl, endpoint, headers, body, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    assert(response.ok, `${label} delivery failed with HTTP ${response.status}`);
    return { status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

function parseArgs(argv) {
  const values = { deliver: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--deliver") {
      assert(values.deliver === false, "Duplicate argument: --deliver");
      values.deliver = true;
      continue;
    }
    assert(["--evidence-dir", "--out-dir"].includes(token), `Unexpected argument: ${token}`);
    const value = argv[index + 1];
    assert(value && !value.startsWith("--"), `Argument ${token} requires a value`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    assert(values[key] === undefined, `Duplicate argument: ${token}`);
    values[key] = value;
    index += 1;
  }
  assert(values.evidenceDir && values.outDir, "usage: publish-break-glass-alerts.mjs --evidence-dir <directory> --out-dir <directory> [--deliver]");
  return values;
}

export async function publishBreakGlassAlerts(args, options = {}) {
  const verified = await verifyBreakGlassEvidence(args.evidenceDir);
  const alert = buildSanitizedAlert(verified);
  const mode = process.env.BREAK_GLASS_SIEM_MODE;
  const delivery = {
    schemaVersion: "ndsep.break-glass-alert-delivery.v1",
    generatedAt: new Date().toISOString(),
    eventId: alert.eventId,
    evidenceRootSha256: verified.rootSha256,
    auditRootHash: verified.auditRootHash,
    mode: args.deliver ? "deliver" : "dry-run",
    siem: { configured: false, delivered: false },
    pagerDuty: { configured: false, delivered: false },
    noReadinessCredit: true,
    deploymentPerformed: false,
  };
  let siemPayload;
  let pagerPayload;
  if (args.deliver) {
    assert(process.env.BREAK_GLASS_DELIVERY_CONFIRMATION === DELIVERY_CONFIRMATION,
      "BREAK_GLASS_DELIVERY_CONFIRMATION must explicitly authorize sanitized alert delivery");
    assert(SIEM_MODES.has(mode), "BREAK_GLASS_SIEM_MODE must be splunk-hec or elastic");
    const policy = await readAlertDeliveryPolicy(process.env.BREAK_GLASS_ALERT_DELIVERY_POLICY ?? DEFAULT_ALERT_DELIVERY_POLICY, verified);
    assert(policy.allowedSiemModes.includes(mode), "Break-glass alert delivery policy does not permit the requested SIEM mode");
    const endpoint = nonSecretEnvironment("BREAK_GLASS_SIEM_ENDPOINT");
    siemPayload = mode === "splunk-hec"
      ? buildSplunkPayload(alert, endpoint, process.env.BREAK_GLASS_SPLUNK_INDEX ?? "ndsep_security")
      : buildElasticPayload(alert, endpoint, normalizeElasticIndex(process.env.BREAK_GLASS_ELASTIC_INDEX ?? "ndsep-break-glass"));
    pagerPayload = buildPagerDutyPayload(alert, nonSecretEnvironment("PAGERDUTY_ROUTING_KEY"));
    delivery.siem = { configured: true, delivered: false, mode };
    delivery.pagerDuty = { configured: true, delivered: false };
    const fetchImpl = options.fetchImpl ?? fetch;
    const siemResult = await postJson(fetchImpl, siemPayload.endpoint, siemPayload.headers, siemPayload.body, "SIEM");
    delivery.siem = { configured: true, delivered: true, mode, status: siemResult.status };
    const pagerResult = await postJson(fetchImpl, policy.pagerDutyEndpoint, {}, pagerPayload, "PagerDuty");
    delivery.pagerDuty = { configured: true, delivered: true, status: pagerResult.status };
  } else if (mode && !SIEM_MODES.has(mode)) {
    throw new Error("BREAK_GLASS_SIEM_MODE must be splunk-hec or elastic when set");
  }
  await mkdir(args.outDir, { recursive: true, mode: 0o700 });
  const receiptPath = resolve(args.outDir, "break-glass-alert-delivery-receipt.json");
  assert(dirname(receiptPath) === resolve(args.outDir), "Delivery receipt path escaped its output directory");
  await writeFile(receiptPath, `${JSON.stringify({ delivery, alertPreview: alert }, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return { delivery, alert, receiptPath, siemPayload, pagerPayload };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const result = await publishBreakGlassAlerts(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify({ status: result.delivery.mode, receipt: result.receiptPath, eventId: result.delivery.eventId }, null, 2));
  } catch (error) {
    console.error(`Break-glass alert publication failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
