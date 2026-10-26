/**
 * Round-12 schedulers — durable Temporal schedules replacing manual operator
 * run-buttons (audit: complianceScanning.scheduleScan,
 * settlementWorkflow.detectDefaults, finePayments.runReconciliationBatch,
 * complaintAnalytics.runSurgeDetection).
 *
 * Pattern: identical to server/services/round9Schedules.ts. Schedules are
 * registered into Temporal's server-side schedule registry at worker startup
 * (workers/temporal/worker.ts) via registerRound12Schedules(); the workflows
 * (workers/temporal/workflows/round12Jobs.ts) delegate to the canonical
 * shared service functions in server/services/scheduledSweeps.ts — the same
 * functions the manual tRPC mutations now call, so scheduled and manual
 * paths cannot drift. The manual mutations remain as operator overrides.
 *
 * Schedules registered:
 *   1. round12-compliance-scan-sweep            hourly :00  — enqueue
 *      scan_runs for due enabled targets (mirrors the python crawler
 *      worker's schedule_due_targets); failures surface as failed scan_runs
 *      and scan_findings (the complianceScanning findings queue).
 *   2. round12-settlement-default-detection     daily 03:05 — overdue
 *      instalment escalation; each default lands in the hash-chained audit
 *      ledger and reopens the linked fine (status 'outstanding').
 *   3. round12-fine-reconciliation-batch        every 6h    — match paid RRRs
 *      to fines; unmatched/partial rows land in payment_reconciliations
 *      (the finePayments.reconciliationQueue exception queue).
 *   4. round12-complaint-surge-sweep            every 15min — recompute
 *      daily counts + baselines and run both surge detectors; exceptions
 *      land in the surge_alerts queue (deduped, migration 0104).
 *
 * Fail-closed: when Temporal is not explicitly configured, registration
 * SKIPs with an explicit warn log per schedule (never a fake run); the
 * worker (workers/temporal/worker.ts) refuses to start in production when
 * registration fails. The job functions are exported and directly callable
 * via runRound12Job for non-Temporal cron deployments.
 */
import { logger } from "../logger";
import {
  runComplianceScanSweep,
  detectSettlementDefaults,
  runFineReconciliationBatch,
  runComplaintSurgeSweep,
  SCHEDULED_RUN_ACTOR,
} from "./scheduledSweeps";
import { runDuplicateMergeSweep } from "./duplicateMerge";
import { runFalseFindingSuppressionSweep } from "./falseFindingSuppressor";
import { executeDueAutonomyActions } from "./autonomyActions";

export interface Round12Schedule {
  workflowId: string;
  workflowType: string;
  cronSchedule: string;
  taskQueue: string;
  input: Record<string, unknown>;
}

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "ndsep-main";

export const ROUND12_SCHEDULES: Round12Schedule[] = [
  {
    workflowId: "round12-compliance-scan-sweep",
    workflowType: "compliance_scan_sweep",
    cronSchedule: "0 * * * *",
    taskQueue: TASK_QUEUE,
    input: { type: "compliance-scan-sweep" },
  },
  {
    workflowId: "round12-settlement-default-detection",
    workflowType: "settlement_default_detection",
    cronSchedule: "5 3 * * *",
    taskQueue: TASK_QUEUE,
    input: { type: "settlement-default-detection" },
  },
  {
    workflowId: "round12-fine-reconciliation-batch",
    workflowType: "fine_reconciliation_batch",
    cronSchedule: "0 */6 * * *",
    taskQueue: TASK_QUEUE,
    input: { type: "fine-reconciliation-batch" },
  },
  {
    workflowId: "round12-complaint-surge-sweep",
    workflowType: "complaint_surge_sweep",
    cronSchedule: "*/15 * * * *",
    taskQueue: TASK_QUEUE,
    input: { type: "complaint-surge-sweep" },
  },
  // ── Round-12 autonomy (wave 9): tier-2 guarded auto-actions ──
  {
    workflowId: "round12-duplicate-merge-sweep",
    workflowType: "duplicate_merge_sweep",
    cronSchedule: "0 */6 * * *",
    taskQueue: TASK_QUEUE,
    input: { type: "duplicate-merge-sweep" },
  },
  {
    workflowId: "round12-false-finding-sweep",
    workflowType: "false_finding_sweep",
    cronSchedule: "0 */6 * * *",
    taskQueue: TASK_QUEUE,
    input: { type: "false-finding-sweep" },
  },
  {
    workflowId: "round12-autonomy-execute-due",
    workflowType: "autonomy_execute_due",
    cronSchedule: "*/15 * * * *",
    taskQueue: TASK_QUEUE,
    input: { type: "autonomy-execute-due" },
  },
];

