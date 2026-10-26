/**
 * Round-13 scheduled-job activities.
 *
 * Thin wrappers over the canonical job implementations (the same functions
 * the manual tRPC mutations and the cron fallback runRound13Job invoke).
 * No job logic is duplicated here: the activity calls the shared service
 * function and returns its real result — failures propagate so Temporal's
 * retry policy applies instead of a fabricated success.
 */
import { runDueVerifications } from "../../../server/services/hostingVerification";
import { runInfrastructureRiskSweep } from "../../../server/services/infrastructureRiskWatch";
import {
  pollTelegramWatchWorker,
  pollOsirisIntelWorker,
} from "../../../server/services/round13Schedules";

export interface Round13JobInput {
  /** Schedule input discriminator, e.g. "hosting-verification-sweep". */
  type: string;
  /** Cron expression carried through from schedule registration (informational). */
  cronSchedule?: string;
}

export async function hostingVerificationSweep(_input: Round13JobInput) {
  return runDueVerifications();
}

export async function infrastructureRiskSweep(_input: Round13JobInput) {
  return runInfrastructureRiskSweep();
}

export async function telegramWatchPoll(_input: Round13JobInput) {
  return pollTelegramWatchWorker();
}

export async function osirisIntelPoll(_input: Round13JobInput) {
  return pollOsirisIntelWorker();
}
