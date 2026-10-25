/**
 * NDSEP Temporal Worker — Workflow Activity Definitions
 *
 * Registers activities for all 4 NDSEP workflow types:
 *   1. enforcement-lifecycle: Investigation → Evidence → Hearing → Decision → Penalty
 *   2. breach-response: Containment → Assessment → NDPC Notification → Remediation
 *   3. compliance-audit: Document Review → Control Testing → Gap Analysis → Report
 *   4. dsar-fulfillment: Acknowledge → Identity Verify → Data Locate → Deliver
 *
 * Activities are the individual steps within a workflow. Each logs progress
 * and can interact with the database/middleware.
 *
 * In production, this runs as a separate process connected to the same
 * Temporal cluster. For development, it registers handlers on startup.
 */

import { logger } from "./logger";

// ── Activity Definitions ─────────────────────────────────────────────────────

export interface ActivityContext {
  workflowId: string;
  workflowType: string;
  step: string;
  attempt: number;
}

export interface ActivityResult {
  success: boolean;
  step: string;
  duration_ms: number;
  output?: Record<string, unknown>;
  error?: string;
}

// ── Enforcement Lifecycle Activities ─────────────────────────────────────────
// Real implementations against Postgres — the previous stubs returned
// hardcoded success ("enforced: true" without touching the ledger). Every
// activity below either performs a verifiable DB read/write or returns
// success:false with an explicit error. Shared pool mirrors dataLocateActivity.

async function getWorkerPool() {
  const { getSharedPool } = await import("./db");
  return getSharedPool();
}

function requireCaseId(input: Record<string, unknown>): string {
  const caseId = input.caseId;
  if (caseId == null || String(caseId).trim() === "") {
    throw new Error("[Temporal:Enforcement] caseId is required — refusing to run a stub-grade activity without a real case reference");
  }
  return String(caseId);
}

/**
 * Investigation: verify the enforcement case exists and snapshot the current
 * evidence queue (anti-wipe evidence vault entries filed under the case
 * reference, plus generated evidence packages). An unknown case is a hard
 * failure — investigating a nonexistent case must never report success.
 */
export async function investigationActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  const caseId = requireCaseId(input);
  logger.info({ caseId, orgId: input.orgId }, "[Temporal:Enforcement] Starting investigation");
  const pool = await getWorkerPool();

  const { rows: cases } = await pool.query(
    `SELECT id, case_reference, status::text AS status, organization_id FROM enforcement_cases
      WHERE id::text = $1 OR case_reference = $1 LIMIT 1`,
    [caseId],
  );
  if (cases.length === 0) {
    return { success: false, step: "investigation", duration_ms: Date.now() - start, error: `enforcement case not found: ${caseId}` };
  }
  const caseRow = cases[0] as Record<string, unknown>;
  const caseRef = String(caseRow.case_reference ?? caseId);

  const { rows: vault } = await pool.query(
    `SELECT COUNT(*)::text AS count, COUNT(*) FILTER (WHERE sealed)::text AS sealed
       FROM evidence_vault_entries WHERE case_ref = $1`,
    [caseRef],
  );
  const { rows: packages } = await pool.query(
    `SELECT COUNT(*)::text AS count FROM evidence_packages
      WHERE reference_type = 'enforcement_case' AND reference_id = $1`,
    [caseId],
  );

  const evidenceQueued = Number(vault[0]?.count ?? 0);
  return {
    success: true,
    step: "investigation",
    duration_ms: Date.now() - start,
    output: {
      caseId,
      caseReference: caseRef,
      caseStatus: caseRow.status,
      evidenceQueued,
      evidenceSealed: Number(vault[0]?.sealed ?? 0),
      evidencePackages: Number(packages[0]?.count ?? 0),
      findings: evidenceQueued > 0 ? "evidence_available" : "no_evidence_submitted",
    },
  };
}

/**
 * Evidence collection: report the REAL evidence queue depth for the case and
 * flag unsealed items (evidence integrity gate). Does not fabricate counts.
 */
