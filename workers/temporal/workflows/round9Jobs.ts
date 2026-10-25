/**
 * Round-9 scheduled-job workflows (task queue: ndsep-main).
 *
 * Thin durable wrappers around the round-9 scheduled jobs. The exported
 * workflow function names MUST match the workflowType values registered in
 * server/services/round9Schedules (ROUND9_SCHEDULES) — Temporal dispatches
 * scheduled actions by that name:
 *
 *   complaint_surge_detection    → round9-complaint-surge-daily        (daily 02:10)
 *   minors_consent_refresh       → round9-minors-consent-refresh-daily (daily 02:40)
 *   consent_flag_overdue         → round9-consent-flag-overdue-hourly  (hourly :15)
 *   whistleblower_token_expiry   → round9-whistleblower-token-expiry   (daily 03:20)
 *   foia_overdue_sweep           → round9-foia-overdue-sweep           (daily 07:30)
 *
 * Each workflow delegates to a single activity that runs the canonical
 * ROUND9_JOB_RUNNERS logic (server/services/round9Schedules) and returns its
 * real result object.
 */
import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/round9Jobs";

export type { Round9JobInput } from "../activities/round9Jobs";
import type { Round9JobInput } from "../activities/round9Jobs";

const acts = proxyActivities<typeof activities>({
  startToCloseTimeout: "15 minutes",
  retry: { maximumAttempts: 3 },
});

export const ROUND9_TASK_QUEUE = "ndsep-main";

export async function complaint_surge_detection(input: Round9JobInput) {
  return acts.complaintSurgeDaily(input);
}

export async function minors_consent_refresh(input: Round9JobInput) {
  return acts.minorsConsentRefreshDaily(input);
}

export async function consent_flag_overdue(input: Round9JobInput) {
  return acts.consentFlagOverdueHourly(input);
}

export async function whistleblower_token_expiry(input: Round9JobInput) {
  return acts.whistleblowerTokenExpiry(input);
}

export async function foia_overdue_sweep(input: Round9JobInput) {
  return acts.foiaOverdueSweep(input);
}
