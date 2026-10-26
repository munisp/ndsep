/**
 * Round-12 scheduled sweeps — shared service functions for the jobs that
 * were previously manual operator buttons only.
 *
 * These functions hold the CANONICAL business logic. The tRPC router
 * mutations (operator overrides) and the durable Temporal schedules
 * (server/services/round12Schedules) both call into this module, so the
 * scheduled path can never drift from the manual path:
 *
 *   runComplianceScanSweep      hourly scan sweep — enqueues scan_runs for
 *                               due enabled targets (mirrors
 *                               workers/python/scan_crawler_worker.py
 *                               schedule_due_targets); failures surface as
 *                               scan_runs status='failed' / scan_findings.
 *   scheduleScanRun             the single-target scheduleScan mutation logic
 *                               (extracted from routers/complianceScanning).
 *   detectSettlementDefaults    settlementWorkflow.detectDefaults logic —
 *                               overdue instalments escalate the settlement
 *                               to 'defaulted', the linked fine flips back
 *                               to 'outstanding', every escalation lands in
 *                               the hash-chained audit ledger.
 *   runFineReconciliationBatch  finePayments.runReconciliationBatch logic —
 *                               matches paid RRRs to fines; unmatched/partial
 *                               rows land in payment_reconciliations (the
 *                               reconciliationQueue exception queue).
 *   runComplaintSurgeSweep      complaintAnalytics.runSurgeDetection logic —
 *                               recompute daily counts, baselines and run
 *                               both detectors; surge exceptions land in the
 *                               surge_alerts queue (deduped by detector).
 *
 * No tRPC types here: these run both inside request handlers and inside
 * Temporal activities. Actor is explicit — "system:temporal-schedule" for
 * scheduled runs so the audit trail distinguishes them from operator runs.
 */
import { logger } from "../logger";
import { getPool } from "../db";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { appendLedger } from "../antiwipe/ledger";
import {
  assertTransition,
  evaluateDefaults,
  DEFAULT_GRACE_DAYS,
  type SettlementStatus,
  type InstalmentRecord,
  type InstalmentStatus,
} from "./settlementLogic";
import {
  recomputeDailyCounts,
  updateBaselines,
  detectSurges,
  surgeConfig,
  type SurgeConfig,
} from "./complaintSurge";

/** Actor recorded on scheduled (non-operator) runs. */
export const SCHEDULED_RUN_ACTOR = "system:temporal-schedule";

// ─── DB helpers (self-contained so activities don't import router modules) ──

async function exec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new Error("Database unavailable");
  const safeParams = params.map((p) =>
    Array.isArray(p) || (p !== null && typeof p === "object" && !(p instanceof Date))
      ? JSON.stringify(p)
      : p
  );
  const result = await pool.query(query, safeParams);
  return autoDecryptRows(query, result.rows ?? []);
}

function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "42P01";
}

/** audit_logs.resource_id / user_id are int4; coerce non-numeric refs to NULL. */
function toIntOrNull(v: string | number | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isInteger(n) && Math.abs(n) < 2147483647 ? n : null;
}

