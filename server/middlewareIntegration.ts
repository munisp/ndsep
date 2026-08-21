/**
 * NDSEP Middleware Integration Layer
 * ===================================
 * Centralised event emission for all mutations across routers.
 * Integrates with Dapr, Fluvio, OpenSearch, Lakehouse, and Permify.
 * All calls are fire-and-forget with graceful degradation.
 */
import { emitComplianceEvent, opensearchIndex, lakehouseIngest, daprPublish, fluvioPublish, permifyCheck } from "./middlewareExtensions";
import { logger } from "./logger";

// ── Event type constants ─────────────────────────────────────────────────────

export const EVENTS = {
  // Accreditation
  ACCREDITATION_SUBMITTED: "ndsep.accreditation.submitted",
  ACCREDITATION_REVIEWED: "ndsep.accreditation.reviewed",
  ACCREDITATION_APPROVED: "ndsep.accreditation.approved",
  ACCREDITATION_REJECTED: "ndsep.accreditation.rejected",
  ACCREDITATION_LICENCE_ISSUED: "ndsep.accreditation.licence_issued",

  // Banking
  AML_CASE_CREATED: "ndsep.banking.aml_case_created",
  AML_CASE_UPDATED: "ndsep.banking.aml_case_updated",
  SWIFT_TRANSACTION: "ndsep.banking.swift_transaction",
  KYC_VERIFICATION: "ndsep.banking.kyc_verification",
  FRAUD_ALERT: "ndsep.banking.fraud_alert",
  CORRESPONDENT_BANK: "ndsep.banking.correspondent_bank",
  CBN_REPORT: "ndsep.banking.cbn_report",

  // Billing
  INVOICE_CREATED: "ndsep.billing.invoice_created",
  PAYMENT_RECEIVED: "ndsep.billing.payment_received",
  SUBSCRIPTION_CHANGED: "ndsep.billing.subscription_changed",

  // DPCO
  DPCO_ENGAGEMENT_CREATED: "ndsep.dpco.engagement_created",
  DPCO_EVIDENCE_UPLOADED: "ndsep.dpco.evidence_uploaded",
  DPCO_CAR_GENERATED: "ndsep.dpco.car_generated",
  DPCO_VERIFICATION_SUBMITTED: "ndsep.dpco.verification_submitted",
  DPCO_SCORECARD_UPDATED: "ndsep.dpco.scorecard_updated",

  // Compliance
  COMPLIANCE_VIOLATION_DETECTED: "ndsep.compliance.violation_detected",
  COMPLIANCE_SCORE_UPDATED: "ndsep.compliance.score_updated",
  COMPLIANCE_GAP_IDENTIFIED: "ndsep.compliance.gap_identified",
  COMPLIANCE_REMEDIATION: "ndsep.compliance.remediation",

  // Enforcement
  ENFORCEMENT_CASE_OPENED: "ndsep.enforcement.case_opened",
  ENFORCEMENT_PENALTY_ISSUED: "ndsep.enforcement.penalty_issued",
  ENFORCEMENT_APPEAL: "ndsep.enforcement.appeal",
  ENFORCEMENT_PAYMENT: "ndsep.enforcement.payment",

  // DSAR
  DSAR_SUBMITTED: "ndsep.dsar.submitted",
  DSAR_COMPLETED: "ndsep.dsar.completed",

  // DPIA
  DPIA_CREATED: "ndsep.dpia.created",
  DPIA_APPROVED: "ndsep.dpia.approved",

  // Breach
  BREACH_REPORTED: "ndsep.breach.reported",
  BREACH_ESCALATED: "ndsep.breach.escalated",
  BREACH_RESOLVED: "ndsep.breach.resolved",

  // Consent
  CONSENT_GRANTED: "ndsep.consent.granted",
  CONSENT_WITHDRAWN: "ndsep.consent.withdrawn",

  // Vendor Risk
  VENDOR_RISK_ASSESSED: "ndsep.vendor.risk_assessed",
  VENDOR_RISK_UPDATED: "ndsep.vendor.risk_updated",

  // Incident Response
  INCIDENT_ACTIVATED: "ndsep.incident.activated",
  INCIDENT_RESOLVED: "ndsep.incident.resolved",

  // Regulatory
  REGULATORY_INTELLIGENCE: "ndsep.regulatory.intelligence_update",
  REGULATORY_SANDBOX: "ndsep.regulatory.sandbox_application",

  // Whistleblower
  WHISTLEBLOWER_REPORT: "ndsep.whistleblower.report_filed",
  WHISTLEBLOWER_INVESTIGATED: "ndsep.whistleblower.investigated",

  // AI/ML
  AI_MODEL_DEPLOYED: "ndsep.ai.model_deployed",
  AI_ETHICS_REVIEW: "ndsep.ai.ethics_review",
  AI_GOVERNANCE_SCORE: "ndsep.ai.governance_score",

  // Security
  SECURITY_AUDIT: "ndsep.security.audit_event",
  SECURITY_ANOMALY: "ndsep.security.anomaly_detected",

  // Data Pipeline
  DATA_PIPELINE_TRIGGERED: "ndsep.data.pipeline_triggered",
  DATA_LINEAGE_UPDATED: "ndsep.data.lineage_updated",

  // Workflow
  WORKFLOW_TRANSITION: "ndsep.workflow.transition",
  WORKFLOW_PENALTY_CALCULATED: "ndsep.workflow.penalty_calculated",
  WORKFLOW_SLA_BREACH: "ndsep.workflow.sla_breach",

  // Cross-Agency
  CROSS_AGENCY_SHARE: "ndsep.cross_agency.data_shared",
  CROSS_BORDER_TRANSFER: "ndsep.cross_border.transfer",

  // Telecom
  TELECOM_MONITORING: "ndsep.telecom.monitoring_event",
  TELECOM_QOS_VIOLATION: "ndsep.telecom.qos_violation",

  // Sectors
  SECTOR_BENCHMARK: "ndsep.sector.benchmark_updated",
  SECTOR_ALERT: "ndsep.sector.alert",

  // NOC
  NOC_ALERT_ACKNOWLEDGED: "ndsep.noc.alert_acknowledged",
  NOC_ALERT_RESOLVED: "ndsep.noc.alert_resolved",
  NOC_DEVICE_REGISTERED: "ndsep.noc.device_registered",
  NOC_RUNBOOK_EXECUTED: "ndsep.noc.runbook_executed",

  // NOC Agent
  NOC_AGENT_METRICS_INGESTED: "ndsep.noc_agent.metrics_ingested",
  NOC_AGENT_FALSE_POSITIVE: "ndsep.noc_agent.false_positive",
  NOC_AGENT_DIAGNOSIS: "ndsep.noc_agent.diagnosis",
  NOC_AGENT_LEARNING: "ndsep.noc_agent.learning_reported",
  NOC_AGENT_REMEDIATION: "ndsep.noc_agent.remediation_executed",
  NOC_AGENT_APPROVAL: "ndsep.noc_agent.remediation_approved",

  // Network Intelligence
  NETWORK_CAPTURE_STARTED: "ndsep.network.capture_started",
  NETWORK_CAPTURE_STOPPED: "ndsep.network.capture_stopped",
  NETWORK_ANOMALY_ANALYZED: "ndsep.network.anomaly_analyzed",
  NETWORK_THREAT_ADDED: "ndsep.network.threat_ip_added",

  // Platform Intelligence
  PLATFORM_AI_QUERY: "ndsep.platform.ai_compliance_query",
  PLATFORM_AI_DPIA: "ndsep.platform.ai_dpia_generated",
  PLATFORM_AI_GAP_ANALYSIS: "ndsep.platform.ai_gap_analysis",
  PLATFORM_AI_IMPACT: "ndsep.platform.ai_impact_analysis",
  PLATFORM_AUDIT_APPENDED: "ndsep.platform.audit_appended",
  PLATFORM_TWIN_SIMULATION: "ndsep.platform.twin_simulation",
  PLATFORM_TWIN_MONTE_CARLO: "ndsep.platform.twin_monte_carlo",
  PLATFORM_TWIN_POLICY_CREATED: "ndsep.platform.twin_policy_created",
  PLATFORM_TWIN_SANDBOX: "ndsep.platform.twin_sandbox_created",
  PLATFORM_TWIN_COUNTERFACTUAL: "ndsep.platform.twin_counterfactual",
  PLATFORM_ML_ECONOMIC: "ndsep.platform.ml_economic_impact",
  PLATFORM_ML_NETWORK: "ndsep.platform.ml_network_effects",
  PLATFORM_SOVEREIGN_TRANSLATE: "ndsep.platform.sovereign_translate",
  PLATFORM_SOVEREIGN_FAIRNESS: "ndsep.platform.sovereign_fairness",
  PLATFORM_SOVEREIGN_REDTEAM: "ndsep.platform.sovereign_redteam",
  PLATFORM_PQC_KEM: "ndsep.platform.pqc_kem_keypair",
  PLATFORM_PQC_SIG: "ndsep.platform.pqc_sig_keypair",
  PLATFORM_PQC_SIGN: "ndsep.platform.pqc_sign",
  PLATFORM_PQC_ENCRYPT: "ndsep.platform.pqc_encrypt",
  PLATFORM_TWIN_POLICY_COMPOSE: "ndsep.platform.twin_policy_compose",
  PLATFORM_TWIN_AGENT_SIM: "ndsep.platform.twin_agent_sim",
  PLATFORM_TWIN_SYSTEM_DYNAMICS: "ndsep.platform.twin_system_dynamics",
  PLATFORM_MONTE_CARLO_ENGINE: "ndsep.platform.monte_carlo_engine",
} as const;

