/**
 * Round-13 scheduled-job workflows (task queue: ndsep-main).
 *
 * Thin durable wrappers around the round-13 scheduled jobs. The exported
 * workflow function names MUST match the workflowType values registered in
 * server/services/round13Schedules (ROUND13_SCHEDULES) — Temporal dispatches
 * scheduled actions by that name:
 *
 *   hosting_verification_sweep → round13-hosting-verification-sweep  (daily 04:15)
 *   infrastructure_risk_sweep  → round13-infrastructure-risk-sweep   (every 30 min)
 *   telegram_watch_poll        → round13-telegram-watch-poll         (every 15 min)
 *   osiris_intel_poll          → round13-osiris-intel-poll           (every 15 min)
 *
 * Each workflow delegates to a single activity that runs the canonical
 * service function (or the fail-closed HTTP worker trigger) and returns its
 * real result object.
 */
import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/round13Jobs";

export type { Round13JobInput } from "../activities/round13Jobs";
import type { Round13JobInput } from "../activities/round13Jobs";

const acts = proxyActivities<typeof activities>({
  startToCloseTimeout: "15 minutes",
  retry: { maximumAttempts: 3 },
});

export async function hosting_verification_sweep(input: Round13JobInput) {
  return acts.hostingVerificationSweep(input);
}

export async function infrastructure_risk_sweep(input: Round13JobInput) {
  return acts.infrastructureRiskSweep(input);
}

export async function telegram_watch_poll(input: Round13JobInput) {
  return acts.telegramWatchPoll(input);
}

export async function osiris_intel_poll(input: Round13JobInput) {
  return acts.osirisIntelPoll(input);
}