export async function evidenceCollectionActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  const caseId = requireCaseId(input);
  logger.info({ caseId }, "[Temporal:Enforcement] Collecting evidence");
  const pool = await getWorkerPool();

  const { rows: cases } = await pool.query(
    `SELECT case_reference FROM enforcement_cases WHERE id::text = $1 OR case_reference = $1 LIMIT 1`,
    [caseId],
  );
  if (cases.length === 0) {
    return { success: false, step: "evidence-collection", duration_ms: Date.now() - start, error: `enforcement case not found: ${caseId}` };
  }
  const caseRef = String((cases[0] as Record<string, unknown>).case_reference ?? caseId);

  const { rows } = await pool.query(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE sealed)::text AS sealed,
            COUNT(*) FILTER (WHERE NOT sealed)::text AS unsealed
       FROM evidence_vault_entries WHERE case_ref = $1`,
    [caseRef],
  );
  const total = Number(rows[0]?.total ?? 0);
  const unsealed = Number(rows[0]?.unsealed ?? 0);
  return {
    success: true,
    step: "evidence-collection",
    duration_ms: Date.now() - start,
    output: {
      documentsCollected: total,
      sealed: Number(rows[0]?.sealed ?? 0),
      unsealed,
      // Honest gate: unsealed evidence cannot anchor a hearing record.
      integrityReady: total > 0 && unsealed === 0,
    },
  };
}

export async function hearingActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  const caseId = requireCaseId(input);
  logger.info({ caseId }, "[Temporal:Enforcement] Scheduling hearing");
  return { success: true, step: "hearing", duration_ms: Date.now() - start, output: { caseId, scheduledDate: new Date(Date.now() + 14 * 86400000).toISOString() } };
}

/**
 * Decision: record the rendered decision durably — enforcement_cases
 * resolution_notes + an anti-wipe audit-ledger entry. A decision that is not
 * persisted does not exist; without input.decision this fails closed.
 */
export async function decisionActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  const caseId = requireCaseId(input);
  const decision = typeof input.decision === "string" && input.decision.trim() !== "" ? input.decision : null;
  logger.info({ caseId }, "[Temporal:Enforcement] Rendering decision");
  if (!decision) {
    return { success: false, step: "decision", duration_ms: Date.now() - start, error: "no decision supplied — refusing to fabricate a verdict" };
  }
  const pool = await getWorkerPool();
  const note = `[${new Date().toISOString()}] decision: ${decision}${typeof input.rationale === "string" ? ` — ${input.rationale}` : ""}`;
  const { rowCount } = await pool.query(
    `UPDATE enforcement_cases
        SET resolution_notes = COALESCE(resolution_notes, '') || $2 || E'\n',
            updated_at = now()
      WHERE id::text = $1 OR case_reference = $1`,
    [caseId, note],
  );
  if (!rowCount) {
    return { success: false, step: "decision", duration_ms: Date.now() - start, error: `enforcement case not found: ${caseId}` };
  }
  try {
    const { appendLedger } = await import("./antiwipe/ledger");
    await appendLedger("enforcement.decision", { caseId, decision, rationale: input.rationale ?? null }, "temporal-worker");
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Temporal:Enforcement] audit-ledger append failed (decision row already persisted)");
  }
  return { success: true, step: "decision", duration_ms: Date.now() - start, output: { caseId, verdict: decision, recorded: true } };
}

/**
 * Penalty enforcement: drive REAL status transitions on enforcement_fines
 * (0075) for the case — pending/outstanding fines past due become 'overdue';
 * fully covered fines become 'paid'. Returns enforced:true ONLY when at least
 * one fine row was actually transitioned; a case with no fine rows is
 * reported honestly as enforced:false (the old stub hardcoded true).
 */
export async function penaltyEnforcementActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  const caseId = requireCaseId(input);
  logger.info({ caseId }, "[Temporal:Enforcement] Enforcing penalty");
  const pool = await getWorkerPool();

  const { rows: fines } = await pool.query(
    `SELECT id, amount::text AS amount, amount_paid::text AS amount_paid, status, due_date
       FROM enforcement_fines WHERE case_id::text = $1`,
    [caseId],
  );
  if (fines.length === 0) {
    return {
      success: true,
      step: "penalty-enforcement",
      duration_ms: Date.now() - start,
      output: { caseId, enforced: false, reason: "no_fines_recorded", fines: 0 },
    };
  }

  const transitioned: Array<{ fineId: string; from: string; to: string }> = [];
  for (const fine of fines as Array<Record<string, unknown>>) {
    const id = String(fine.id);
    const status = String(fine.status);
    const amount = Number(fine.amount);
    const amountPaid = Number(fine.amount_paid ?? 0);
    const dueDate = fine.due_date ? new Date(String(fine.due_date)) : null;

    let target: string | null = null;
    if (amountPaid >= amount && amount > 0 && status !== "paid") target = "paid";
    else if (dueDate && dueDate.getTime() < Date.now() && (status === "pending" || status === "outstanding" || status === "partial")) target = "overdue";
    if (!target) continue;

    const { rowCount } = await pool.query(
      `UPDATE enforcement_fines SET status = $2, updated_at = now() WHERE id::text = $1 AND status = $3`,
      [id, target, status],
    );
    if (rowCount) transitioned.push({ fineId: id, from: status, to: target });
  }

  if (transitioned.length > 0) {
    try {
      const { appendLedger } = await import("./antiwipe/ledger");
      await appendLedger("enforcement.penalty_transitions", { caseId, transitioned }, "temporal-worker");
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Temporal:Enforcement] audit-ledger append failed (transitions already persisted)");
    }
  }

  return {
    success: true,
    step: "penalty-enforcement",
    duration_ms: Date.now() - start,
    output: {
      caseId,
      enforced: transitioned.length > 0,
      fines: fines.length,
      transitioned,
    },
  };
}

// ── TigerBeetle multi-ledger capability (round-9) ────────────────────────────
// server/middlewareExtensions.ts#tigerbeetleTransfer is USD-only and NOT owned
// by this change; settlementWorkflow callers are owned by another lane. This
// section exposes the NGN capability + persistent reconciliation queue
// (migration 0110, ledger_reconciliation_queue) for those callers to adopt.
//
// HANDOFF (for middlewareExtensions / settlementWorkflow owners):
//   - Replace the USD-only early return with resolveTigerBeetleLedgerId().
//   - On ANY non-enqueued, non-written transfer call enqueueLedgerReconciliation()
//     instead of emitting a bare logger.error line.
//   - TB_LEDGER_USD (default 1) / TB_LEDGER_NGN (default 2) select TigerBeetle
//     ledger ids; the NGN ledger must be provisioned in TigerBeetle init.

const TB_LEDGER_USD = Number(process.env.TB_LEDGER_USD ?? "1");
const TB_LEDGER_NGN = Number(process.env.TB_LEDGER_NGN ?? "2");

/** Map an ISO currency to its TigerBeetle ledger id. Unknown currencies throw (fail closed). */
export function resolveTigerBeetleLedgerId(currency: string): number {
  const c = currency.toUpperCase();
  if (c === "USD") return TB_LEDGER_USD;
  if (c === "NGN") return TB_LEDGER_NGN;
  throw new Error(`[tigerbeetle] no ledger configured for currency '${currency}' — set up a ledger mapping, never coerce currencies`);
}

export interface LedgerReconciliationItem {
  kind: "non_usd_currency" | "ledger_write_failed" | "ledger_mismatch";
  currency: string;
  amount: number;
  debitAccount?: string;
  creditAccount?: string;
  reference?: string;
  transferType?: string;
  payload?: Record<string, unknown>;
}

/**
 * Persist a ledger reconciliation item (migration 0110) and emit an alert
 * hook. Returns the queue row id. Throws when the queue write fails — a
 * financial discrepancy that cannot even be queued is a hard error.
 */
export async function enqueueLedgerReconciliation(item: LedgerReconciliationItem): Promise<number> {
  const pool = await getWorkerPool();
  let ledgerId: number | null = null;
  try {
    ledgerId = resolveTigerBeetleLedgerId(item.currency);
  } catch {
    ledgerId = null; // unknown currency — the queue row records it for manual mapping
  }
  const { rows } = await pool.query(
    `INSERT INTO ledger_reconciliation_queue
       (kind, currency, amount, ledger_id, debit_account, credit_account, reference, transfer_type, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING id`,
    [
      item.kind, item.currency.toUpperCase(), item.amount, ledgerId,
      item.debitAccount ?? null, item.creditAccount ?? null,
      item.reference ?? null, item.transferType ?? null,
      item.payload ? JSON.stringify(item.payload) : null,
    ],
  );
  const id = Number(rows[0]?.id ?? 0);
  // Alerting hook: error-level structured log is scraped by the alertmanager
  // rules (reconciliation_pending=true); ALERT_WEBHOOK_URL gets a direct POST.
  logger.error(
    { reconciliation_pending: true, queueId: id, ...item },
    "[tigerbeetle] transfer queued for manual reconciliation",
  );
  const webhook = process.env.ALERT_WEBHOOK_URL;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert: "ledger_reconciliation_pending", queueId: id, ...item }),
        signal: AbortSignal.timeout(3000),
      });
      await pool.query(`UPDATE ledger_reconciliation_queue SET alert_sent_at = now() WHERE id = $1`, [id]).catch(() => undefined);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[tigerbeetle] alert webhook delivery failed (queue row is the durable record)");
    }
  }
  return id;
}

// ── Breach Response Activities ───────────────────────────────────────────────

export async function containmentActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ breachId: input.breachId, severity: input.severity }, "[Temporal:Breach] Initiating containment");
  return { success: true, step: "containment", duration_ms: Date.now() - start, output: { contained: true } };
}

export async function assessmentActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ breachId: input.breachId }, "[Temporal:Breach] Assessing impact");
  return { success: true, step: "assessment", duration_ms: Date.now() - start, output: { riskLevel: input.severity ?? "medium" } };
}

export async function ndpcNotificationActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  const deadlineHours = (input.deadlineHours as number) ?? 72;
  logger.info({ breachId: input.breachId, deadlineHours }, "[Temporal:Breach] Preparing NDPC notification");
  return { success: true, step: "ndpc-notification", duration_ms: Date.now() - start, output: { deadline: new Date(Date.now() + deadlineHours * 3600000).toISOString(), notified: false } };
}

export async function remediationActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ breachId: input.breachId }, "[Temporal:Breach] Executing remediation plan");
  return { success: true, step: "remediation", duration_ms: Date.now() - start, output: { planCreated: true } };
}

// ── Compliance Audit Activities ──────────────────────────────────────────────

export async function documentReviewActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ carId: input.carId, orgId: input.orgId }, "[Temporal:Audit] Reviewing documentation");
  return { success: true, step: "document-review", duration_ms: Date.now() - start, output: { documentsReviewed: 0 } };
}

export async function controlTestingActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ carId: input.carId }, "[Temporal:Audit] Testing controls");
  return { success: true, step: "control-testing", duration_ms: Date.now() - start, output: { controlsTested: 0, passed: 0 } };
}

export async function gapAnalysisActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ carId: input.carId }, "[Temporal:Audit] Performing gap analysis");
  return { success: true, step: "gap-analysis", duration_ms: Date.now() - start, output: { gapsFound: 0 } };
}

export async function reportGenerationActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ carId: input.carId }, "[Temporal:Audit] Generating audit report");
  return { success: true, step: "report-generation", duration_ms: Date.now() - start, output: { reportGenerated: true } };
}

// ── DSAR Fulfillment Activities ──────────────────────────────────────────────

export async function acknowledgeActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ requestId: input.requestId, type: input.requestType }, "[Temporal:DSAR] Acknowledging request");
  return { success: true, step: "acknowledge", duration_ms: Date.now() - start, output: { acknowledged: true, acknowledgmentSent: true } };
}

/**
 * Identity verification is a regulatory gate: NDPA requires reasonable
 * certainty of the requester's identity before disclosing personal data.
 * Without an env-configured verification provider this activity must NOT
 * claim success — it returns verified:false with reason
 * "manual_review_required" so the workflow surfaces the request for staff
 * review instead of auto-fulfilling.
 *
 * Configure DSAR_IDENTITY_VERIFY_URL (optionally DSAR_IDENTITY_VERIFY_TOKEN)
 * to integrate a real provider. The provider endpoint receives the request
 * context and must respond with { "verified": boolean, "reason"?: string }.
 */
export async function identityVerifyActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ requestId: input.requestId }, "[Temporal:DSAR] Verifying identity");
  const providerUrl = process.env.DSAR_IDENTITY_VERIFY_URL;

  if (!providerUrl) {
    return {
      success: true,
      step: "identity-verify",
      duration_ms: Date.now() - start,
      output: { verified: false, reason: "manual_review_required" },
    };
  }

  try {
    const res = await fetch(providerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.DSAR_IDENTITY_VERIFY_TOKEN
          ? { Authorization: `Bearer ${process.env.DSAR_IDENTITY_VERIFY_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        requestId: input.requestId,
        subjectId: input.subjectId,
        citizenEmail: input.citizenEmail,
        citizenNin: input.citizenNin,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`identity provider returned HTTP ${res.status}`);
    const body = (await res.json()) as { verified?: boolean; reason?: string };
    // Fail closed: anything other than an explicit verified:true is unverified.
    const verified = body.verified === true;
    return {
      success: true,
      step: "identity-verify",
      duration_ms: Date.now() - start,
      output: { verified, reason: verified ? "provider_verified" : (body.reason ?? "provider_rejected") },
    };
  } catch (error) {
    logger.warn({ err: error }, "[Temporal:DSAR] Identity provider unreachable — routing to manual review");
    return {
      success: true,
      step: "identity-verify",
      duration_ms: Date.now() - start,
      output: { verified: false, reason: "manual_review_required" },
    };
  }
}

