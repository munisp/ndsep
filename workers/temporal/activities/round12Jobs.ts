/**
 * Round-12 scheduled-job activities.
 *
 * Thin wrappers over the canonical job implementations exported from
 * server/services/scheduledSweeps (the same functions the manual tRPC
 * mutations and the cron fallback runRound12Job invoke). No job logic is
 * duplicated here: the activity calls the shared service function and
 * returns its real result — failures propagate so Temporal's retry policy
 * applies instead of a fabricated success.
 */
import {
  runComplianceScanSweep,
  detectSettlementDefaults,
  runFineReconciliationBatch,
  runComplaintSurgeSweep,
  SCHEDULED_RUN_ACTOR,
} from "../../../server/services/scheduledSweeps";
import { runDuplicateMergeSweep } from "../../../server/services/duplicateMerge";
import { runFalseFindingSuppressionSweep } from "../../../server/services/falseFindingSuppressor";
import { executeDueAutonomyActions } from "../../../server/services/autonomyActions";

export interface Round12JobInput {
  /** Schedule input discriminator, e.g. "compliance-scan-sweep". */
  type: string;
  /** Cron expression carried through from schedule registration (informational). */
  cronSchedule?: string;
}

export async function complianceScanSweep(_input: Round12JobInput) {
  return runComplianceScanSweep({ actor: SCHEDULED_RUN_ACTOR });
}

export async function settlementDefaultDetection(_input: Round12JobInput) {
  return detectSettlementDefaults({ actor: SCHEDULED_RUN_ACTOR });
}

export async function fineReconciliationBatch(_input: Round12JobInput) {
  return runFineReconciliationBatch({ actor: SCHEDULED_RUN_ACTOR });
}

export async function complaintSurgeSweep(_input: Round12JobInput) {
  return runComplaintSurgeSweep({}, SCHEDULED_RUN_ACTOR);
}

export async function duplicateMergeSweep(_input: Round12JobInput) {
  return runDuplicateMergeSweep({ actor: SCHEDULED_RUN_ACTOR });
}

export async function falseFindingSweep(_input: Round12JobInput) {
  return runFalseFindingSuppressionSweep({ actor: SCHEDULED_RUN_ACTOR });
}

export async function autonomyExecuteDue(_input: Round12JobInput) {
  return executeDueAutonomyActions({ actor: SCHEDULED_RUN_ACTOR });
}