// ── Dead Letter Queue ────────────────────────────────────────────────────────

interface DLQEntry {
  id: string;
  event: string;
  payload: Record<string, unknown>;
  target: "dapr" | "fluvio" | "opensearch" | "lakehouse";
  error: string;
  attempts: number;
  firstFailedAt: string;
  lastFailedAt: string;
  nextRetryAt: string;
}

const DLQ: DLQEntry[] = [];
const MAX_DLQ_SIZE = 10_000;
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_BACKOFF_BASE_MS = 5_000;

function addToDLQ(event: string, payload: Record<string, unknown>, target: DLQEntry["target"], error: string): void {
  if (DLQ.length >= MAX_DLQ_SIZE) {
    DLQ.shift(); // Evict oldest
    logger.warn("[DLQ] Queue full — evicted oldest entry");
  }
  const now = new Date().toISOString();
  DLQ.push({
    id: `dlq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    event,
    payload,
    target,
    error,
    attempts: 1,
    firstFailedAt: now,
    lastFailedAt: now,
    nextRetryAt: new Date(Date.now() + RETRY_BACKOFF_BASE_MS).toISOString(),
  });
}

/** Get DLQ stats for observability */
export function getDLQStats(): { size: number; byTarget: Record<string, number>; oldestAge?: number } {
  const byTarget: Record<string, number> = {};
  for (const entry of DLQ) {
    byTarget[entry.target] = (byTarget[entry.target] ?? 0) + 1;
  }
  const oldestAge = DLQ.length > 0 ? Date.now() - new Date(DLQ[0].firstFailedAt).getTime() : undefined;
  return { size: DLQ.length, byTarget, oldestAge };
}

/** Retry DLQ entries with exponential backoff */
export async function processDLQ(): Promise<{ processed: number; succeeded: number; failed: number }> {
  const now = Date.now();
  const ready = DLQ.filter(e => new Date(e.nextRetryAt).getTime() <= now);
  let succeeded = 0;
  let failed = 0;

  for (const entry of ready) {
    try {
      const fn = { dapr: daprPublish, fluvio: fluvioPublish, opensearch: opensearchIndex, lakehouse: lakehouseIngest };
      if (entry.target === "lakehouse") {
        await lakehouseIngest(entry.event.replace(/\./g, "-"), [entry.payload]);
      } else if (entry.target === "opensearch") {
        await opensearchIndex(entry.event.replace(/\./g, "-"), entry.payload);
      } else {
        await fn[entry.target](entry.event, entry.payload);
      }
      const idx = DLQ.indexOf(entry);
      if (idx >= 0) DLQ.splice(idx, 1);
      succeeded++;
    } catch (e: unknown) {
      entry.attempts++;
      entry.lastFailedAt = new Date().toISOString();
      entry.error = e instanceof Error ? e.message : String(e);
      if (entry.attempts >= MAX_RETRY_ATTEMPTS) {
        logger.error({ event: entry.event, target: entry.target, attempts: entry.attempts }, "[DLQ] Max retries exceeded — dropping event");
        const idx = DLQ.indexOf(entry);
        if (idx >= 0) DLQ.splice(idx, 1);
        failed++;
      } else {
        const backoff = RETRY_BACKOFF_BASE_MS * Math.pow(2, entry.attempts - 1);
        entry.nextRetryAt = new Date(Date.now() + backoff).toISOString();
      }
    }
  }

  return { processed: ready.length, succeeded, failed };
}

// Start DLQ processor (runs every 10s)
let dlqInterval: NodeJS.Timeout | null = null;
export function startDLQProcessor(): void {
  if (dlqInterval) return;
  dlqInterval = setInterval(() => {
    processDLQ().catch(e => logger.error({ err: e }, "[DLQ] Processor error"));
  }, 10_000);
  logger.info("[DLQ] Processor started (interval: 10s)");
}
export function stopDLQProcessor(): void {
  if (dlqInterval) { clearInterval(dlqInterval); dlqInterval = null; }
}

// ── Emit to all middleware ───────────────────────────────────────────────────

/** Metrics counters for event emission */
const emissionMetrics = { total: 0, succeeded: 0, dlqed: 0 };
export function getEmissionMetrics() { return { ...emissionMetrics }; }

/**
 * Fire-and-forget event emission to all middleware layers with DLQ fallback.
 * Publishes to Dapr (→ Kafka), Fluvio, OpenSearch, and Lakehouse simultaneously.
 * Failed emissions are queued in DLQ for automatic retry with exponential backoff.
 */
export async function emitMutationEvent(
  event: string,
  data: Record<string, unknown>,
  options?: {
    indexName?: string;
    skipOpenSearch?: boolean;
    skipLakehouse?: boolean;
  }
): Promise<void> {
  emissionMetrics.total++;
  const payload = { ...data, event, timestamp: new Date().toISOString() };
  const indexName = options?.indexName ?? event.replace(/\./g, "-");

  const targets: Array<{ name: DLQEntry["target"]; fn: () => Promise<void> }> = [
    { name: "dapr", fn: () => daprPublish(event, payload) },
    { name: "fluvio", fn: () => fluvioPublish(event, payload) },
  ];

  if (!options?.skipOpenSearch) {
    targets.push({ name: "opensearch", fn: () => opensearchIndex(indexName, payload) });
  }
  if (!options?.skipLakehouse) {
    targets.push({ name: "lakehouse", fn: () => lakehouseIngest(indexName, [payload]) });
  }

  const results = await Promise.allSettled(targets.map(t => t.fn()));

  results.forEach((result, i) => {
    if (result.status === "rejected") {
      const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      addToDLQ(event, payload, targets[i].name, errMsg);
      emissionMetrics.dlqed++;
    } else {
      emissionMetrics.succeeded++;
    }
  });
}

/**
 * Check Permify authorization before a mutation.
 * Returns true only for an explicit Permify allow decision. Upstream failures
 * and malformed responses are denied so protected mutations fail closed.
 */
export async function checkPermission(
  userId: string | number,
  resource: string,
  action: string
): Promise<boolean> {
  try {
    const result = await permifyCheck(resource, String(userId), action, `user:${userId}`);
    return result === true;
  } catch {
    return false;
  }
}

/**
 * tRPC middleware factory for Permify ReBAC enforcement.
 * Checks if the current user has the required relationship/permission
 * on the specified resource before allowing the mutation to proceed. An
 * unavailable authorization service denies the request rather than bypassing it.
 */
export function permifyMiddleware(resource: string, action: string) {
  return async ({ ctx, next }: { ctx: { user?: { id: number; role: string } }; next: () => unknown }) => {
    if (!ctx.user) {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
    }
    const allowed = await checkPermission(ctx.user.id, resource, action);
    if (!allowed) {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Permify: user ${ctx.user.id} denied '${action}' on '${resource}'`,
      });
    }
    return next();
  };
}
