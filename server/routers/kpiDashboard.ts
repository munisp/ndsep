/**
 * KPI Dashboard Router (Round-12 §8) — productivity KPI baselines.
 *
 *   baseline  admin; computes the current productivity KPI baseline from
 *             existing tables (server/analytics/productivityKpis). With
 *             `persist: true` each metric is also appended to the
 *             kpi_snapshots time-series table (migration 0131).
 *   history   admin; recent kpi_snapshots rows for the trend table
 *             (empty list when migration 0131 has not been applied).
 *
 * Mount: in server/routers.ts add
 *   import { kpiDashboardRouter } from "./routers/kpiDashboard";
 *   ...
 *   kpiDashboard: kpiDashboardRouter,
 * (routers.ts is owned by another workstream — mount instruction only.)
 */
import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import {
  computeProductivityKpiBaseline,
  persistKpiSnapshots,
  readKpiSnapshotHistory,
} from "../analytics/productivityKpis";

export const kpiDashboardRouter = router({
  /**
   * Compute the productivity KPI baseline. `persist` (default false) also
   * appends a snapshot per metric to kpi_snapshots for time-series
   * baselining.
   */
  baseline: adminProcedure
    .input(
      z.object({
        persist: z.boolean().default(false),
      }).optional(),
    )
    .query(async ({ input }) => {
      const baseline = await computeProductivityKpiBaseline();
      let persisted = 0;
      if (input?.persist) {
        persisted = await persistKpiSnapshots(baseline);
      }
      return { ...baseline, persisted };
    }),

  /** Recent snapshot history for the trend table. */
  history: adminProcedure
    .input(
      z.object({
        metric: z.string().max(128).optional(),
        limit: z.number().int().min(1).max(500).default(100),
      }).optional(),
    )
    .query(async ({ input }) => {
      const rows = await readKpiSnapshotHistory(input?.metric, input?.limit ?? 100);
      return { rows };
    }),
});

export type KpiDashboardRouter = typeof kpiDashboardRouter;
