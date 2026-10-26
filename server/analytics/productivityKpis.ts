/**
 * Productivity KPI baselines (Round-12 §8).
 *
 * Computes operator-productivity metrics from EXISTING tables only:
 *
 *   clicks_per_workflow      proxy for UI friction: staff action events per
 *                            complaint lifecycle — complaint_events (actor <>
 *                            'public'/'system') per complaint, plus complaint-
 *                            related audit_ledger mutations per complaint.
 *   time_to_triage_hours     complaint_events: complaint submitted → first
 *                            triage transition (first status_change away from
 *                            'received', i.e. acknowledged/under_review/...).
 *   time_to_resolution_hours complaint_events: submitted → first terminal
 *                            transition (to_status IN resolved/closed).
 *   queue_auto_clear_rate    share of scan_findings / adverse_media_items
 *                            resolved WITHOUT a manual actor (resolved_by /
 *                            reviewed_by IS NULL). No auto-resolution path
 *                            exists yet — the honest baseline is 0; the query
 *                            is wired so future automation moves the number.
 *   form_fields_edited       analytics_events form instrumentation: counts of
 *                            form_start / form_complete / form_abandon plus
 *                            the sum of metadata.fieldsEdited when present.
 *
 * Every metric is a real query — when the underlying table has no rows the
 * metric reports value 0 with `sampleSize: 0`, never a fabricated number.
 *
 * Snapshots: persistBaseline() appends each metric to the kpi_snapshots
 * time-series table (migration 0131) so trends can be charted; when the
 * migration has not been applied it logs and skips (42P01) rather than
 * failing the read path.
 */
import { logger } from "../logger";
import { getPool } from "../db";

/** Minimal query executor so tests can inject a canned db (vi.mock pattern). */
export type QueryFn = (sql: string, params?: unknown[]) => Promise<any[]>;

async function poolQuery(sql: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new Error("Database unavailable");
  const result = await pool.query(sql, params);
  return result.rows ?? [];
}

export interface KpiMetric {
  /** Stable metric key, e.g. "time_to_triage_hours" (kpi_snapshots.metric). */
  id: string;
  label: string;
  /** Primary numeric value (kpi_snapshots.value). */
  value: number;
  unit: string;
  /** Number of underlying records the value was computed from. */
  sampleSize: number;
  /** Extra breakdown stored in kpi_snapshots.dimensions. */
  dimensions: Record<string, unknown>;
  description: string;
}

