/**
 * Enforcement analytics & NDPA annual-report generator — DB layer.
 *
 * Pure builders live in annualReportLogic.ts (deterministic, unit-tested);
 * generateAnnualReport(year) reads the canonical tables, persists a snapshot
 * (upsert per year) and logs every run — including graceful skips — into
 * annual_report_runs.
 *
 * Scheduled generation hook (Temporal):
 *   A Temporal cron schedule (e.g. "0 6 15 1 *" — 06:00 on 15 Jan) should
 *   invoke the activity `generateAnnualReport(previousYear, { trigger:
 *   'scheduled' })` via the enforcementAnalytics router or the temporal
 *   worker host (workers/temporal). When the schedule fires for a year that
 *   already has a snapshot, the run is logged as 'skipped' with
 *   reason='snapshot_exists' — never silently regenerated. When the DB pool
 *   is unavailable the run is logged 'skipped' with reason='db_unavailable'
 *   where possible, else thrown so Temporal retries with backoff.
 *
 * Statutory framing: NDPA 2023 s.5 (functions of the Commission) and s.6
 * (powers) require the Commission to report on its enforcement activity;
 * the payload carries the statutory framing explicitly.
 */
import { getPool } from "../db";
import { logger } from "../logger";
import {
  buildReportPayload,
  renderMarkdown,
  payloadHash,
} from "./annualReportLogic";

export { buildReportPayload, renderMarkdown, payloadHash };

async function logRun(year: number, trigger: "manual" | "scheduled", status: "completed" | "skipped" | "failed", reason: string | null): Promise<void> {
  try {
    const pool = getPool();
    if (!pool) return;
    await pool.query(
      `INSERT INTO annual_report_runs (report_year, trigger, status, reason) VALUES ($1, $2, $3, $4)`,
      [year, trigger, status, reason],
    );
  } catch (err) {
    logger.warn({ err }, "[annualReport] run-log write failed");
  }
}

export interface GenerateOptions {
  trigger: "manual" | "scheduled";
  generatedBy: string;
  /** Scheduled runs skip (gracefully, with a logged reason) when a snapshot
   *  already exists; manual runs regenerate (upsert). */
}

export async function generateAnnualReport(year: number, opts: GenerateOptions): Promise<{ status: "completed" | "skipped"; reason?: string; snapshot?: unknown }> {
  const pool = getPool();
  if (!pool) {
    await logRun(year, opts.trigger, "skipped", "db_unavailable");
    return { status: "skipped", reason: "db_unavailable" };
  }

  if (opts.trigger === "scheduled") {
    const existing = await pool.query(`SELECT id FROM annual_report_snapshots WHERE report_year = $1`, [year]);
    if (existing.rows.length > 0) {
      await logRun(year, opts.trigger, "skipped", "snapshot_exists");
      return { status: "skipped", reason: "snapshot_exists" };
    }
  }

  const q = (sql: string, params: unknown[] = []) => pool.query(sql, params).then((r) => r.rows);
  const [complaints, cases, fines, instalments, settlements, sectors] = await Promise.all([
    q(`SELECT category, received_at, resolved_at FROM public_complaints
       WHERE EXTRACT(YEAR FROM received_at) = $1`, [year]),
    q(`SELECT id, status, opened_at, closed_at, organization_id FROM enforcement_cases
       WHERE EXTRACT(YEAR FROM opened_at) = $1`, [year]),
    q(`SELECT id, org_id, amount, amount_paid, status, issued_at FROM enforcement_fines
       WHERE EXTRACT(YEAR FROM issued_at) = $1`, [year]),
    q(`SELECT status, due_date, paid_at, amount, amount_paid FROM settlement_instalments
       WHERE EXTRACT(YEAR FROM due_date) = $1`, [year]),
    q(`SELECT status FROM settlements WHERE EXTRACT(YEAR FROM created_at) = $1`, [year]),
    q(`SELECT COALESCE(o.sector, 'unknown') AS sector,
              COUNT(DISTINCT ec.id)::int AS cases,
              COALESCE(SUM(ef.amount), 0) AS fines_imposed,
              COALESCE(SUM(ef.amount_paid), 0) AS fines_collected
       FROM enforcement_cases ec
       JOIN organizations o ON o.id = ec.organization_id
       LEFT JOIN enforcement_fines ef ON ef.org_id = o.id AND EXTRACT(YEAR FROM ef.issued_at) = $1
       WHERE EXTRACT(YEAR FROM ec.opened_at) = $1
       GROUP BY 1 ORDER BY 1`, [year]),
  ]);

  const payload = buildReportPayload({ year, complaints, cases, fines, instalments, settlements, sectors });
  const markdown = renderMarkdown(payload);
  const hash = payloadHash(payload);

  const result = await pool.query(
    `INSERT INTO annual_report_snapshots (report_year, payload, markdown, source_hash, trigger, generated_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (report_year) DO UPDATE
       SET payload = EXCLUDED.payload, markdown = EXCLUDED.markdown,
           source_hash = EXCLUDED.source_hash, trigger = EXCLUDED.trigger,
           generated_by = EXCLUDED.generated_by, generated_at = NOW()
     RETURNING id, report_year, generated_at`,
    [year, JSON.stringify(payload), markdown, hash, opts.trigger, opts.generatedBy],
  );
  await logRun(year, opts.trigger, "completed", null);
  return { status: "completed", snapshot: result.rows[0] };
}