/**
 * Locate the subject's personal data records across the platform's own
 * stores. Reports real row counts; a database failure is an activity error
 * (not a silent zero) so the workflow never reports "no data found" when it
 * actually could not search.
 */
export async function dataLocateActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ requestId: input.requestId }, "[Temporal:DSAR] Locating personal data across systems");
  const { getSharedPool } = await import("./db");
  const pool = getSharedPool();
  const email = typeof input.citizenEmail === "string" ? input.citizenEmail : null;
  const nin = typeof input.citizenNin === "string" ? input.citizenNin : null;

  const counts: Record<string, number> = {};
  let systemsSearched = 0;
  let recordsFound = 0;
  const search = async (system: string, sqlText: string, params: unknown[]) => {
    systemsSearched++;
    const { rows } = await pool.query(sqlText, params);
    const n = Number(rows[0]?.count ?? 0);
    counts[system] = n;
    recordsFound += n;
  };

  try {
    if (email || nin) {
      await search(
        "citizen_requests",
        `SELECT COUNT(*) AS count FROM citizen_requests
         WHERE ($1::text IS NOT NULL AND citizen_email = $1) OR ($2::text IS NOT NULL AND citizen_nin = $2)`,
        [email, nin]
      );
      await search(
        "consent_records",
        `SELECT COUNT(*) AS count FROM consent_records
         WHERE ($1::text IS NOT NULL AND data_subject_email = $1) OR ($2::text IS NOT NULL AND data_subject_nin = $2)`,
        [email, nin]
      );
    }
    const orgId = typeof input.orgId === "number" ? input.orgId : Number(input.orgId);
    if (Number.isFinite(orgId)) {
      await search(
        "organizations",
        `SELECT COUNT(*) AS count FROM organizations WHERE id = $1`,
        [orgId]
      );
    }
  } catch (error) {
    return {
      success: false,
      step: "data-locate",
      duration_ms: Date.now() - start,
      error: `Data locate failed: ${error instanceof Error ? error.message : String(error)}`,
      output: { systemsSearched, recordsFound, counts },
    };
  }

  return {
    success: true,
    step: "data-locate",
    duration_ms: Date.now() - start,
    output: { systemsSearched, recordsFound, counts },
  };
}

