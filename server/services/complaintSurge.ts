/**
 * Complaint surge detection service ("spikes and trends", CFPB Consumer
 * Complaint Database pattern).
 *
 * Pipeline (invoked by complaintAnalytics.runSurgeDetection or a scheduler):
 *   1. recomputeDailyCounts  — materialize per-controller daily complaint
 *      counts from public_complaints into complaint_daily_counts.
 *   2. updateBaselines       — trailing 90-day rolling mean/stddev per
 *      controller into surge_baselines.
 *   3. detectSurges          — for every controller with enough history run
 *      BOTH detectors: z-score vs the 90-day baseline AND the Poisson
 *      change-point model ported from ml/bayesian/models.py
 *      (pure TS in ./complaintSurgeMath — no python runtime call).
 *      Alerts persist to surge_alerts; a controller+method with an existing
 *      open alert is not re-alerted.
 *
 * Thresholds are runtime-configurable via env:
 *   COMPLAINT_SURGE_BASELINE_DAYS      baseline window, default 90
 *   COMPLAINT_SURGE_ZSCORE_THRESHOLD   default 3.0
 *   COMPLAINT_SURGE_CHANGEPOINT_PROB   default 0.95 (P(lam2 > lam1))
 *   COMPLAINT_SURGE_MIN_BASELINE_DAYS  min history for z-score, default 14
 */
import { getPool } from "../db";
import { logger } from "../logger";
import {
  classifySurge,
  poissonChangepoint,
  rollingZScore,
  severityForZscore,
  type ChangepointResult,
  type SurgeThresholds,
} from "./complaintSurgeMath";

export interface SurgeConfig extends SurgeThresholds {
  baselineDays: number;
  minBaselineDays: number;
  changePointWindowDays: number;
}

export function surgeConfig(): SurgeConfig {
  return {
    baselineDays: Math.max(7, parseInt(process.env.COMPLAINT_SURGE_BASELINE_DAYS ?? "90", 10) || 90),
    minBaselineDays: Math.max(4, parseInt(process.env.COMPLAINT_SURGE_MIN_BASELINE_DAYS ?? "14", 10) || 14),
    zscoreThreshold: parseFloat(process.env.COMPLAINT_SURGE_ZSCORE_THRESHOLD ?? "3.0") || 3.0,
    changepointProb: parseFloat(process.env.COMPLAINT_SURGE_CHANGEPOINT_PROB ?? "0.95") || 0.95,
    changePointWindowDays: Math.max(14, parseInt(process.env.COMPLAINT_SURGE_CHANGEPOINT_DAYS ?? "90", 10) || 90),
  };
}

async function q(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new Error("Database unavailable");
  const safeParams = params.map((p) =>
    Array.isArray(p) || (p !== null && typeof p === "object" && !(p instanceof Date))
      ? JSON.stringify(p)
      : p
  );
  const result = await pool.query(query, safeParams);
  return result.rows ?? [];
}

/** Controller grouping key: registered controllers by id, others by normalized free-text name. */
export const CONTROLLER_KEY_SQL = `
  CASE
    WHEN controller_id IS NOT NULL THEN 'org:' || controller_id::text
    ELSE 'name:' || lower(regexp_replace(coalesce(controller_name, 'unknown'), '\\s+', ' ', 'g'))
  END`;

// ─── 1. Daily counts ─────────────────────────────────────────────────────────

/**
 * Rebuild daily counts for [fromDate, toDate] (default: last 120 days) from
 * source-of-truth public_complaints. Upsert keeps the call idempotent.
 */
export async function recomputeDailyCounts(fromDate?: string, toDate?: string): Promise<{ days: number; rows: number }> {
  const from = fromDate ?? new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  const to = toDate ?? new Date().toISOString().slice(0, 10);
  const rows = await q(
    `INSERT INTO complaint_daily_counts (count_date, controller_key, complaint_count, updated_at)
     SELECT received_at::date, ${CONTROLLER_KEY_SQL}, COUNT(*)::int, now()
     FROM public_complaints
     WHERE received_at::date BETWEEN $1 AND $2
       AND merged_into_id IS NULL
     GROUP BY received_at::date, ${CONTROLLER_KEY_SQL}
     ON CONFLICT (count_date, controller_key)
     DO UPDATE SET complaint_count = EXCLUDED.complaint_count, updated_at = now()
     RETURNING id`,
    [from, to],
  );
  return { days: Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1, rows: rows.length };
}