async function logAudit(
  action: string,
  resourceType: string,
  resourceId: string | number | null,
  actor: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await exec(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NOW())`,
      [action, resourceType, toIntOrNull(resourceId), toIntOrNull(actor), JSON.stringify(details)],
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, "[scheduledSweeps] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

// ─── 1. Compliance scan sweep (hourly) ──────────────────────────────────────

/**
 * Hourly sweep: enqueue scan_runs for enabled targets whose scan interval
 * has elapsed and that have no open run. SQL mirrors the python crawler
 * worker's schedule_due_targets() exactly (trigger_type 'cron') — the
 * Temporal schedule is the durable replacement for that in-worker loop.
 */
export async function runComplianceScanSweep(opts: { batch?: number; actor?: string } = {}): Promise<{
  scheduled: number;
  runIds: number[];
}> {
  const batch = Math.max(1, Math.min(500, opts.batch ?? 50));
  const rows = await exec(
    `INSERT INTO scan_runs (target_id, trigger_type, scheduled_at, created_by)
     SELECT t.id, 'cron', now(), $2
       FROM scan_targets t
      WHERE t.enabled = TRUE
        AND (t.last_scanned_at IS NULL
             OR t.last_scanned_at <= now() - (t.scan_interval_hours || ' hours')::interval)
        AND NOT EXISTS (SELECT 1 FROM scan_runs r
                         WHERE r.target_id = t.id
                           AND r.status IN ('scheduled', 'running'))
      LIMIT $1
      RETURNING id`,
    [batch, opts.actor ?? SCHEDULED_RUN_ACTOR],
  );
  const runIds = rows.map((r) => Number(r.id));
  await logAudit("scan_sweep_run", "scan_runs", null, opts.actor ?? SCHEDULED_RUN_ACTOR, {
    scheduled: runIds.length, batch,
  });
  logger.info({ scheduled: runIds.length, batch }, "[scheduledSweeps] compliance scan sweep complete");
  return { scheduled: runIds.length, runIds };
}

/**
 * Single-target scheduling — the extracted complianceScanning.scheduleScan
 * mutation logic (operator override path). Throws Error with a `code`
 * property mirroring the previous TRPC error codes so the router can
 * re-throw the same responses.
 */
export async function scheduleScanRun(params: {
  targetId: number;
  runAt?: string | null;
  createdBy: string;
}): Promise<any> {
  const target = await exec(`SELECT id, enabled FROM scan_targets WHERE id = $1`, [params.targetId]);
  if (!target[0]) {
    throw Object.assign(new Error("Scan target not found"), { code: "NOT_FOUND" });
  }
  if (!target[0].enabled) {
    throw Object.assign(new Error("Target is disabled"), { code: "CONFLICT" });
  }
  const [row] = await exec(
    `INSERT INTO scan_runs (target_id, trigger_type, scheduled_at, created_by)
     VALUES ($1, $2, COALESCE($3::timestamptz, NOW()), $4) RETURNING *`,
    [params.targetId, params.runAt ? "scheduled" : "manual", params.runAt ?? null, params.createdBy],
  );
  await logAudit("scan_scheduled", "scan_runs", row.id, params.createdBy, {
    target_id: params.targetId, scheduled_at: row.scheduled_at,
  });
  return row;
}

// ─── 2. Settlement default detection (daily) ────────────────────────────────

async function settlementTransition(
  settlementId: number,
  from: SettlementStatus,
  to: SettlementStatus,
  extra: Record<string, unknown> = {},
): Promise<void> {
  assertTransition(from, to); // pure guard — throws on illegal transition
  const sets = ["status = $2", "updated_at = now()"];
  const params: unknown[] = [settlementId, to];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i}`);
    params.push(val);
    i += 1;
  }
  // Guarded update: only transition from the expected status (optimistic concurrency).
  const res = await exec(
    `UPDATE settlements SET ${sets.join(", ")} WHERE id = $1 AND status = $${i} RETURNING id`,
    [...params, from],
  );
  if (!res[0]) {
    throw Object.assign(
      new Error(`settlement is no longer '${from}' — refresh and retry`),
      { code: "CONFLICT" },
    );
  }
}

async function settlementAudit(
  action: string,
  payload: Record<string, unknown>,
  actor: string,
): Promise<void> {
  await appendLedger(action, payload, actor).catch((err: unknown) => {
    logger.error({ err, action }, "[settlement] audit-ledger append failed");
  });
  await emitMutationEvent(`settlement.${action}`, payload).catch(() => undefined);
}

export interface DefaultEscalation {
  settlementId: number;
  overdueSeqs: number[];
  reason: string;
}

/**
 * Default detection sweep (extracted from settlementWorkflow.detectDefaults):
 * any open instalment past due + grace period escalates — the settlement
 * defaults and the enforcement case reopens (linked fine flips back to
 * 'outstanding'). Every escalation is recorded in the hash-chained audit
 * ledger (the exception trail operators review); nothing is swallowed.
 */