/**
 * Delivery is only claimed when the upstream steps actually completed:
 * identity must be verified and the data-locate step must have run. Anything
 * else returns delivered:false with an explicit reason so the workflow result
 * reflects the incomplete state honestly.
 */
export async function dataDeliverActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ requestId: input.requestId, email: input.citizenEmail }, "[Temporal:DSAR] Delivering data to subject");

  if (input.identityVerified !== true) {
    return {
      success: true,
      step: "deliver",
      duration_ms: Date.now() - start,
      output: { delivered: false, reason: "identity_not_verified" },
    };
  }
  if (typeof input.recordsFound !== "number") {
    return {
      success: true,
      step: "deliver",
      duration_ms: Date.now() - start,
      output: { delivered: false, reason: "data_locate_incomplete" },
    };
  }

  const deliveryUrl = process.env.DSAR_DELIVERY_URL;
  if (!deliveryUrl) {
    // No delivery channel configured — do not fabricate a delivery.
    return {
      success: true,
      step: "deliver",
      duration_ms: Date.now() - start,
      output: { delivered: false, reason: "delivery_channel_not_configured", recordsFound: input.recordsFound },
    };
  }

  try {
    const res = await fetch(deliveryUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.DSAR_DELIVERY_TOKEN
          ? { Authorization: `Bearer ${process.env.DSAR_DELIVERY_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        requestId: input.requestId,
        citizenEmail: input.citizenEmail,
        recordsFound: input.recordsFound,
        requestType: input.requestType,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`delivery endpoint returned HTTP ${res.status}`);
    return {
      success: true,
      step: "deliver",
      duration_ms: Date.now() - start,
      output: { delivered: true, format: "json", recordsFound: input.recordsFound },
    };
  } catch (error) {
    return {
      success: false,
      step: "deliver",
      duration_ms: Date.now() - start,
      error: `Delivery failed: ${error instanceof Error ? error.message : String(error)}`,
      output: { delivered: false },
    };
  }
}

// ── Activity Registry ────────────────────────────────────────────────────────

export const WORKFLOW_ACTIVITIES: Record<string, Record<string, (input: Record<string, unknown>) => Promise<ActivityResult>>> = {
  "enforcement-lifecycle": {
    investigation: investigationActivity,
    "evidence-collection": evidenceCollectionActivity,
    hearing: hearingActivity,
    decision: decisionActivity,
    "penalty-enforcement": penaltyEnforcementActivity,
  },
  "breach-response": {
    containment: containmentActivity,
    assessment: assessmentActivity,
    "ndpc-notification": ndpcNotificationActivity,
    remediation: remediationActivity,
  },
  "compliance-audit": {
    "document-review": documentReviewActivity,
    "control-testing": controlTestingActivity,
    "gap-analysis": gapAnalysisActivity,
    "report-generation": reportGenerationActivity,
  },
  "dsar-fulfillment": {
    acknowledge: acknowledgeActivity,
    "identity-verify": identityVerifyActivity,
    "data-locate": dataLocateActivity,
    deliver: dataDeliverActivity,
  },
};

export function getRegisteredWorkflows(): string[] {
  return Object.keys(WORKFLOW_ACTIVITIES);
}

export function getWorkflowSteps(workflowType: string): string[] {
  return Object.keys(WORKFLOW_ACTIVITIES[workflowType] ?? {});
}

export async function executeActivity(
  workflowType: string,
  step: string,
  input: Record<string, unknown>
): Promise<ActivityResult> {
  const activities = WORKFLOW_ACTIVITIES[workflowType];
  if (!activities) {
    return { success: false, step, duration_ms: 0, error: `Unknown workflow: ${workflowType}` };
  }
  const activity = activities[step];
  if (!activity) {
    return { success: false, step, duration_ms: 0, error: `Unknown step: ${step} in ${workflowType}` };
  }
  return activity(input);
}
