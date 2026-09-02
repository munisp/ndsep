#!/usr/bin/env tsx
/**
 * Staging-only post-rollback verification.
 *
 * This program performs no deploy, traffic-switch, replay, offset mutation, schema
 * mutation, or data mutation. It refuses non-staging URLs and requires a dedicated
 * read-only PostgreSQL principal. It is intended for a protected staging runner after
 * an approved rollback controller has captured immutable workload/traffic state.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";

type CheckStatus = "passed" | "failed";
type Check = {
  id: string;
  status: CheckStatus;
  detail: string;
  elapsedMs: number;
};
type RollbackState = {
  drillId: string;
  candidateDigest: string;
  rollbackDigest: string;
  activeImageDigests: string[];
  activeSlot: string;
  desiredReplicas: number;
  readyReplicas: number;
  capturedAt: string;
};
type AsyncEvidence = {
  drillId: string;
  outboxCorrelationId: string;
  webhookEventId: string;
  kafka: { status: "confirmed"; correlationId: string; duplicateDeliveries: number };
  temporal: { status: "confirmed"; workflowId: string; duplicateExecutions: number };
  payment: { status: "confirmed"; paymentReference: string; transactionId: string; duplicateTransitions: number };
};
type ObservabilityEvidence = {
  drillId: string;
  capturedAt: string;
  observationWindowSeconds: number;
  allWithinApprovedBaseline: boolean;
  panics: number;
  serializationErrors: number;
  crashLoopRestarts: number;
  grpcServerErrors: number;
  consumerLag: number;
};

type PlaywrightResult = { status?: string; retry?: number };
type PlaywrightTest = { results?: PlaywrightResult[] };
type PlaywrightSpec = { tests?: PlaywrightTest[] };
type PlaywrightSuite = { suites?: PlaywrightSuite[]; specs?: PlaywrightSpec[] };
type PlaywrightReport = { suites?: PlaywrightSuite[] };

type Report = {
  schemaVersion: 1;
  kind: "staging-rollback-verification";
  sourceCommit: string;
  drillId: string;
  candidateDigest: string;
  rollbackDigest: string;
  startedAt: string;
  completedAt: string;
  passed: boolean;
  checks: Check[];
};

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const DRILL_ID = /^staging-rollback-[a-z0-9-]{8,80}$/;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function ensureDigest(name: string, value: string): string {
  if (!SHA256.test(value)) throw new Error(`${name} must be a sha256 immutable image digest`);
  return value;
}

function ensureStagingUrl(name: string, raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS`);
  if (!/staging/i.test(url.hostname)) throw new Error(`${name} must target a staging hostname`);
  return url;
}

function ensureStagingDatabaseUrl(name: string, raw: string, hostAllowlist: Set<string>): URL {
  const url = new URL(raw);
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error(`${name} must be a PostgreSQL URL`);
  if (!hostAllowlist.has(url.hostname.toLowerCase())) {
    throw new Error(`${name} host ${url.hostname} is not listed in STAGING_READONLY_DB_HOSTS`);
  }
  return url;
}

function parseJsonFile<T>(file: string, label: string): Promise<T> {
  return fs.readFile(file, "utf8").then((text) => {
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`${label} is not valid JSON`);
    }
  });
}

function bounded(value: unknown, limit = 200): string {
  return String(value ?? "").replace(/[\r\n]+/g, " ").slice(0, limit);
}

async function fetchBounded(url: URL, init?: RequestInit): Promise<{ response: Response; text: string; elapsedMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const started = performance.now();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
    return { response, text: await response.text(), elapsedMs: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timeout);
  }
}

function parseJson(text: string, label: string): Record<string, unknown> | unknown[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    return parsed as Record<string, unknown> | unknown[];
  } catch {
    throw new Error(`${label} did not return valid JSON`);
  }
}

function collectPlaywrightResults(suites: PlaywrightSuite[] | undefined): PlaywrightResult[] {
  const results: PlaywrightResult[] = [];
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) results.push(...(test.results ?? []));
    }
    results.push(...collectPlaywrightResults(suite.suites));
  }
  return results;
}

function verifyReleaseSmokeReport(report: PlaywrightReport): string {
  const results = collectPlaywrightResults(report.suites);
  if (results.length !== 5) throw new Error(`release-smoke must report exactly five test results, received ${results.length}`);
  const nonPassing = results.filter((result) => result.status !== "passed" || result.retry !== 0);
  if (nonPassing.length > 0) throw new Error(`release-smoke has ${nonPassing.length} failed, skipped, or retried result(s)`);
  return "five release-smoke browser/API checks passed with zero retries";
}

function hashAuditRow(row: { action: string; resource_type: string | null; resource_id: string | number | null; user_id: string | number | null; details: string; created_at: string }, previousHash: string): string {
  const payload = [
    previousHash,
    row.action,
    row.resource_type ?? "",
    row.resource_id == null ? "" : String(row.resource_id),
    row.user_id == null ? "" : String(row.user_id),
    row.details,
    row.created_at,
  ].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function check(id: string, fn: () => Promise<string>): Promise<Check> {
  const started = performance.now();
  return fn().then(
    (detail) => ({ id, status: "passed", detail, elapsedMs: Math.round(performance.now() - started) }),
    (error: unknown) => ({ id, status: "failed", detail: bounded(error instanceof Error ? error.message : error, 500), elapsedMs: Math.round(performance.now() - started) })
  );
}

async function queryOne<T extends Record<string, unknown>>(client: PoolClient, sql: string, values: unknown[] = []): Promise<T> {
  const result = await client.query<T>(sql, values);
  if (result.rows.length !== 1) throw new Error(`expected exactly one database row, received ${result.rows.length}`);
  return result.rows[0];
}

async function assertReadOnlyPrincipal(client: PoolClient, expectedUser: string): Promise<string> {
  const identity = await queryOne<{ current_user: string; transaction_read_only: string }>(
    client,
    "SELECT current_user, current_setting('transaction_read_only') AS transaction_read_only"
  );
  if (identity.current_user !== expectedUser) throw new Error(`database current_user ${identity.current_user} does not match STAGING_READONLY_DATABASE_USER`);
  if (identity.transaction_read_only !== "on") throw new Error("database transaction is not read-only");

  const privilegeCheck = await queryOne<Record<string, boolean>>(
    client,
    `SELECT
       has_table_privilege(current_user, 'public.domain_event_outbox', 'INSERT') AS outbox_insert,
       has_table_privilege(current_user, 'public.payment_commands', 'INSERT') AS payment_insert,
       has_table_privilege(current_user, 'public.webhook_deliveries', 'INSERT') AS webhook_insert,
       has_table_privilege(current_user, 'public.audit_logs', 'INSERT') AS audit_insert`
  );
  const writable = Object.entries(privilegeCheck).filter(([, allowed]) => allowed);
  if (writable.length > 0) throw new Error(`read-only principal has INSERT privileges: ${writable.map(([name]) => name).join(', ')}`);
  return `read-only principal ${identity.current_user} verified`;
}

async function verifyAuditChain(client: PoolClient, startId: number): Promise<string> {
  const predecessor = await client.query<{ hash_chain: string | null }>(
    `SELECT hash_chain
       FROM public.audit_logs
      WHERE id < $1
      ORDER BY id DESC
      LIMIT 1`,
    [startId]
  );
  const predecessorHash = predecessor.rows[0]?.hash_chain;
  if (predecessor.rows.length > 0 && !predecessorHash) {
    throw new Error(`audit-chain predecessor before id ${startId} has no hash_chain`);
  }

  const rows = await client.query<{
    id: number;
    action: string;
    resource_type: string | null;
    resource_id: string | null;
    user_id: string | null;
    details: string;
    created_at: string;
    previous_hash: string | null;
    hash_chain: string | null;
  }>(
    `SELECT id, action, resource_type, resource_id, user_id,
            COALESCE(details::text, '{}') AS details,
            created_at::text AS created_at, previous_hash, hash_chain
       FROM public.audit_logs
      WHERE id >= $1
      ORDER BY id ASC`,
    [startId]
  );
  if (rows.rows.length === 0) throw new Error(`no audit logs found at or after audit-chain start id ${startId}`);

  let previous = predecessorHash ?? "GENESIS";
  for (const row of rows.rows) {
    if (!row.hash_chain) throw new Error(`audit_logs id ${row.id} is missing hash_chain; no backfill is permitted during verification`);
    const expectedPrevious = previous === "GENESIS" ? null : previous;
    if (row.previous_hash !== expectedPrevious) throw new Error(`audit_logs id ${row.id} has an invalid previous_hash link`);
    const expected = hashAuditRow(row, previous);
    if (row.hash_chain !== expected) throw new Error(`audit_logs id ${row.id} has a hash-chain mismatch`);
    previous = row.hash_chain;
  }
  return `audit chain verified across ${rows.rows.length} rows starting at id ${startId}`;
}

function requireExactState(value: RollbackState, drillId: string, candidateDigest: string, rollbackDigest: string): string {
  if (value.drillId !== drillId) throw new Error("rollback-state drillId does not match STAGING_ROLLBACK_DRILL_ID");
  if (value.candidateDigest !== candidateDigest || value.rollbackDigest !== rollbackDigest) throw new Error("rollback-state image digests do not match requested digests");
  if (!Array.isArray(value.activeImageDigests) || value.activeImageDigests.length === 0) throw new Error("rollback-state has no active image digests");
  if (value.activeImageDigests.some((digest) => digest !== rollbackDigest)) throw new Error("active traffic is not exclusively serving the approved rollback digest");
  if (!value.activeSlot) throw new Error("rollback-state activeSlot is required");
  if (!Number.isInteger(value.desiredReplicas) || value.desiredReplicas < 1 || value.readyReplicas !== value.desiredReplicas) throw new Error("rollback-state replicas are not fully ready");
  if (Number.isNaN(Date.parse(value.capturedAt))) throw new Error("rollback-state capturedAt is invalid");
  return `active slot ${value.activeSlot} serves ${value.readyReplicas}/${value.desiredReplicas} replicas at rollback digest`;
}

function requireAsyncEvidence(value: AsyncEvidence, drillId: string, paymentReference: string): string {
  if (value.drillId !== drillId) throw new Error("async reconciliation drillId mismatch");
  if (!value.outboxCorrelationId.startsWith(`${drillId}:`)) throw new Error("outbox correlation ID is outside drill scope");
  if (!value.webhookEventId.startsWith(`${drillId}:`)) throw new Error("webhook event ID is outside drill scope");
  if (value.kafka.status !== "confirmed" || value.kafka.correlationId !== value.outboxCorrelationId || value.kafka.duplicateDeliveries !== 0) throw new Error("Kafka reconciliation is not exactly once for the drill correlation ID");
  if (value.temporal.status !== "confirmed" || !value.temporal.workflowId || value.temporal.duplicateExecutions !== 0) throw new Error("Temporal reconciliation is incomplete or duplicate");
  if (value.payment.status !== "confirmed" || value.payment.paymentReference !== paymentReference || !value.payment.transactionId || value.payment.duplicateTransitions !== 0) throw new Error("payment reconciliation is incomplete or duplicate");
  return `Kafka, Temporal, and payment reconciliation confirmed for ${value.outboxCorrelationId}`;
}

function requireObservabilityEvidence(value: ObservabilityEvidence, drillId: string): string {
  if (value.drillId !== drillId) throw new Error("observability evidence drillId mismatch");
  if (Number.isNaN(Date.parse(value.capturedAt))) throw new Error("observability evidence capturedAt is invalid");
  if (!Number.isInteger(value.observationWindowSeconds) || value.observationWindowSeconds < 300) throw new Error("observability window must be at least 300 seconds");
  if (!value.allWithinApprovedBaseline) throw new Error("observability evidence reports an approved-baseline breach");
  if (value.panics !== 0 || value.serializationErrors !== 0 || value.crashLoopRestarts !== 0 || value.grpcServerErrors !== 0 || value.consumerLag !== 0) {
    throw new Error("observability evidence reports panic, serialization, restart, gRPC, or consumer-lag failure");
  }
  return `five-minute observability window is within approved baseline`;
}

async function main(): Promise<void> {
  const sourceCommit = required("STAGING_SOURCE_COMMIT");
  if (!/^[a-f0-9]{40}$/i.test(sourceCommit)) throw new Error("STAGING_SOURCE_COMMIT must be a full commit SHA");
  const drillId = required("STAGING_ROLLBACK_DRILL_ID");
  if (!DRILL_ID.test(drillId)) throw new Error("STAGING_ROLLBACK_DRILL_ID is invalid");
  const candidateDigest = ensureDigest("STAGING_CANDIDATE_IMAGE_DIGEST", required("STAGING_CANDIDATE_IMAGE_DIGEST"));
  const rollbackDigest = ensureDigest("STAGING_ROLLBACK_IMAGE_DIGEST", required("STAGING_ROLLBACK_IMAGE_DIGEST"));
  if (candidateDigest === rollbackDigest) throw new Error("candidate and rollback image digests must differ");
  const base = ensureStagingUrl("STAGING_TEST_BASE_URL", required("STAGING_TEST_BASE_URL"));
  const readonlyUser = required("STAGING_READONLY_DATABASE_USER");
  const allowedHosts = new Set(required("STAGING_READONLY_DB_HOSTS").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  const readonlyUrl = ensureStagingDatabaseUrl("STAGING_READONLY_DATABASE_URL", required("STAGING_READONLY_DATABASE_URL"), allowedHosts);
  if (readonlyUrl.username !== readonlyUser) throw new Error("STAGING_READONLY_DATABASE_URL user does not match STAGING_READONLY_DATABASE_USER");
  const stateFile = path.resolve(required("STAGING_ROLLBACK_STATE_FILE"));
  const asyncEvidenceFile = path.resolve(required("STAGING_ASYNC_RECONCILIATION_FILE"));
  const observabilityFile = path.resolve(required("STAGING_OBSERVABILITY_EVIDENCE_FILE"));
  const releaseSmokeFile = path.resolve(required("STAGING_RELEASE_SMOKE_RESULT_FILE"));
  const auditChainStartId = Number(required("STAGING_AUDIT_CHAIN_START_ID"));
  if (!Number.isInteger(auditChainStartId) || auditChainStartId < 1) throw new Error("STAGING_AUDIT_CHAIN_START_ID must be a positive integer");
  const authPath = required("STAGING_AUTHORIZATION_PROBE_PATH");
  const authToken = required("STAGING_MFA_TOKEN");
  const authExpectedStatus = Number(required("STAGING_AUTHORIZATION_PROBE_EXPECTED_STATUS"));
  if (!Number.isInteger(authExpectedStatus) || authExpectedStatus < 200 || authExpectedStatus > 299) throw new Error("STAGING_AUTHORIZATION_PROBE_EXPECTED_STATUS must be a 2xx status");
  if (!authPath.startsWith("/")) throw new Error("STAGING_AUTHORIZATION_PROBE_PATH must start with /");

  const asyncEvidence = await parseJsonFile<AsyncEvidence>(asyncEvidenceFile, "STAGING_ASYNC_RECONCILIATION_FILE");
  const paymentReference = asyncEvidence.payment?.paymentReference;
  const webhookEventId = asyncEvidence.webhookEventId;
  if (!paymentReference || !webhookEventId) throw new Error("async reconciliation evidence must contain per-drill payment and webhook identities");

  const startedAt = new Date().toISOString();
  const report: Report = { schemaVersion: 1, kind: "staging-rollback-verification", sourceCommit, drillId, candidateDigest, rollbackDigest, startedAt, completedAt: "", passed: false, checks: [] };
  const pool = new Pool({ connectionString: readonlyUrl.toString(), max: 1, ssl: { rejectUnauthorized: true } });

  try {
    const rollbackState = await parseJsonFile<RollbackState>(stateFile, "STAGING_ROLLBACK_STATE_FILE");
    report.checks.push(await check("RB-01-rollback-artifact-and-traffic-state", async () => requireExactState(rollbackState, drillId, candidateDigest, rollbackDigest)));

    report.checks.push(await check("RB-03-api-health", async () => {
      const result = await fetchBounded(new URL("/api/health", base));
      if (result.response.status !== 200) throw new Error(`expected HTTP 200, received ${result.response.status}`);
      const body = parseJson(result.text, "health") as Record<string, unknown>;
      if (body.status !== "ok" || body.service !== "ndsep-api" || (body.checks as Record<string, unknown> | undefined)?.database !== "ok") throw new Error("health response is not an API/database-ready result");
      return `healthy API/database response in ${result.elapsedMs}ms`;
    }));

    report.checks.push(await check("RB-02-readiness", async () => {
      const result = await fetchBounded(new URL("/api/ready", base));
      if (result.response.status !== 200) throw new Error(`expected readiness HTTP 200, received ${result.response.status}`);
      return `readiness response in ${result.elapsedMs}ms`;
    }));

    const releaseSmoke = await parseJsonFile<PlaywrightReport>(releaseSmokeFile, "STAGING_RELEASE_SMOKE_RESULT_FILE");
    report.checks.push(await check("RB-04-release-smoke-browser", async () => verifyReleaseSmokeReport(releaseSmoke)));

    report.checks.push(await check("RB-05-unauthenticated-boundary", async () => {
      const auth = await fetchBounded(new URL("/api/trpc/auth.me?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D", base));
      if (auth.response.status !== 200) throw new Error(`auth.me expected HTTP 200, received ${auth.response.status}`);
      parseJson(auth.text, "auth.me");
      const worker = await fetchBounded(new URL("/api/workers/status", base));
      if (worker.response.status !== 401) throw new Error(`worker status expected anonymous 401, received ${worker.response.status}`);
      const orchestration = await fetchBounded(new URL("/api/trpc/orchestration.temporalConfig?input=%7B%22json%22%3Anull%7D", base));
      if (orchestration.response.status !== 401) throw new Error(`temporalConfig expected anonymous 401, received ${orchestration.response.status}`);
      return "well-formed anonymous auth response and protected metadata boundary verified";
    }));

    report.checks.push(await check("RB-06-security-headers", async () => {
      const result = await fetchBounded(new URL("/api/health", base));
      if (result.response.headers.get("x-content-type-options") !== "nosniff") throw new Error("missing X-Content-Type-Options: nosniff");
      if (!result.response.headers.get("x-frame-options")) throw new Error("missing X-Frame-Options");
      if (result.response.headers.get("x-ndsep-api-version") !== "2.0.0") throw new Error("unexpected or missing X-NDSEP-API-Version");
      return "edge security headers verified";
    }));

    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      report.checks.push(await check("RB-11-readonly-database-principal", () => assertReadOnlyPrincipal(client, readonlyUser)));

      report.checks.push(await check("RB-07-outbox-identity", async () => {
        const duplicates = await client.query<{ correlation_id: string; occurrences: string }>(
          `SELECT correlation_id, COUNT(*)::text AS occurrences
             FROM public.domain_event_outbox
            GROUP BY correlation_id
           HAVING COUNT(*) <> 1
            LIMIT 1`
        );
        if (duplicates.rows.length) throw new Error(`duplicate outbox correlation_id ${duplicates.rows[0].correlation_id}`);
        return "domain_event_outbox correlation IDs are unique";
      }));

      report.checks.push(await check("RB-08-outbox-leases", async () => {
        const expired = await client.query<{ id: string }>(
          `SELECT id::text
             FROM public.domain_event_outbox
            WHERE status = 'publishing' AND lease_expires_at < NOW()
            LIMIT 1`
        );
        if (expired.rows.length) throw new Error(`expired publishing outbox lease ${expired.rows[0].id}`);
        return "no expired publishing outbox lease";
      }));

      report.checks.push(await check("RB-09-payment-command-identity", async () => {
        const duplicates = await client.query<{ payment_reference: string }>(
          `SELECT payment_reference
             FROM public.payment_commands
            GROUP BY payment_reference
           HAVING COUNT(*) <> 1
            LIMIT 1`
        );
        if (duplicates.rows.length) throw new Error(`duplicate payment reference ${duplicates.rows[0].payment_reference}`);
        const drill = await queryOne<{ count: string }>(client, "SELECT COUNT(*)::text AS count FROM public.payment_commands WHERE payment_reference = $1", [paymentReference]);
        if (drill.count !== "1") throw new Error(`drill payment reference has ${drill.count} command records`);
        return "payment command identities are unique and drill command is singular";
      }));

      report.checks.push(await check("RB-10-payment-command-leases", async () => {
        const expired = await client.query<{ id: string }>(
          `SELECT id::text
             FROM public.payment_commands
            WHERE status IN ('processing_ledger', 'processing_settlement')
              AND lease_expires_at < NOW()
            LIMIT 1`
        );
        if (expired.rows.length) throw new Error(`expired payment command lease ${expired.rows[0].id}`);
        return "no expired payment processing lease";
      }));

      report.checks.push(await check("RB-14-webhook-ledger", async () => {
        const deliveries = await client.query<{ attempts: string; success_count: string }>(
          `SELECT COUNT(*)::text AS attempts,
                  COUNT(*) FILTER (WHERE success)::text AS success_count
             FROM public.webhook_deliveries
            WHERE payload ->> 'id' = $1`,
          [webhookEventId]
        );
        const row = deliveries.rows[0];
        if (!row || Number(row.attempts) < 1 || Number(row.success_count) < 1) throw new Error("drill webhook event has no successful durable delivery record");
        return `durable webhook ledger records ${row.attempts} attempt(s) with ${row.success_count} success(es)`;
      }));

      report.checks.push(await check("RB-15-financial-ledger", async () => {
        const command = await queryOne<{ status: string; tigerbeetle_transaction_id: string | null; mojaloop_reference: string | null }>(
          client,
          `SELECT status::text, tigerbeetle_transaction_id, mojaloop_reference
             FROM public.payment_commands
            WHERE payment_reference = $1`,
          [paymentReference]
        );
        if (command.status !== "completed") throw new Error(`drill payment command status is ${command.status}, not completed`);
        if (!command.tigerbeetle_transaction_id || !command.mojaloop_reference) throw new Error("completed drill payment command lacks TigerBeetle or Mojaloop reference");
        return "completed payment command has both required external reconciliation references";
      }));

      report.checks.push(await check("RB-12-audit-hash-chain", () => verifyAuditChain(client, auditChainStartId)));
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    report.checks.push(await check("RB-16-authorized-control", async () => {
      const result = await fetchBounded(new URL(authPath, base), { headers: { Authorization: `Bearer ${authToken}` } });
      if (result.response.status !== authExpectedStatus) throw new Error(`authorized staging control expected HTTP ${authExpectedStatus}, received ${result.response.status}`);
      return `dedicated MFA staging control returned HTTP ${authExpectedStatus}`;
    }));

    report.checks.push(await check("RB-13-async-reconciliation", async () => requireAsyncEvidence(asyncEvidence, drillId, paymentReference)));

    const observability = await parseJsonFile<ObservabilityEvidence>(observabilityFile, "STAGING_OBSERVABILITY_EVIDENCE_FILE");
    report.checks.push(await check("RB-17-observability", async () => requireObservabilityEvidence(observability, drillId)));
  } finally {
    await pool.end();
    report.completedAt = new Date().toISOString();
    report.passed = report.checks.length === 17 && report.checks.every((entry) => entry.status === "passed");
    const outDir = path.resolve(optional("STAGING_ROLLBACK_EVIDENCE_DIR") ?? "staging-rollback-evidence");
    await fs.mkdir(outDir, { recursive: true });
    const reportPath = path.join(outDir, "rollback-verification.json");
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`Wrote sanitized rollback verification report: ${reportPath}\n`);
    for (const entry of report.checks) process.stdout.write(`${entry.status === "passed" ? "PASS" : "FAIL"} ${entry.id}: ${entry.detail}\n`);
    if (!report.passed) process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`STAGING ROLLBACK VERIFICATION FAILED: ${bounded(error instanceof Error ? error.message : error, 500)}`);
  process.exitCode = 1;
});