export async function detectSettlementDefaults(params: {
  settlementId?: number | null;
  graceDays?: number;
  actor: string;
}): Promise<{ checked: number; escalations: DefaultEscalation[] }> {
  const graceDays = params.graceDays ?? DEFAULT_GRACE_DAYS;
  const active = await exec(
    `SELECT id, settlement_ref, case_ref, fine_id, fine_reference FROM settlements
     WHERE status = 'active' AND ($1::bigint IS NULL OR id = $1)`,
    [params.settlementId ?? null],
  );
  const escalations: DefaultEscalation[] = [];
  for (const s of active) {
    const rows = await exec(
      `SELECT seq, due_date, amount, status, amount_paid FROM settlement_instalments WHERE settlement_id = $1`,
      [Number(s.id)],
    );
    const records: InstalmentRecord[] = rows.map((r) => ({
      seq: Number(r.seq), dueDate: String(r.due_date), amount: Number(r.amount),
      status: r.status as InstalmentStatus, amountPaid: Number(r.amount_paid),
    }));
    const verdict = evaluateDefaults("active", records, new Date(), graceDays);
    if (!verdict.shouldDefault) continue;
    await exec(
      `UPDATE settlement_instalments SET status = 'overdue', updated_at = now()
       WHERE settlement_id = $1 AND seq = ANY($2::int[]) AND status IN ('scheduled', 'posted', 'partial')`,
      [Number(s.id), verdict.overdueSeqs],
    );
    await settlementTransition(Number(s.id), "active", "defaulted", {
      default_reason: verdict.escalationReason, defaulted_at: new Date().toISOString(),
    });
    // Case reopens: the settled amount is no longer performing.
    if (s.fine_id != null) {
      await exec(
        `UPDATE enforcement_fines SET status = 'outstanding', updated_at = NOW() WHERE id = $1`,
        [Number(s.fine_id)],
      ).catch((err: unknown) => {
        if (isMissingTable(err)) return;
        throw err;
      });
    }
    await settlementAudit("defaulted", {
      settlementId: Number(s.id), settlementRef: s.settlement_ref, caseRef: s.case_ref,
      overdueSeqs: verdict.overdueSeqs, reason: verdict.escalationReason,
      fineReference: s.fine_reference ?? null, caseReopened: s.fine_id != null, actor: params.actor,
    }, params.actor);
    escalations.push({
      settlementId: Number(s.id),
      overdueSeqs: verdict.overdueSeqs,
      reason: verdict.escalationReason ?? "overdue instalments",
    });
  }
  logger.info({ checked: active.length, escalations: escalations.length }, "[scheduledSweeps] settlement default sweep complete");
  return { checked: active.length, escalations };
}

// ─── 3. Fine payment reconciliation batch (every 6h) ────────────────────────

/**
 * Reconciliation batch (extracted from finePayments.runReconciliationBatch):
 * match paid RRR payments to penalties. Already-reconciled RRRs are skipped.
 * Payments whose penalty no longer exists (or with mismatched amounts) land
 * in payment_reconciliations with match_status 'unmatched'/'partial' — the
 * finePayments.reconciliationQueue exception queue for manual review.
 */
