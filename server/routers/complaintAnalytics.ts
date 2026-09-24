/**
 * Complaint Analytics Router (admin) — "spikes and trends" dashboard over the
 * public complaint stream, CFPB Consumer Complaint Database pattern.
 *
 *   spikesAndTrends   daily series sliced per controller / per category /
 *                     per state or LGA, with rolling baseline + z-score overlay
 *   controllerTrend   single-controller series + baseline + change-point
 *   surgeAlerts       alert queue (list / acknowledge / resolve)
 *   runSurgeDetection recompute daily counts, baselines and run both
 *                     detectors (z-score AND Poisson change-point)
 *   weeklyDigest      weekly digest computation
 *
 * Detection math lives in server/services/complaintSurge.ts (pure TS port of
 * ml/bayesian/models.py — no python runtime call).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { COMPLAINT_CATEGORIES } from "../services/complaintLogic";
import {
  recomputeDailyCounts,
  updateBaselines,
  detectSurges,
  computeWeeklyDigest,
  surgeConfig,
  CONTROLLER_KEY_SQL,
} from "../services/complaintSurge";
import { rollingZScore, poissonChangepoint } from "../services/complaintSurgeMath";

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
    logger.error({ err, query: query.slice(0, 200) }, "[complaintAnalytics] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

function toIntOrNull(v: string | number | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isInteger(n) && Math.abs(n) < 2147483647 ? n : null;
}

async function logAudit(action: string, resourceId: string | number | null, userId: string | null, details: Record<string, unknown> = {}): Promise<void> {
  try {
    await exec(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, created_at)
       VALUES ($1, 'surge_alerts', $2, $3, $4, NOW())`,
      [action, toIntOrNull(resourceId), toIntOrNull(userId), JSON.stringify(details)],
    );
  } catch (err) {
    logger.warn({ err, action }, "[complaintAnalytics] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

const dateRangeInput = {
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
};

export const complaintAnalyticsRouter = router({
  // ─── Spikes & trends dashboard ─────────────────────────────────────────────
  spikesAndTrends: adminProcedure
    .input(z.object({
      ...dateRangeInput,
      scope: z.enum(["controller", "category", "state", "lga"]).default("category"),
      category: z.enum(COMPLAINT_CATEGORIES).optional(),
      state: z.string().max(64).optional(),
      controllerId: z.number().int().optional(),
      topN: z.number().int().min(1).max(25).default(10),
    }))
    .query(async ({ input }) => {
      const from = input.from ?? new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const to = input.to ?? new Date().toISOString().slice(0, 10);
      const params: unknown[] = [from, to];
      const conds: string[] = ["received_at::date BETWEEN $1 AND $2", "merged_into_id IS NULL"];
      if (input.category) { params.push(input.category); conds.push(`category = $${params.length}`); }
      if (input.state) { params.push(input.state); conds.push(`state = $${params.length}`); }
      if (input.controllerId) { params.push(input.controllerId); conds.push(`controller_id = $${params.length}`); }

      const dimensionSql =
        input.scope === "controller" ? `${CONTROLLER_KEY_SQL}`
        : input.scope === "category" ? "category"
        : input.scope === "state" ? "coalesce(state, 'unspecified')"
        : "concat_ws(' / ', coalesce(state, 'unspecified'), coalesce(lga, 'unspecified'))";

      // Daily totals across the slice.
      const daily = await exec(
        `SELECT received_at::date AS d, COUNT(*)::int AS n
         FROM public_complaints WHERE ${conds.join(" AND ")}
         GROUP BY received_at::date ORDER BY d ASC`,
        params,
      );
      // Per-dimension daily series for the top-N dimensions by volume.
      params.push(input.topN);
      const topDims = await exec(
        `SELECT ${dimensionSql} AS dim, COUNT(*)::int AS total
         FROM public_complaints WHERE ${conds.join(" AND ")}
         GROUP BY dim ORDER BY total DESC LIMIT $${params.length}`,
        params,
      );
      const series: Array<{ dimension: string; total: number; daily: Array<{ d: string; n: number }> }> = [];
      for (const row of topDims) {
        const dimParams = [...params.slice(0, -1), row.dim];
        const dimDaily = await exec(
          `SELECT received_at::date AS d, COUNT(*)::int AS n
           FROM public_complaints WHERE ${conds.join(" AND ")} AND ${dimensionSql} = $${dimParams.length}
           GROUP BY received_at::date ORDER BY d ASC`,
          dimParams,
        );
        series.push({
          dimension: String(row.dim),
          total: Number(row.total),
          daily: dimDaily.map((r) => ({ d: String(r.d).slice(0, 10), n: Number(r.n) })),
        });
      }
      return {
        scope: input.scope,
        from,
        to,
        daily: daily.map((r) => ({ d: String(r.d).slice(0, 10), n: Number(r.n) })),
        topDimensions: series,
      };
    }),

  /** Single-controller series with baseline + z-score + change-point evidence. */
  controllerTrend: adminProcedure
    .input(z.object({
      controllerKey: z.string().min(1).max(256),
      days: z.number().int().min(14).max(365).default(90),
    }))
    .query(async ({ input }) => {
      const cfg = surgeConfig();
      const rows = await exec(
        `WITH days AS (SELECT generate_series(CURRENT_DATE - ($2 || ' days')::interval, CURRENT_DATE, interval '1 day')::date AS d)
         SELECT d, COALESCE(c.complaint_count, 0)::int AS n
         FROM days LEFT JOIN complaint_daily_counts c
           ON c.count_date = d AND c.controller_key = $1
         ORDER BY d ASC`,
        [input.controllerKey, input.days - 1],
      );
      const counts = rows.map((r) => Number(r.n));
      const baseline = await exec(`SELECT * FROM surge_baselines WHERE controller_key = $1`, [input.controllerKey]);
      const z = rollingZScore(counts.slice(0, -1), counts[counts.length - 1] ?? 0, cfg.baselineDays - 1, cfg.minBaselineDays);
      const cp = poissonChangepoint(counts, { a: 1.0, b: 0.2 });
      return {
        controllerKey: input.controllerKey,
        series: rows.map((r) => ({ d: String(r.d).slice(0, 10), n: Number(r.n) })),
        baseline: baseline[0] ?? null,
        today: { observed: counts[counts.length - 1] ?? 0, zscore: z?.zscore ?? null, baselineMean: z?.baselineMean ?? null },
        changepoint: {
          mapTau: cp.mapTau,
          meanTau: cp.meanTau,
          medianTau: cp.medianTau,
          tauHdi95Grid: cp.tauHdi95Grid,
          pLam2GtLam1: cp.pLam2GtLam1,
          lam1: cp.lam1,
          lam2: cp.lam2,
        },
      };
    }),

  // ─── Surge alerts ──────────────────────────────────────────────────────────
  surgeAlerts: adminProcedure
    .input(z.object({
      status: z.enum(["open", "acknowledged", "resolved"]).optional(),
      controllerKey: z.string().max(256).optional(),
      severity: z.enum(["elevated", "high", "critical"]).optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }).optional())
    .query(async ({ input }) => {
      const opts = input ?? { page: 1, limit: 20 };
      const params: unknown[] = [];
      const conds: string[] = [];
      if (opts.status) { params.push(opts.status); conds.push(`status = $${params.length}`); }
      if (opts.controllerKey) { params.push(opts.controllerKey); conds.push(`controller_key = $${params.length}`); }
      if (opts.severity) { params.push(opts.severity); conds.push(`severity = $${params.length}`); }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const page = opts.page ?? 1;
      const limit = opts.limit ?? 20;
      params.push(limit, (page - 1) * limit);
      const rows = await exec(
        `SELECT * FROM surge_alerts ${where} ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const cnt = await exec(`SELECT COUNT(*)::int AS total FROM surge_alerts ${where}`, params.slice(0, -2));
      return { data: rows, total: Number(cnt[0]?.total ?? 0), page, limit };
    }),

  acknowledgeSurgeAlert: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      resolve: z.boolean().default(false),
      notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const newStatus = input.resolve ? "resolved" : "acknowledged";
      const rows = await exec(
        `UPDATE surge_alerts SET
           status = $1,
           acknowledged_by = COALESCE(acknowledged_by, $2),
           acknowledged_at = COALESCE(acknowledged_at, NOW()),
           resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END,
           notes = COALESCE($3, notes)
         WHERE id = $4 AND status != 'resolved' RETURNING id, controller_key, status`,
        [newStatus, ctx.user.name ?? String(ctx.user.id), input.notes ?? null, input.id],
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found or already resolved." });
      await logAudit(`surge_alert_${newStatus}`, input.id, String(ctx.user.id), { notes: input.notes ?? null });
      fireAndForget("complaintAnalytics.acknowledgeSurgeAlert");
      return rows[0];
    }),

  // ─── Detection run + digest ────────────────────────────────────────────────
  runSurgeDetection: adminProcedure
    .input(z.object({
      zscoreThreshold: z.number().min(1).max(10).optional(),
      changepointProb: z.number().min(0.5).max(0.999).optional(),
      baselineDays: z.number().int().min(14).max(365).optional(),
    }).optional())
    .mutation(async ({ input, ctx }) => {
      const cfg = {
        ...surgeConfig(),
        ...(input?.zscoreThreshold != null ? { zscoreThreshold: input.zscoreThreshold } : {}),
        ...(input?.changepointProb != null ? { changepointProb: input.changepointProb } : {}),
        ...(input?.baselineDays != null ? { baselineDays: input.baselineDays } : {}),
      };
      const counts = await recomputeDailyCounts();
      const baselines = await updateBaselines(cfg);
      const detection = await detectSurges(cfg);
      await logAudit("surge_detection_run", null, String(ctx.user.id), {
        config: cfg, counted: counts, baselines, alertsRaised: detection.alerts.length,
      });
      fireAndForget("complaintAnalytics.runSurgeDetection");
      return { config: cfg, counted: counts, baselines, checked: detection.checked, alerts: detection.alerts };
    }),

  weeklyDigest: adminProcedure
    .input(z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).optional())
    .query(async ({ input }) => computeWeeklyDigest(input?.weekStart)),

  /** Current detector configuration (env-driven, overridable per run). */
  detectorConfig: adminProcedure.query(() => surgeConfig()),
});
