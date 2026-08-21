/**
 * NDSEP Database — Compliance Domain Queries
 * =============================================
 * Audit returns, DSAR responses, compliance scoring.
 *
 * Recommendation H4: Domain module extraction
 */

import { getPool } from "../db";
import { handleError } from "../errorClassifier";

export interface ComplianceSummary {
  totalOrgs: number;
  compliantOrgs: number;
  pendingAudits: number;
  overdueAudits: number;
  avgComplianceScore: number;
}

/** Get compliance dashboard summary */
export async function getComplianceSummary(): Promise<ComplianceSummary> {
  const pool = getPool();
  if (!pool) return { totalOrgs: 0, compliantOrgs: 0, pendingAudits: 0, overdueAudits: 0, avgComplianceScore: 0 };

  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM organizations) as total_orgs,
        (SELECT COUNT(*) FROM organizations WHERE compliance_score >= 70) as compliant_orgs,
        (SELECT COUNT(*) FROM compliance_audit_returns WHERE status = 'in_progress') as pending_audits,
        (SELECT COUNT(*) FROM compliance_audit_returns WHERE status = 'overdue') as overdue_audits,
        (SELECT COALESCE(AVG(compliance_score), 0) FROM organizations) as avg_score
    `);
    const row = result.rows[0];
    return {
      totalOrgs: parseInt(row.total_orgs, 10),
      compliantOrgs: parseInt(row.compliant_orgs, 10),
      pendingAudits: parseInt(row.pending_audits, 10),
      overdueAudits: parseInt(row.overdue_audits, 10),
      avgComplianceScore: Math.round(parseFloat(row.avg_score) * 10) / 10,
    };
  } catch (err) {
    handleError(err, { module: "db/compliance", action: "getComplianceSummary" });
    return { totalOrgs: 0, compliantOrgs: 0, pendingAudits: 0, overdueAudits: 0, avgComplianceScore: 0 };
  }
}

/** Get DSAR response time statistics */
export async function getDsarResponseStats(): Promise<{
  avgResponseDays: number;
  withinSla: number;
  totalRequests: number;
}> {
  const pool = getPool();
  if (!pool) return { avgResponseDays: 0, withinSla: 0, totalRequests: 0 };

  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total,
        AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 86400) as avg_days,
        SUM(CASE WHEN resolved_at - created_at <= INTERVAL '30 days' THEN 1 ELSE 0 END) as within_sla
      FROM citizen_requests
      WHERE status = 'resolved' AND resolved_at IS NOT NULL
    `);
    const row = result.rows[0];
    return {
      avgResponseDays: Math.round(parseFloat(row.avg_days ?? "0") * 10) / 10,
      withinSla: parseInt(row.within_sla ?? "0", 10),
      totalRequests: parseInt(row.total ?? "0", 10),
    };
  } catch (err) {
    handleError(err, { module: "db/compliance", action: "getDsarResponseStats" });
    return { avgResponseDays: 0, withinSla: 0, totalRequests: 0 };
  }
}