export async function runFineReconciliationBatch(params: {
  batchDate?: string;
  actor: string;
}): Promise<{ batchDate: string; processed: number; matched: number; partial: number; unmatched: number }> {
  const pool = getPool();
  if (!pool) throw new Error("Database unavailable");
  const batchDate = params.batchDate ?? new Date().toISOString().slice(0, 10);
  const paid = await exec(
    `SELECT p.rrr, p.penalty_id, p.amount, p.paid_at
     FROM payment_rrr_codes p
     WHERE p.status = 'paid'
       AND NOT EXISTS (SELECT 1 FROM payment_reconciliations r WHERE r.rrr = p.rrr)`,
  );
  // Perf: batch-load all referenced fines in one query (avoids the N+1
  // pattern), then insert all reconciliation rows in a single multi-row
  // INSERT. Uses the pool directly for ANY($1) because exec JSON-stringifies
  // array params; node-pg natively binds a JS array as a Postgres array.
  const penaltyIds = Array.from(new Set(paid.map((row) => row.penalty_id).filter((id) => id != null)));
  const fineRows = penaltyIds.length
    ? ((await pool.query(`SELECT id, amount FROM enforcement_fines WHERE id = ANY($1)`, [penaltyIds])).rows ?? [])
    : [];
  const finesById = new Map(fineRows.map((f) => [f.id, f]));

  let matched = 0, partial = 0, unmatched = 0;
  const insertValues: unknown[] = [];
  const insertPlaceholders: string[] = [];
  paid.forEach((row, i) => {
    const fine = finesById.get(row.penalty_id);
    let status: "matched" | "partial" | "unmatched";
    let notes: string | null = null;
    if (!fine) {
      status = "unmatched";
      notes = "Penalty record not found for RRR payment";
      unmatched++;
    } else if (Number(row.amount) >= Number(fine.amount)) {
      status = "matched";
      matched++;
    } else {
      status = "partial";
      notes = `Paid ${row.amount} of ${fine.amount}`;
      partial++;
    }
    const base = i * 6;
    insertPlaceholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
    insertValues.push(row.rrr, fine?.id ?? null, row.amount, status, batchDate, notes);
  });
  if (insertPlaceholders.length) {
    await exec(
      `INSERT INTO payment_reconciliations (rrr, penalty_id, matched_amount, match_status, batch_date, notes)
       VALUES ${insertPlaceholders.join(", ")}`,
      insertValues,
    );
  }
  await logAudit("payment.reconciliation_batch", "payment_reconciliation", batchDate, params.actor, { matched, partial, unmatched });
  logger.info({ batchDate, processed: paid.length, matched, partial, unmatched }, "[scheduledSweeps] fine reconciliation batch complete");
  return { batchDate, processed: paid.length, matched, partial, unmatched };
}

// ─── 4. Complaint surge detection sweep (every 15 min) ──────────────────────

export interface SurgeSweepOverrides {
  zscoreThreshold?: number;
  changepointProb?: number;
  baselineDays?: number;
  /** Rebuild the full complaint history, not just the trailing 120 days. */
  fullHistory?: boolean;
}

/**
 * Surge detection sweep (extracted from complaintAnalytics.runSurgeDetection):
 * recompute daily counts, baselines and run both detectors (z-score AND
 * Poisson change-point). Surge exceptions are raised by detectSurges into
 * the surge_alerts queue (deduped — migration 0104); the run itself is
 * recorded in audit_logs.
 */
export async function runComplaintSurgeSweep(
  overrides: SurgeSweepOverrides = {},
  actor: string = SCHEDULED_RUN_ACTOR,
): Promise<{ config: SurgeConfig; counted: unknown; baselines: unknown; checked: number; alerts: unknown[] }> {
  const cfg: SurgeConfig = {
    ...surgeConfig(),
    ...(overrides.zscoreThreshold != null ? { zscoreThreshold: overrides.zscoreThreshold } : {}),
    ...(overrides.changepointProb != null ? { changepointProb: overrides.changepointProb } : {}),
    ...(overrides.baselineDays != null ? { baselineDays: overrides.baselineDays } : {}),
  };
  const counts = await recomputeDailyCounts(undefined, undefined, { fullHistory: overrides.fullHistory ?? false });
  const baselines = await updateBaselines(cfg);
  const detection = await detectSurges(cfg);
  await logAudit("surge_detection_run", "surge_alerts", null, actor, {
    config: cfg, counted: counts, baselines, alertsRaised: detection.alerts.length,
  });
  logger.info({ checked: detection.checked, alerts: detection.alerts.length }, "[scheduledSweeps] complaint surge sweep complete");
  return { config: cfg, counted: counts, baselines, checked: detection.checked, alerts: detection.alerts };
}
