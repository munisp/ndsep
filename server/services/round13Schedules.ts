/**
 * Round-13 schedulers — durable Temporal schedules for the OSIRIS-driven
 * watch/verification sweeps (migrations 0141-0148).
 *
 * Pattern: identical to server/services/round12Schedules.ts. Schedules are
 * registered into Temporal's server-side schedule registry at worker startup
 * (workers/temporal/worker.ts) via registerRound13Schedules(); the workflows
 * (workers/temporal/workflows/round13Jobs.ts) delegate to the canonical
 * service functions — the same functions the manual tRPC mutations call
 * (hostingVerification.runDue / infrastructureRisk ack flows /
 * osirisIntelFeed.triggerPoll), so scheduled and manual paths cannot drift.
 *
 * Schedules registered:
 *   1. round13-hosting-verification-sweep    daily 04:15 — re-verify hosting
 *      declarations never verified or stale (>30d); violations mint
 *      decision_feedback baselines, publish ndsep.sovereignty.verification,
 *      and append to the hash-chained audit_ledger.
 *   2. round13-infrastructure-risk-sweep     every 30min — disaster-proximity
 *      + cable-landing vessel anomaly sweep; new alerts append to
 *      audit_ledger and publish ndsep.sovereignty.infra_risk.
 *   3. round13-telegram-watch-poll           every 15min — HTTP POST to the
 *      telegram breach-watch worker's /run endpoint (X-Worker-Auth shared
 *      secret). FAIL-CLOSED: unreachable/non-OK worker throws so Temporal
 *      retries — never a fabricated success.
 *   4. round13-osiris-intel-poll             every 15min — HTTP POST to the
 *      GDELT/live-news adverse-media worker's /run endpoint (same auth +
 *      fail-closed semantics; mirrors osirisIntelFeed.triggerPoll).
 *
 * Fail-closed: when Temporal is not explicitly configured, registration
 * SKIPs with an explicit warn log per schedule (never a fake run); the
 * worker (workers/temporal/worker.ts) refuses to start in production when
 * registration fails. The job functions are exported and directly callable
 * via runRound13Job for non-Temporal cron deployments.
 */
import { logger } from "../logger";
import { runDueVerifications } from "./hostingVerification";
import { runInfrastructureRiskSweep } from "./infrastructureRiskWatch";

export interface Round13Schedule {
  workflowId: string;
  workflowType: string;
  cronSchedule: string;
  taskQueue: string;
  input: Record<string, unknown>;
}

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "ndsep-main";

const TELEGRAM_WATCH_WORKER_URL = (process.env.TELEGRAM_WATCH_WORKER_URL ?? "http://localhost:8117").replace(/\/$/, "");
const OSIRIS_INTEL_WORKER_URL = (process.env.OSIRIS_INTEL_WORKER_URL ?? "http://localhost:8118").replace(/\/$/, "");
const WORKER_AUTH_TOKEN = process.env.WORKER_AUTH_TOKEN ?? "";

export const ROUND13_SCHEDULES: Round13Schedule[] = [
  {
    workflowId: "round13-hosting-verification-sweep",
    workflowType: "hosting_verification_sweep",
    cronSchedule: "15 4 * * *",
    taskQueue: TASK_QUEUE,
    input: { type: "hosting-verification-sweep" },
  },
  {
    workflowId: "round13-infrastructure-risk-sweep",
    workflowType: "infrastructure_risk_sweep",
    cronSchedule: "*/30 * * * *",
    taskQueue: TASK_QUEUE,
    input: { type: "infrastructure-risk-sweep" },
  },
  {
    workflowId: "round13-telegram-watch-poll",
    workflowType: "telegram_watch_poll",
    cronSchedule: "*/15 * * * *",
    taskQueue: TASK_QUEUE,
    input: { type: "telegram-watch-poll" },
  },
  {
    workflowId: "round13-osiris-intel-poll",
    workflowType: "osiris_intel_poll",
    cronSchedule: "*/15 * * * *",
    taskQueue: TASK_QUEUE,
    input: { type: "osiris-intel-poll" },
  },
];

/**
 * POST a worker's /run endpoint with the shared-secret X-Worker-Auth header
 * (same convention as osirisIntelFeed.triggerPoll). FAIL-CLOSED: network
 * failure or non-OK response throws — the caller (Temporal activity / cron
 * runner) must surface the failure, never report a fake poll.
 */
