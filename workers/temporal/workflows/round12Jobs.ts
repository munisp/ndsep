/**
 * Round-12 scheduled-job workflows (task queue: ndsep-main).
 *
 * Thin durable wrappers around the round-12 scheduled jobs. The exported
 * workflow function names MUST match the workflowType values registered in
 * server/services/round12Schedules (ROUND12_SCHEDULES) — Temporal dispatches
 * scheduled actions by that name:
 *
 *   compliance_scan_sweep        → round12-compliance-scan-sweep            (hourly :00)
 *   settlement_default_detection → round12-settlement-default-detection     (daily 03:05)
 *   fine_reconciliation_batch    → round12-fine-reconciliation-batch        (every 6h)
 *   complaint_surge_sweep        → round12-complaint-surge-sweep            (every 15 min)
 *
 * Each workflow delegates to a single activity that runs the canonical
 * shared service function (server/services/scheduledSweeps — the same code
 * the manual operator mutations call) and returns its real result object.
 */
import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/round12Jobs";

export type { Round12JobInput } from "../activities/round12Jobs";
import type { Round12JobInput } from "../activities/round12Jobs";

const acts = proxyActivities<typeof activities>({
  startToCloseTimeout: "15 minutes",
  retry: { maximumAttempts: 3 },
});

export const ROUND12_TASK_QUEUE = "ndsep-main";

export async function compliance_scan_sweep(input: Round12JobInput) {
  return acts.complianceScanSweep(input);
}

export async function settlement_default_detection(input: Round12JobInput) {
  return acts.settlementDefaultDetection(input);
}

export async function fine_reconciliation_batch(input: Round12JobInput) {
  return acts.fineReconciliationBatch(input);
}

export async function complaint_surge_sweep(input: Round12JobInput) {
  return acts.complaintSurgeSweep(input);
}

export async function duplicate_merge_sweep(input: Round12JobInput) {
  return acts.duplicateMergeSweep(input);
}

export async function false_finding_sweep(input: Round12JobInput) {
  return acts.falseFindingSweep(input);
}

export async function autonomy_execute_due(input: Round12JobInput) {
  return acts.autonomyExecuteDue(input);
}
