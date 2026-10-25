/**
 * Round-9 scheduled job activities.
 *
 * Thin wrappers over the canonical job implementations exported from
 * server/services/round9Schedules (the same functions the cron fallback
 * runRound9Job invokes). No job logic is duplicated here: the activity calls
 * the runner and returns its real result — failures propagate so Temporal's
 * retry policy applies instead of a fabricated success.
 */
import {
  runComplaintSurgeDaily,
  runMinorsConsentRefreshDaily,
  runConsentFlagOverdueHourly,
  runWhistleblowerTokenExpiry,
  runFoiaOverdueSweep,
} from "../../../server/services/round9Schedules";

export interface Round9JobInput {
  /** Schedule input discriminator, e.g. "complaint-surge-daily". */
  type: string;
  /** Cron expression carried through from schedule registration (informational). */
  cronSchedule?: string;
}

export async function complaintSurgeDaily(_input: Round9JobInput) {
  return runComplaintSurgeDaily();
}

export async function minorsConsentRefreshDaily(_input: Round9JobInput) {
  return runMinorsConsentRefreshDaily();
}

export async function consentFlagOverdueHourly(_input: Round9JobInput) {
  return runConsentFlagOverdueHourly();
}

export async function whistleblowerTokenExpiry(_input: Round9JobInput) {
  return runWhistleblowerTokenExpiry();
}

export async function foiaOverdueSweep(_input: Round9JobInput) {
  return runFoiaOverdueSweep();
}
