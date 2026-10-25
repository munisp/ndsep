/**
 * Round-9 schedulers — Temporal/cron registration + the job implementations.
 *
 * Schedules registered:
 *   1. complaint-surge-daily        daily 02:10 — recompute daily counts,
 *                                   baselines, run both surge detectors
 *                                   (server/services/complaintSurge).
 *   2. minors-consent-refresh-daily daily 02:40 — generate majority
 *                                   re-consent tasks, mark due/blocked, and
 *                                   run the expired-status sweep.
 *   3. consent-flag-overdue-hourly  hourly :15 — flag notified-but-unacked
 *                                   consent propagation records past SLA.
 *   4. whistleblower-token-expiry   daily 03:20 — revoke channel tokens past
 *                                   their expiry (defence-in-depth; the token
 *                                   resolver already enforces expires_at).
 *   5. foia-overdue-sweep           daily 07:30 — record an 'overdue'
 *                                   foia_events row for requests past their
 *                                   statutory deadline (idempotent).
 *
 * Graceful degradation: when Temporal is not configured (no TEMPORAL_ADDRESS
 * explicitly set and no Cloud credentials) registration SKIPS with an
 * explicit warn log per schedule — never a silent no-op. The job functions
 * are exported and directly callable, so a non-Temporal deployment can wire
 * them to any cron runner.
 */
import { logger } from "../logger";
import { getPool } from "../db";
import { recomputeDailyCounts, updateBaselines, detectSurges, surgeConfig } from "./complaintSurge";

export interface Round9Schedule {
  workflowId: string;
  workflowType: string;
  cronSchedule: string;
  taskQueue: string;
  input: Record<string, unknown>;
}

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "ndsep-main";

export const ROUND9_SCHEDULES: Round9Schedule[] = [
  {
    workflowId: "round9-complaint-surge-daily",
    workflowType: "complaint_surge_detection",
    cronSchedule: "10 2 * * *",
    taskQueue: TASK_QUEUE,
    input: { type: "complaint-surge-daily" },
  },
  {
    workflowId: "round9-minors-consent-refresh-daily",
    workflowType: "minors_consent_refresh",
    cronSchedule: "40 2 * * *",
    taskQueue: TASK_QUEUE,
    input: { type: "minors-consent-refresh-daily" },
  },
  {
    workflowId: "round9-consent-flag-overdue-hourly",
    workflowType: "consent_flag_overdue",
    cronSchedule: "15 * * * *",
    taskQueue: TASK_QUEUE,
    input: { type: "consent-flag-overdue-hourly" },
  },
  {
    workflowId: "round9-whistleblower-token-expiry",
    workflowType: "whistleblower_token_expiry",
    cronSchedule: "20 3 * * *",
    taskQueue: TASK_QUEUE,
    input: { type: "whistleblower-token-expiry" },
  },
  {
    workflowId: "round9-foia-overdue-sweep",
    workflowType: "foia_overdue_sweep",
    cronSchedule: "30 7 * * *",
    taskQueue: TASK_QUEUE,
    input: { type: "foia-overdue-sweep" },
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
 * Register all round-9 schedules. Explicit skip (warn log per schedule) when
 * Temporal is unconfigured; per-schedule failures are collected and logged —
 * registration of the remaining schedules continues.
 */
export async function registerRound9Schedules(): Promise<{
  registered: string[];
  skipped: string[];
  failed: Array<{ workflowId: string; error: string }>;
}> {
  if (!isTemporalConfigured()) {
    for (const s of ROUND9_SCHEDULES) {
      logger.warn(
        { workflowId: s.workflowId, cronSchedule: s.cronSchedule },
        "[round9Schedules] Temporal not configured (TEMPORAL_ADDRESS/API_KEY/TLS unset) — schedule SKIPPED explicitly. Wire the exported job function to a cron runner instead.",
      );
    }
    return { registered: [], skipped: ROUND9_SCHEDULES.map((s) => s.workflowId), failed: [] };
  }
  const { startWorkflow } = await import("../temporal");
  const registered: string[] = [];
  const failed: Array<{ workflowId: string; error: string }> = [];
  for (const schedule of ROUND9_SCHEDULES) {
    try {
      await startWorkflow(schedule.workflowType, {
        workflowId: schedule.workflowId,
        taskQueue: schedule.taskQueue,
        input: { ...schedule.input, cronSchedule: schedule.cronSchedule },
      });
      registered.push(schedule.workflowId);
      logger.info({ workflowId: schedule.workflowId, cronSchedule: schedule.cronSchedule }, "[round9Schedules] schedule registered");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ workflowId: schedule.workflowId, err: msg }, "[round9Schedules] schedule registration failed (continuing with remaining schedules)");
      failed.push({ workflowId: schedule.workflowId, error: msg });
    }
  }
  return { registered, skipped: [], failed };
}

// ─── Job implementations (invoked by the Temporal workflows or a cron runner) ─