async function triggerWorkerRun(workerUrl: string, label: string, body: Record<string, unknown> = {}): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (WORKER_AUTH_TOKEN) headers["X-Worker-Auth"] = WORKER_AUTH_TOKEN;
  let res: Response;
  try {
    res = await fetch(`${workerUrl}/run`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000), // a poll cycle can take a while
    });
  } catch (error) {
    throw new Error(`[round13Schedules] ${label} worker unreachable at ${workerUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`[round13Schedules] ${label} worker returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { status: "ok", raw: text.slice(0, 500) };
  }
}

/** Trigger one telegram breach-watch cycle via the worker's HTTP /run. */
export async function pollTelegramWatchWorker(): Promise<unknown> {
  return triggerWorkerRun(TELEGRAM_WATCH_WORKER_URL, "telegram-watch");
}

/** Trigger one GDELT + live-news adverse-media poll via the worker's /run. */
export async function pollOsirisIntelWorker(): Promise<unknown> {
  return triggerWorkerRun(OSIRIS_INTEL_WORKER_URL, "osiris-intel");
}

/** True only when Temporal was explicitly configured (address or Cloud creds). */
export function isTemporalConfigured(): boolean {
  return Boolean(
    process.env.TEMPORAL_ADDRESS ||
    process.env.TEMPORAL_API_KEY ||
    (process.env.TEMPORAL_TLS_CERT && process.env.TEMPORAL_TLS_KEY),
  );
}

/**
 * Register all round-13 schedules as durable Temporal Schedules. Explicit
 * skip (warn log per schedule) when Temporal is unconfigured; per-schedule
 * failures are collected and logged — registration of the remaining
 * schedules continues. The caller (worker.ts) fails closed in production
 * when any registration failed.
 *
 * Idempotent: an existing schedule id is left in place, not duplicated.
 */
export async function registerRound13Schedules(): Promise<{
  registered: string[];
  skipped: string[];
  failed: Array<{ workflowId: string; error: string }>;
}> {
  if (!isTemporalConfigured()) {
    for (const s of ROUND13_SCHEDULES) {
      logger.warn(
        { workflowId: s.workflowId, cronSchedule: s.cronSchedule },
        "[round13Schedules] Temporal not configured (TEMPORAL_ADDRESS/API_KEY/TLS unset) — schedule SKIPPED explicitly. Wire the exported job function to a cron runner instead (see runRound13Job).",
      );
    }
    return { registered: [], skipped: ROUND13_SCHEDULES.map((s) => s.workflowId), failed: [] };
  }
  const { ensureSchedule } = await import("../temporal");
  const registered: string[] = [];
  const failed: Array<{ workflowId: string; error: string }> = [];
  for (const schedule of ROUND13_SCHEDULES) {
    try {
      await ensureSchedule({
        scheduleId: schedule.workflowId,
        cronSchedule: schedule.cronSchedule,
        workflowType: schedule.workflowType,
        taskQueue: schedule.taskQueue,
        input: { ...schedule.input, cronSchedule: schedule.cronSchedule },
      });
      registered.push(schedule.workflowId);
      logger.info({ workflowId: schedule.workflowId, cronSchedule: schedule.cronSchedule }, "[round13Schedules] schedule registered");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ workflowId: schedule.workflowId, err: msg }, "[round13Schedules] schedule registration failed (continuing with remaining schedules)");
      failed.push({ workflowId: schedule.workflowId, error: msg });
    }
  }
  return { registered, skipped: [], failed };
}

/** Map from schedule workflowId to the job function a cron runner should invoke. */
export const ROUND13_JOB_RUNNERS: Record<string, () => Promise<unknown>> = {
  "round13-hosting-verification-sweep": () => runDueVerifications(),
  "round13-infrastructure-risk-sweep": () => runInfrastructureRiskSweep(),
  "round13-telegram-watch-poll": () => pollTelegramWatchWorker(),
  "round13-osiris-intel-poll": () => pollOsirisIntelWorker(),
};

/**
 * Cron fallback entry point for non-Temporal deployments. Example: a crontab
 * line firing every 30 minutes can invoke
 *   node -e 'require("./round13Schedules").runRound13Job("round13-infrastructure-risk-sweep")'
 * Unknown ids throw — a mistyped schedule name must never no-op silently.
 */
export async function runRound13Job(workflowId: string): Promise<unknown> {
  const runner = ROUND13_JOB_RUNNERS[workflowId];
  if (!runner) {
    throw new Error(`[round13Schedules] unknown schedule id '${workflowId}' — expected one of: ${Object.keys(ROUND13_JOB_RUNNERS).join(", ")}`);
  }
  return runner();
}