// ─── 2. Baselines ────────────────────────────────────────────────────────────

/** Recompute the trailing-N-day rolling baseline for every controller seen recently. */
export async function updateBaselines(cfg: SurgeConfig = surgeConfig()): Promise<{ controllers: number }> {
  const rows = await q(
    `WITH series AS (
       SELECT controller_key,
              (count_date)::date AS d,
              complaint_count
       FROM complaint_daily_counts
       WHERE count_date > CURRENT_DATE - ($1 || ' days')::interval
     ), agg AS (
       SELECT controller_key,
              AVG(complaint_count)::float8 AS mean_count,
              COALESCE(STDDEV_SAMP(complaint_count), 0)::float8 AS stddev_count,
              COUNT(*)::int AS sample_days
       FROM series
       GROUP BY controller_key
     )
     INSERT INTO surge_baselines (controller_key, window_days, mean_count, stddev_count, sample_days, computed_at)
     SELECT controller_key, $1, mean_count, stddev_count, sample_days, now() FROM agg
     ON CONFLICT (controller_key)
     DO UPDATE SET window_days = EXCLUDED.window_days,
                   mean_count = EXCLUDED.mean_count,
                   stddev_count = EXCLUDED.stddev_count,
                   sample_days = EXCLUDED.sample_days,
                   computed_at = now()
     RETURNING controller_key`,
    [cfg.baselineDays],
  );
  return { controllers: rows.length };
}

// ─── 3. Detection ────────────────────────────────────────────────────────────

export interface SurgeAlertRecord {
  controllerKey: string;
  controllerId: number | null;
  method: "zscore" | "changepoint" | "combined";
  observedCount: number;
  baselineMean: number | null;
  zscore: number | null;
  changepoint: (Pick<ChangepointResult, "mapTau" | "meanTau" | "pLam2GtLam1" | "lam1" | "lam2"> & { windowDays: number }) | null;
  severity: "elevated" | "high" | "critical";
  alertId: number;
}

async function seriesForController(controllerKey: string, days: number): Promise<{ dates: string[]; counts: number[] }> {
  const rows = await q(
    `WITH days AS (SELECT generate_series(CURRENT_DATE - ($2 || ' days')::interval, CURRENT_DATE, interval '1 day')::date AS d)
     SELECT d, COALESCE(c.complaint_count, 0)::int AS n
     FROM days
     LEFT JOIN complaint_daily_counts c ON c.count_date = d AND c.controller_key = $1
     ORDER BY d ASC`,
    [controllerKey, days - 1],
  );
  return { dates: rows.map((r) => String(r.d).slice(0, 10)), counts: rows.map((r) => Number(r.n)) };
}

/**
 * Run both detectors over every controller that received complaints inside
 * the baseline window. Pure-TS math; no python runtime call.
 */