async function q(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new Error("Database unavailable");
  const result = await pool.query(query, params);
  return result.rows ?? [];
}

/** Daily: complaint surge detection pipeline (counts → baselines → detectors). */
export async function runComplaintSurgeDaily(): Promise<{ counted: unknown; baselines: unknown; checked: number; alerts: number }> {
  const cfg = surgeConfig();
  const counted = await recomputeDailyCounts();
  const baselines = await updateBaselines(cfg);
  const detection = await detectSurges(cfg);
  logger.info({ counted, baselines, checked: detection.checked, alerts: detection.alerts.length }, "[round9Schedules] complaint surge detection run complete");
  return { counted, baselines, checked: detection.checked, alerts: detection.alerts.length };
}

/** Daily: minors consent-refresh generation + due/blocked transitions + expiry sweep. */
export async function runMinorsConsentRefreshDaily(lookaheadDays = 90): Promise<{ created: number; markedDue: number; blocked: number; expiredTasks: number; expiredAssurances: number }> {
  const created = await q(
    `INSERT INTO consent_refresh_tasks
       (age_assurance_id, organization_id, data_subject_ref, data_subject_ref_hmac, majority_date, due_at)
     SELECT id, organization_id, data_subject_ref, data_subject_ref_hmac,
            majority_date, majority_date::timestamptz
     FROM age_assurance_records
     WHERE status = 'verified'
       AND majority_date <= CURRENT_DATE + ($1 || ' days')::interval
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [String(lookaheadDays)],
  );
  const due = await q(
    `UPDATE consent_refresh_tasks SET status = 'due', updated_at = NOW()
     WHERE status = 'scheduled' AND majority_date <= CURRENT_DATE RETURNING id`,
  );
  const blocked = await q(
    `UPDATE consent_refresh_tasks SET status = 'blocked', processing_blocked = true, updated_at = NOW()
     WHERE status = 'due' AND majority_date < CURRENT_DATE - INTERVAL '30 days' RETURNING id`,
  );
  const expiredTasks = await q(
    `UPDATE consent_refresh_tasks SET status = 'expired', updated_at = NOW()
     WHERE status = 'blocked' AND updated_at < NOW() - INTERVAL '180 days' RETURNING id`,
  );
  const expiredAssurances = await q(
    `UPDATE age_assurance_records SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending' AND created_at < NOW() - INTERVAL '90 days' RETURNING id`,
  );
  const result = {
    created: created.length,
    markedDue: due.length,
    blocked: blocked.length,
    expiredTasks: expiredTasks.length,
    expiredAssurances: expiredAssurances.length,
  };
  logger.info(result, "[round9Schedules] minors consent-refresh run complete");
  return result;
}

/** Hourly: flag notified-but-unacked consent propagation records past SLA. */
export async function runConsentFlagOverdueHourly(): Promise<{ flagged: number }> {
  const rows = await q(
    `UPDATE propagation_records pr SET status = 'overdue', updated_at = NOW()
     FROM downstream_processors dp
     WHERE pr.processor_id = dp.id
       AND pr.status = 'notified'
       AND pr.notified_at + (dp.sla_hours || ' hours')::interval < NOW()
     RETURNING pr.id`,
  );
  logger.info({ flagged: rows.length }, "[round9Schedules] consent overdue sweep complete");
  return { flagged: rows.length };
}

/** Daily: revoke whistleblower channel tokens past their expiry. */
export async function runWhistleblowerTokenExpiry(): Promise<{ revoked: number }> {
  const rows = await q(
    `UPDATE whistleblower_channel_tokens SET revoked_at = NOW()
     WHERE revoked_at IS NULL AND expires_at <= NOW()
     RETURNING id`,
  );
  if (rows.length > 0) {
    await q(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, created_at)
       VALUES ('whistleblower.tokens_expired', 'whistleblower_channel_token', NULL, NULL, $1, NOW())`,
      [JSON.stringify({ revoked: rows.length })],
    );
  }
  logger.info({ revoked: rows.length }, "[round9Schedules] whistleblower token expiry sweep complete");
  return { revoked: rows.length };
}

/** Daily: record 'overdue' events for FOIA requests past the statutory deadline. */
export async function runFoiaOverdueSweep(): Promise<{ newlyOverdue: number }> {
  const rows = await q(
    `INSERT INTO foia_events (foia_request_id, event_type, actor, details)
     SELECT f.id, 'overdue', 'system',
            jsonb_build_object('statutory_deadline', f.statutory_deadline, 'reference_number', f.reference_number)
     FROM foia_requests f
     WHERE f.status IN ('received','processing')
       AND f.statutory_deadline < NOW()
       AND NOT EXISTS (
         SELECT 1 FROM foia_events e WHERE e.foia_request_id = f.id AND e.event_type = 'overdue'
       )
     RETURNING id`,
  );
  logger.info({ newlyOverdue: rows.length }, "[round9Schedules] FOIA overdue sweep complete");
  return { newlyOverdue: rows.length };
}
