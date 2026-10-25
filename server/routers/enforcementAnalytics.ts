/**
 * Enforcement analytics & annual-report router (FEAT-E, round 9).
 *
 * Live KPI endpoints (time-to-resolution, deterrence, penalty collection,
 * sector breakdowns) plus the NDPA s.5/s.6 annual report:
 *   generateReport  — admin-triggered snapshot (upsert per year);
 *   scheduledGenerationTick — scheduler hook: graceful, logged skip when the
 *                     snapshot already exists (see annualReport.ts for the
 *                     documented Temporal schedule);
 *   getReport / listReports — snapshot reads.
 * Every mutation writes an audit_logs row and emits a mutation event.
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { generateAnnualReport } from "../services/annualReport";

async function exec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  try {
    const safeParams = params.map((p) =>
      Array.isArray(p) || (p !== null && typeof p === "object" && !(p instanceof Date))
        ? JSON.stringify(p)
        : p
    );
    const result = await pool.query(query, safeParams);
    return autoDecryptRows(query, result.rows ?? []);
  } catch (err) {
    logger.error({ err, query: query.slice(0, 200) }, "[enforcementAnalytics] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

function toIntOrNull(v: string | number | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isInteger(n) && Math.abs(n) < 2147483647 ? n : null;
}

async function logAudit(
  action: string,
  resourceType: string,
  resourceId: string | number | null,
  userId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await exec(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NOW())`,
      [action, resourceType, toIntOrNull(resourceId), toIntOrNull(userId), JSON.stringify(details)],
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, "[enforcementAnalytics] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

export const enforcementAnalyticsRouter = router({
  /** Time-to-resolution KPIs per case type (complaints by category +
   *  enforcement cases overall) for a year. */
  timeToResolution: protectedProcedure
    .input(z.object({ year: z.number().int().min(2020).max(2100) }))
    .query(async ({ input }) => {
      const complaints = await exec(
        `SELECT category,
                COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolved_count,
                ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - received_at)) / 86400)::numeric, 2) AS avg_days,
                ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
                  ORDER BY EXTRACT(EPOCH FROM (resolved_at - received_at)) / 86400
                )::numeric, 2) AS median_days
         FROM public_complaints
         WHERE EXTRACT(YEAR FROM received_at) = $1
         GROUP BY category ORDER BY category`,
        [input.year],
      );
      const cases = await exec(
        `SELECT COUNT(*) FILTER (WHERE closed_at IS NOT NULL)::int AS closed_count,
                ROUND(AVG(EXTRACT(EPOCH FROM (closed_at - opened_at)) / 86400)::numeric, 2) AS avg_days,
                ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
                  ORDER BY EXTRACT(EPOCH FROM (closed_at - opened_at)) / 86400
                )::numeric, 2) AS median_days
         FROM enforcement_cases WHERE EXTRACT(YEAR FROM opened_at) = $1`,
        [input.year],
      );
      return { year: input.year, complaints_by_category: complaints, enforcement_cases: cases[0] ?? null };
    }),

  /** Deterrence metrics: repeat-offender rate + remediation (settlement)
   *  compliance rate for a year. */
  deterrenceMetrics: protectedProcedure
    .input(z.object({ year: z.number().int().min(2020).max(2100) }))
    .query(async ({ input }) => {
      const repeat = await exec(
        `SELECT COUNT(*)::int AS organizations_with_cases,
                COUNT(*) FILTER (WHERE case_count > 1)::int AS repeat_offenders
         FROM (
           SELECT organization_id, COUNT(*) AS case_count
           FROM enforcement_cases WHERE EXTRACT(YEAR FROM opened_at) = $1
           GROUP BY organization_id
         ) t`,
        [input.year],
      );
      const remediation = await exec(
        `SELECT COUNT(*) FILTER (WHERE status = 'fulfilled')::int AS fulfilled,
                COUNT(*) FILTER (WHERE status = 'defaulted')::int AS defaulted
         FROM settlements WHERE EXTRACT(YEAR FROM created_at) = $1`,
        [input.year],
      );
      const r = repeat[0] ?? { organizations_with_cases: 0, repeat_offenders: 0 };
      const rem = remediation[0] ?? { fulfilled: 0, defaulted: 0 };
      return {
        year: input.year,
        organizations_with_cases: r.organizations_with_cases,
        repeat_offenders: r.repeat_offenders,
        repeat_offender_rate: r.organizations_with_cases ? r.repeat_offenders / r.organizations_with_cases : null,
        settlements_fulfilled: rem.fulfilled,
        settlements_defaulted: rem.defaulted,
        remediation_compliance_rate: rem.fulfilled + rem.defaulted ? rem.fulfilled / (rem.fulfilled + rem.defaulted) : null,
      };
    }),

  /** Penalty collection rates incl. settlement instalment performance. */
  penaltyCollection: protectedProcedure
    .input(z.object({ year: z.number().int().min(2020).max(2100) }))
    .query(async ({ input }) => {
      const fines = await exec(
        `SELECT COUNT(*)::int AS fines_count,
                COALESCE(SUM(amount), 0)::numeric AS imposed_total,
                COALESCE(SUM(amount_paid), 0)::numeric AS collected_total,
                COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_count,
                COUNT(*) FILTER (WHERE status IN ('overdue', 'outstanding'))::int AS overdue_count
         FROM enforcement_fines WHERE EXTRACT(YEAR FROM issued_at) = $1`,
        [input.year],
      );
      const instalments = await exec(
        `SELECT status, COUNT(*)::int AS count,
                COALESCE(SUM(amount), 0)::numeric AS amount_total,
                COALESCE(SUM(amount_paid), 0)::numeric AS paid_total,
                COUNT(*) FILTER (WHERE status = 'paid' AND paid_at <= due_date)::int AS paid_on_time
         FROM settlement_instalments WHERE EXTRACT(YEAR FROM due_date) = $1
         GROUP BY status ORDER BY status`,
        [input.year],
      );
      const f = fines[0] ?? {};
      const imposed = Number(f.imposed_total ?? 0);
      return {
        year: input.year,
        ...f,
        collection_rate: imposed > 0 ? Number(f.collected_total ?? 0) / imposed : null,
        instalments,
      };
    }),

  /** Sector breakdown of cases + fines for a year. */
  sectorBreakdown: protectedProcedure
    .input(z.object({ year: z.number().int().min(2020).max(2100) }))
    .query(async ({ input }) => {
      return exec(
        `SELECT COALESCE(o.sector, 'unknown') AS sector,
                COUNT(DISTINCT ec.id)::int AS cases,
                COALESCE(SUM(ef.amount), 0)::numeric AS fines_imposed,
                COALESCE(SUM(ef.amount_paid), 0)::numeric AS fines_collected
         FROM enforcement_cases ec
         JOIN organizations o ON o.id = ec.organization_id
         LEFT JOIN enforcement_fines ef ON ef.org_id = o.id AND EXTRACT(YEAR FROM ef.issued_at) = $1
         WHERE EXTRACT(YEAR FROM ec.opened_at) = $1
         GROUP BY 1 ORDER BY cases DESC, sector ASC`,
        [input.year],
      );
    }),

  // ─── Annual report (NDPA 2023 s.5/s.6 statutory framing) ────────────────
  generateReport: adminProcedure
    .input(z.object({ year: z.number().int().min(2020).max(2100) }))
    .mutation(async ({ input, ctx }) => {
      const result = await generateAnnualReport(input.year, {
        trigger: "manual",
        generatedBy: ctx.user.name ?? String(ctx.user.id),
      });
      await logAudit("annual_report_generated", "annual_report_snapshots", null, String(ctx.user.id), {
        year: input.year, status: result.status,
      });
      fireAndForget("enforcementAnalytics.generateReport");
      return result;
    }),

  /**
   * Scheduler hook (Temporal cron — see annualReport.ts header). Skips
   * gracefully (logged, never silent) when the snapshot already exists.
   */
  scheduledGenerationTick: adminProcedure
    .input(z.object({ year: z.number().int().min(2020).max(2100) }))
    .mutation(async ({ input, ctx }) => {
      const result = await generateAnnualReport(input.year, {
        trigger: "scheduled",
        generatedBy: "temporal-schedule",
      });
      await logAudit("annual_report_scheduled_tick", "annual_report_snapshots", null, String(ctx.user.id), {
        year: input.year, status: result.status, reason: result.reason ?? null,
      });
      return result;
    }),

  listReports: protectedProcedure.query(async () => {
    return exec(
      `SELECT id, report_year, source_hash, trigger, generated_by, generated_at
       FROM annual_report_snapshots ORDER BY report_year DESC`,
    );
  }),

  getReport: protectedProcedure
    .input(z.object({ year: z.number().int().min(2020).max(2100), format: z.enum(["json", "markdown"]).default("json") }))
    .query(async ({ input }) => {
      const rows = await exec(`SELECT * FROM annual_report_snapshots WHERE report_year = $1`, [input.year]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No report snapshot for that year" });
      const r = rows[0];
      if (input.format === "markdown") return { report_year: r.report_year, generated_at: r.generated_at, markdown: r.markdown };
      return { report_year: r.report_year, generated_at: r.generated_at, source_hash: r.source_hash, payload: r.payload };
    }),

  reportRuns: adminProcedure
    .input(z.object({ year: z.number().int().min(2020).max(2100).optional(), limit: z.number().int().min(1).max(200).default(50) }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "";
      if (input?.year) { params.push(input.year); where = `WHERE report_year = $1`; }
      params.push(input?.limit ?? 50);
      return exec(
        `SELECT * FROM annual_report_runs ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
        params,
      );
    }),
});