export async function detectSurges(cfg: SurgeConfig = surgeConfig()): Promise<{ checked: number; alerts: SurgeAlertRecord[] }> {
  const controllers = await q(
    `SELECT DISTINCT controller_key FROM complaint_daily_counts
     WHERE count_date > CURRENT_DATE - ($1 || ' days')::interval`,
    [cfg.baselineDays],
  );
  const alerts: SurgeAlertRecord[] = [];

  for (const row of controllers) {
    const key = String(row.controller_key);
    const { counts } = await seriesForController(key, cfg.baselineDays);
    if (counts.length === 0) continue;
    const observed = counts[counts.length - 1];

    // Detector 1: z-score of today vs the trailing baseline (excluding today).
    const z = rollingZScore(counts.slice(0, -1), observed, cfg.baselineDays - 1, cfg.minBaselineDays);

    // Detector 2: Poisson change-point over the same window.
    let cp: ChangepointResult | null = null;
    try {
      cp = poissonChangepoint(counts, { a: 1.0, b: 0.2 });
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), key }, "[surge] change-point failed");
    }

    const { isSurge, method } = classifySurge(z?.zscore ?? null, cp?.pLam2GtLam1 ?? null, cfg);
    if (!isSurge || !method) continue;

    // Do not re-alert a controller+method that already has an open alert.
    const open = await q(
      `SELECT id FROM surge_alerts WHERE controller_key = $1 AND method = $2 AND status = 'open' LIMIT 1`,
      [key, method],
    );
    if (open[0]) continue;

    const controllerId = key.startsWith("org:") ? parseInt(key.slice(4), 10) : null;
    const inserted = await q(
      `INSERT INTO surge_alerts
         (controller_key, controller_id, controller_name, alert_date, method, observed_count,
          baseline_mean, zscore, changepoint, severity)
       VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        key,
        Number.isInteger(controllerId) ? controllerId : null,
        key.startsWith("name:") ? key.slice(5) : null,
        method,
        observed,
        z?.baselineMean ?? null,
        z != null && Number.isFinite(z.zscore) ? z.zscore : null,
        cp
          ? {
              mapTau: cp.mapTau,
              meanTau: cp.meanTau,
              pLam2GtLam1: cp.pLam2GtLam1,
              lam1: cp.lam1,
              lam2: cp.lam2,
              windowDays: cfg.changePointWindowDays,
            }
          : null,
        severityForZscore(z?.zscore ?? null),
      ],
    );
    alerts.push({
      controllerKey: key,
      controllerId: Number.isInteger(controllerId) ? controllerId : null,
      method,
      observedCount: observed,
      baselineMean: z?.baselineMean ?? null,
      zscore: z?.zscore ?? null,
      changepoint: cp
        ? { mapTau: cp.mapTau, meanTau: cp.meanTau, pLam2GtLam1: cp.pLam2GtLam1, lam1: cp.lam1, lam2: cp.lam2, windowDays: cfg.changePointWindowDays }
        : null,
      severity: severityForZscore(z?.zscore ?? null),
      alertId: Number(inserted[0]?.id ?? 0),
    });
  }
  return { checked: controllers.length, alerts };
}

// ─── 4. Weekly digest ────────────────────────────────────────────────────────

export interface WeeklyDigest {
  weekStart: string;
  weekEnd: string;
  totalComplaints: number;
  byCategory: Array<{ category: string; count: number }>;
  byState: Array<{ state: string | null; count: number }>;
  topControllers: Array<{ controllerKey: string; count: number }>;
  newSurgeAlerts: number;
  ackSlaBreaches: number;
}

/** Weekly digest computation for the analytics dashboard (defaults to the last full 7 days). */
export async function computeWeeklyDigest(weekStart?: string): Promise<WeeklyDigest> {
  const start = weekStart ?? new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const end = new Date(new Date(start).getTime() + 6 * 86400000).toISOString().slice(0, 10);
  const [totals, byCat, byState, topCtl, alerts, sla] = await Promise.all([
    q(`SELECT COUNT(*)::int AS n FROM public_complaints WHERE received_at::date BETWEEN $1 AND $2 AND merged_into_id IS NULL`, [start, end]),
    q(`SELECT category, COUNT(*)::int AS n FROM public_complaints WHERE received_at::date BETWEEN $1 AND $2 AND merged_into_id IS NULL GROUP BY category ORDER BY n DESC`, [start, end]),
    q(`SELECT state, COUNT(*)::int AS n FROM public_complaints WHERE received_at::date BETWEEN $1 AND $2 AND merged_into_id IS NULL GROUP BY state ORDER BY n DESC LIMIT 15`, [start, end]),
    q(`SELECT ${CONTROLLER_KEY_SQL} AS controller_key, COUNT(*)::int AS n FROM public_complaints WHERE received_at::date BETWEEN $1 AND $2 AND merged_into_id IS NULL GROUP BY controller_key ORDER BY n DESC LIMIT 10`, [start, end]),
    q(`SELECT COUNT(*)::int AS n FROM surge_alerts WHERE alert_date BETWEEN $1 AND $2`, [start, end]),
    q(`SELECT COUNT(*)::int AS n FROM public_complaints WHERE received_at::date BETWEEN $1 AND $2 AND acknowledged_at IS NULL AND ack_sla_due_at < now()`, [start, end]),
  ]);
  return {
    weekStart: start,
    weekEnd: end,
    totalComplaints: Number(totals[0]?.n ?? 0),
    byCategory: byCat.map((r) => ({ category: String(r.category), count: Number(r.n) })),
    byState: byState.map((r) => ({ state: r.state == null ? null : String(r.state), count: Number(r.n) })),
    topControllers: topCtl.map((r) => ({ controllerKey: String(r.controller_key), count: Number(r.n) })),
    newSurgeAlerts: Number(alerts[0]?.n ?? 0),
    ackSlaBreaches: Number(sla[0]?.n ?? 0),
  };
}
