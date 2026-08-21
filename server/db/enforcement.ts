/**
 * NDSEP Database — Enforcement Domain Queries
 * ==============================================
 * Enforcement cases, penalties, escalation tracking.
 *
 * Recommendation H4: Domain module extraction
 */

import { getPool } from "../db";
import { handleError } from "../errorClassifier";

export interface EnforcementSummary {
  openCases: number;
  totalPenaltiesNgn: number;
  collectedNgn: number;
  collectionRate: number;
  avgResolutionDays: number;
}

/** Get enforcement dashboard summary */
export async function getEnforcementSummary(): Promise<EnforcementSummary> {
  const pool = getPool();
  if (!pool) return { openCases: 0, totalPenaltiesNgn: 0, collectedNgn: 0, collectionRate: 0, avgResolutionDays: 0 };

  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM enforcement_cases WHERE status = 'open') as open_cases,
        (SELECT COALESCE(SUM(amount), 0) FROM financial_penalties) as total_penalties,
        (SELECT COALESCE(SUM(amount), 0) FROM financial_penalties WHERE status = 'completed') as collected,
        (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 86400), 0)
         FROM enforcement_cases WHERE status = 'resolved' AND resolved_at IS NOT NULL) as avg_resolution
    `);
    const row = result.rows[0];
    const total = parseFloat(row.total_penalties);
    const collected = parseFloat(row.collected);
    return {
      openCases: parseInt(row.open_cases, 10),
      totalPenaltiesNgn: total,
      collectedNgn: collected,
      collectionRate: total > 0 ? Math.round((collected / total) * 100) : 0,
      avgResolutionDays: Math.round(parseFloat(row.avg_resolution) * 10) / 10,
    };
  } catch (err) {
    handleError(err, { module: "db/enforcement", action: "getEnforcementSummary" });
    return { openCases: 0, totalPenaltiesNgn: 0, collectedNgn: 0, collectionRate: 0, avgResolutionDays: 0 };
  }
}