export interface ProductivityKpiBaseline {
  computedAt: string;
  metrics: KpiMetric[];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Clicks-per-workflow proxies from complaint_events + audit_ledger. */
export async function computeClicksPerWorkflow(q: QueryFn): Promise<KpiMetric> {
  const [events] = await q(
    `SELECT COUNT(*)::float AS staff_events,
            COUNT(DISTINCT complaint_id)::float AS complaints
       FROM complaint_events
      WHERE actor IS NOT NULL AND actor NOT IN ('public', 'system')`,
  );
  const [ledger] = await q(
    `SELECT COUNT(*)::float AS ledger_actions
       FROM audit_ledger
      WHERE action ILIKE '%complaint%'`,
  );
  const complaints = num(events?.complaints);
  const staffEvents = num(events?.staff_events);
  const ledgerActions = num(ledger?.ledger_actions);
  return {
    id: "clicks_per_workflow",
    label: "Clicks per complaint workflow (proxy)",
    // Events + ledger mutations per complaint touched by staff.
    value: complaints > 0 ? Math.round(((staffEvents + ledgerActions) / complaints) * 100) / 100 : 0,
    unit: "actions_per_complaint",
    sampleSize: complaints,
    dimensions: { staffEvents, ledgerActions, complaints },
    description:
      "Staff complaint_events plus complaint-related audit_ledger mutations divided by distinct complaints — a proxy for the clicks an officer needs per complaint lifecycle.",
  };
}

/** Submitted → first triage transition (first status_change out of 'received'). */
export async function computeTimeToTriage(q: QueryFn): Promise<KpiMetric> {
  const [row] = await q(
    `WITH submitted AS (
       SELECT complaint_id, MIN(created_at) AS submitted_at
         FROM complaint_events WHERE event_type = 'submitted' GROUP BY complaint_id
     ), triaged AS (
       SELECT complaint_id, MIN(created_at) AS triaged_at
         FROM complaint_events
        WHERE event_type = 'status_change' AND from_status = 'received'
        GROUP BY complaint_id
     )
     SELECT AVG(EXTRACT(EPOCH FROM (t.triaged_at - s.submitted_at)) / 3600.0)::float AS avg_hours,
            COUNT(*)::int AS n
       FROM submitted s JOIN triaged t ON t.complaint_id = s.complaint_id`,
  );
  const n = num(row?.n);
  return {
    id: "time_to_triage_hours",
    label: "Time to triage",
    value: n > 0 ? Math.round(num(row?.avg_hours) * 100) / 100 : 0,
    unit: "hours",
    sampleSize: n,
    dimensions: {},
    description:
      "Mean hours from complaint submission to the first status change out of 'received' (complaint_events).",
  };
}

/** Submitted → first terminal transition (resolved/closed). */
export async function computeTimeToResolution(q: QueryFn): Promise<KpiMetric> {
  const [row] = await q(
    `WITH submitted AS (
       SELECT complaint_id, MIN(created_at) AS submitted_at
         FROM complaint_events WHERE event_type = 'submitted' GROUP BY complaint_id
     ), resolved AS (
       SELECT complaint_id, MIN(created_at) AS resolved_at
         FROM complaint_events
        WHERE to_status IN ('resolved', 'closed')
        GROUP BY complaint_id
     )
     SELECT AVG(EXTRACT(EPOCH FROM (r.resolved_at - s.submitted_at)) / 3600.0)::float AS avg_hours,
            COUNT(*)::int AS n
       FROM submitted s JOIN resolved r ON r.complaint_id = s.complaint_id`,
  );
  const n = num(row?.n);
  return {
    id: "time_to_resolution_hours",
    label: "Time to resolution",
    value: n > 0 ? Math.round(num(row?.avg_hours) * 100) / 100 : 0,
    unit: "hours",
    sampleSize: n,
    dimensions: {},
    description:
      "Mean hours from complaint submission to the first resolved/closed transition (complaint_events).",
  };
}

/**
 * Queue auto-clear rate: findings / adverse-media items resolved WITHOUT a
 * manual reviewer (resolved_by / reviewed_by IS NULL) over all resolved
 * items. No auto-resolution automation exists yet, so the honest baseline is
 * 0 — the queries are wired so future automation moves the number.
 */
export async function computeQueueAutoClearRate(q: QueryFn): Promise<KpiMetric> {
  const [findings] = await q(
    `SELECT COUNT(*)::int AS resolved_total,
            COUNT(*) FILTER (WHERE resolved_by IS NULL)::int AS auto_cleared
       FROM scan_findings
      WHERE status IN ('resolved', 'dismissed')`,
  );
  const [media] = await q(
    `SELECT COUNT(*)::int AS resolved_total,
            COUNT(*) FILTER (WHERE reviewed_by IS NULL)::int AS auto_cleared
       FROM adverse_media_items
      WHERE review_status IN ('confirmed', 'rejected')`,
  );
  const resolvedTotal = num(findings?.resolved_total) + num(media?.resolved_total);
  const autoCleared = num(findings?.auto_cleared) + num(media?.auto_cleared);
  return {
    id: "queue_auto_clear_rate",
    label: "Queue auto-clear rate",
    value: resolvedTotal > 0 ? Math.round((autoCleared / resolvedTotal) * 10000) / 100 : 0,
    unit: "percent",
    sampleSize: resolvedTotal,
    dimensions: {
      autoCleared,
      resolvedTotal,
      scanFindings: { resolvedTotal: num(findings?.resolved_total), autoCleared: num(findings?.auto_cleared) },
      adverseMedia: { resolvedTotal: num(media?.resolved_total), autoCleared: num(media?.auto_cleared) },
    },
    description:
      "Share of scan_findings and adverse_media_items resolved without a manual actor (resolved_by/reviewed_by NULL). Baseline 0 — no auto-resolution path exists yet.",
  };
}

/** Form instrumentation from analytics_events (form_* event types). */
export async function computeFormFieldsEdited(q: QueryFn, days = 30): Promise<KpiMetric> {
  const [row] = await q(
    `SELECT COUNT(*) FILTER (WHERE event_type = 'form_start')::int AS starts,
            COUNT(*) FILTER (WHERE event_type = 'form_complete')::int AS completions,
            COUNT(*) FILTER (WHERE event_type = 'form_abandon')::int AS abandonments,
            COALESCE(SUM((metadata->>'fieldsEdited')::int)
              FILTER (WHERE metadata ? 'fieldsEdited'), 0)::int AS fields_edited
       FROM analytics_events
      WHERE event_type IN ('form_start', 'form_complete', 'form_abandon')
        AND created_at > NOW() - INTERVAL '1 day' * $1`,
    [days],
  );
  const fieldsEdited = num(row?.fields_edited);
  return {
    id: "form_fields_edited",
    label: "Form fields edited",
    value: fieldsEdited,
    unit: "fields",
    sampleSize: num(row?.starts) + num(row?.completions) + num(row?.abandonments),
    dimensions: {
      windowDays: days,
      starts: num(row?.starts),
      completions: num(row?.completions),
      abandonments: num(row?.abandonments),
    },
    description:
      "Sum of metadata.fieldsEdited across analytics_events form instrumentation (30-day window), with start/complete/abandon counts.",
  };
}

/** Compute the full KPI baseline. `q` is injectable for tests. */
export async function computeProductivityKpiBaseline(
  q: QueryFn = poolQuery,
): Promise<ProductivityKpiBaseline> {
  const metrics = await Promise.all([
    computeClicksPerWorkflow(q),
    computeTimeToTriage(q),
    computeTimeToResolution(q),
    computeQueueAutoClearRate(q),
    computeFormFieldsEdited(q),
  ]);
  return { computedAt: new Date().toISOString(), metrics };
}

/**
 * Append each metric to the kpi_snapshots time-series table (migration 0131).
 * Returns the number of rows written. A missing table (migration not yet
 * applied, SQLSTATE 42P01) logs a warning and returns 0 — the read path must
 * never fail because snapshotting is unavailable.
 */
export async function persistKpiSnapshots(
  baseline: ProductivityKpiBaseline,
  q: QueryFn = poolQuery,
): Promise<number> {
  let written = 0;
  for (const metric of baseline.metrics) {
    try {
      await q(
        `INSERT INTO kpi_snapshots (metric, value, dimensions, captured_at)
         VALUES ($1, $2, $3, NOW())`,
        [metric.id, metric.value, JSON.stringify({ ...metric.dimensions, unit: metric.unit, sampleSize: metric.sampleSize })],
      );
      written += 1;
    } catch (err) {
      if ((err as { code?: string })?.code === "42P01") {
        logger.warn("[productivityKpis] kpi_snapshots table missing (migration 0131 not applied) — snapshot skipped");
        return written;
      }
      throw err;
    }
  }
  return written;
}

/** Read recent snapshot history for a metric (trend table on the dashboard). */
export async function readKpiSnapshotHistory(
  metric: string | undefined,
  limit: number,
  q: QueryFn = poolQuery,
): Promise<Array<{ id: string; metric: string; value: number; dimensions: unknown; captured_at: string }>> {
  try {
    if (metric) {
      return await q(
        `SELECT id, metric, value, dimensions, captured_at FROM kpi_snapshots
          WHERE metric = $1 ORDER BY captured_at DESC LIMIT $2`,
        [metric, limit],
      );
    }
    return await q(
      `SELECT id, metric, value, dimensions, captured_at FROM kpi_snapshots
        ORDER BY captured_at DESC LIMIT $1`,
      [limit],
    );
  } catch (err) {
    if ((err as { code?: string })?.code === "42P01") {
      logger.warn("[productivityKpis] kpi_snapshots table missing (migration 0131 not applied) — empty history");
      return [];
    }
    throw err;
  }
}