/** True only when Temporal was explicitly configured (address or Cloud creds). */
export function isTemporalConfigured(): boolean {
  return Boolean(
    process.env.TEMPORAL_ADDRESS ||
    process.env.TEMPORAL_API_KEY ||
    (process.env.TEMPORAL_TLS_CERT && process.env.TEMPORAL_TLS_KEY),
  );
}

/**
 * Register all round-12 schedules as durable Temporal Schedules (server-side
 * cron registry — the schedules survive worker restarts and fire the mapped
 * workflow on cadence). Explicit skip (warn log per schedule) when Temporal
 * is unconfigured; per-schedule failures are collected and logged —
 * registration of the remaining schedules continues. The caller (worker.ts)
 * fails closed in production when any registration failed.
 *
 * Idempotent: an existing schedule id is left in place, not duplicated.
 */
export async function registerRound12Schedules(): Promise<{
  registered: string[];
  skipped: string[];
  failed: Array<{ workflowId: string; error: string }>;
}> {
  if (!isTemporalConfigured()) {
    for (const s of ROUND12_SCHEDULES) {
      logger.warn(
        { workflowId: s.workflowId, cronSchedule: s.cronSchedule },
        "[round12Schedules] Temporal not configured (TEMPORAL_ADDRESS/API_KEY/TLS unset) — schedule SKIPPED explicitly. Wire the exported job function to a cron runner instead (see runRound12Job).",
      );
    }
    return { registered: [], skipped: ROUND12_SCHEDULES.map((s) => s.workflowId), failed: [] };
  }
  const { ensureSchedule } = await import("../temporal");
  const registered: string[] = [];
  const failed: Array<{ workflowId: string; error: string }> = [];
  for (const schedule of ROUND12_SCHEDULES) {
    try {
      await ensureSchedule({
        scheduleId: schedule.workflowId,
        cronSchedule: schedule.cronSchedule,
        workflowType: schedule.workflowType,
        taskQueue: schedule.taskQueue,
        input: { ...schedule.input, cronSchedule: schedule.cronSchedule },
      });
      registered.push(schedule.workflowId);
      logger.info({ workflowId: schedule.workflowId, cronSchedule: schedule.cronSchedule }, "[round12Schedules] schedule registered");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ workflowId: schedule.workflowId, err: msg }, "[round12Schedules] schedule registration failed (continuing with remaining schedules)");
      failed.push({ workflowId: schedule.workflowId, error: msg });
    }
  }
  return { registered, skipped: [], failed };
}

/** Map from schedule workflowId to the job function a cron runner should invoke. */
export const ROUND12_JOB_RUNNERS: Record<string, () => Promise<unknown>> = {
  "round12-compliance-scan-sweep": () => runComplianceScanSweep({ actor: SCHEDULED_RUN_ACTOR }),
  "round12-settlement-default-detection": () => detectSettlementDefaults({ actor: SCHEDULED_RUN_ACTOR }),
  "round12-fine-reconciliation-batch": () => runFineReconciliationBatch({ actor: SCHEDULED_RUN_ACTOR }),
  "round12-complaint-surge-sweep": () => runComplaintSurgeSweep({}, SCHEDULED_RUN_ACTOR),
  "round12-duplicate-merge-sweep": () => runDuplicateMergeSweep({ actor: SCHEDULED_RUN_ACTOR }),
  "round12-false-finding-sweep": () => runFalseFindingSuppressionSweep({ actor: SCHEDULED_RUN_ACTOR }),
  "round12-autonomy-execute-due": () => executeDueAutonomyActions({ actor: SCHEDULED_RUN_ACTOR }),
};

/**
 * Cron fallback entry point for non-Temporal deployments. Example crontab:
 *   0 * * * *  node -e 'require("./round12Schedules").runRound12Job("round12-compliance-scan-sweep")'
 * Unknown ids throw — a mistyped schedule name must never no-op silently.
 */
export async function runRound12Job(workflowId: string): Promise<unknown> {
  const runner = ROUND12_JOB_RUNNERS[workflowId];
  if (!runner) {
    throw new Error(`[round12Schedules] unknown schedule id '${workflowId}' — expected one of: ${Object.keys(ROUND12_JOB_RUNNERS).join(", ")}`);
  }
  return runner();
}
