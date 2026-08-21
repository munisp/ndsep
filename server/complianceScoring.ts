/**
 * NDSEP Compliance Scoring Recalculation Engine
 * ===============================================
 * Periodically recalculates organization compliance scores based on:
 *   - Audit findings and remediation status
 *   - DPIA completion
 *   - ROPA currency
 *   - Breach incident history
 *   - DPO appointment status
 *   - Consent management maturity
 *   - Training completion rates
 *   - Data retention policy adherence
 *
 * Score range: 0-100
 * Categories: A (90+), B (70-89), C (50-69), D (30-49), F (<30)
 */

import { Pool } from "pg";
import { getDatabaseUrl } from "./config";
import { getPgSslConfig } from "./dbSslConfig";
import { logger } from "./logger";

export interface ScoringResult {
  organizationId: number;
  overallScore: number;
  grade: string;
  breakdown: Record<string, { score: number; weight: number; weighted: number }>;
  calculatedAt: string;
}

const SCORING_WEIGHTS = {
  auditCompliance: 0.20,
  dpiaCompletion: 0.10,
  ropaCurrency: 0.10,
  breachHistory: 0.15,
  dpoAppointment: 0.10,
  consentManagement: 0.10,
  trainingCompletion: 0.10,
  dataRetention: 0.10,
  privacyNotices: 0.05,
};

let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: getDatabaseUrl(), ssl: getPgSslConfig(), max: 3 });
  }
  return _pool;
}

function gradeFromScore(score: number): string {
  if (score >= 90) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  if (score >= 30) return "D";
  return "F";
}

async function scoreAuditCompliance(pool: Pool, orgId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT status, COUNT(*)::int AS cnt FROM dpco_audit_engagements
     WHERE organization_id = $1 OR dpco_org_id = $1
     GROUP BY status`, [orgId]
  );
  const total = rows.reduce((s: number, r: { cnt: number }) => s + r.cnt, 0);
  const completed = rows.find((r: { status: string }) => r.status === "completed")?.cnt ?? 0;
  if (total === 0) return 50;
  return Math.round((completed / total) * 100);
}

async function scoreDpiaCompletion(pool: Pool, orgId: number): Promise<number> {
  const { rows: [row] } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(CASE WHEN dpia_status = 'approved' THEN 1 END)::int AS completed
     FROM dpia_assessments WHERE organization_id = $1`, [orgId]
  );
  if (row.total === 0) return 100;
  return Math.round((row.completed / row.total) * 100);
}

async function scoreBreachHistory(pool: Pool, orgId: number): Promise<number> {
  const { rows: [row] } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM breach_incidents
     WHERE organization_id = $1 AND created_at > NOW() - INTERVAL '1 year'`, [orgId]
  );
  if (row.cnt === 0) return 100;
  if (row.cnt <= 2) return 70;
  if (row.cnt <= 5) return 40;
  return 10;
}

async function scoreDpoAppointment(pool: Pool, orgId: number): Promise<number> {
  const { rows: [row] } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM dpo_appointments
     WHERE organization_id = $1 AND is_active = true`, [orgId]
  );
  return row.cnt > 0 ? 100 : 0;
}

async function scoreRopaCurrency(pool: Pool, orgId: number): Promise<number> {
  const { rows: [row] } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(CASE WHEN status = 'active' THEN 1 END)::int AS active,
            COUNT(CASE WHEN last_reviewed_at > NOW() - INTERVAL '1 year' THEN 1 END)::int AS current
     FROM ropa_records WHERE organization_id = $1`, [orgId]
  );
  if (row.total === 0) return 0;
  const activeRatio = row.active / row.total;
  const currencyRatio = row.current / row.total;
  return Math.round((activeRatio * 50 + currencyRatio * 50));
}

async function scoreConsentManagement(pool: Pool, orgId: number): Promise<number> {
  const { rows: [row] } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(CASE WHEN consent_status = 'active' THEN 1 END)::int AS active,
            COUNT(CASE WHEN consent_status = 'withdrawn' THEN 1 END)::int AS withdrawn,
            COUNT(CASE WHEN expires_at IS NOT NULL AND expires_at > NOW() THEN 1 END)::int AS valid_expiry
     FROM consent_records WHERE organization_id = $1`, [orgId]
  );
  if (row.total === 0) return 0;
  const activeRatio = row.active / row.total;
  const managedWithdrawals = row.withdrawn > 0 ? 1.0 : 0.5;
  const expiryManagement = row.total > 0 ? row.valid_expiry / row.total : 0;
  return Math.round((activeRatio * 40 + managedWithdrawals * 30 + expiryManagement * 30));
}

async function scoreTrainingCompletion(pool: Pool, orgId: number): Promise<number> {
  const { rows: [row] } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(CASE WHEN passed = true THEN 1 END)::int AS passed,
            COUNT(CASE WHEN expires_at IS NULL OR expires_at > NOW() THEN 1 END)::int AS current
     FROM staff_training_records WHERE organization_id = $1`, [orgId]
  );
  if (row.total === 0) return 0;
  const passRate = row.passed / row.total;
  const currentRate = row.current / row.total;
  return Math.round((passRate * 60 + currentRate * 40));
}

async function scoreDataRetention(pool: Pool, orgId: number): Promise<number> {
  const { rows: [row] } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(CASE WHEN is_active = true THEN 1 END)::int AS active,
            COUNT(CASE WHEN review_date IS NOT NULL AND review_date > NOW() THEN 1 END)::int AS reviewed
     FROM retention_policies WHERE organization_id = $1`, [orgId]
  );
  if (row.total === 0) return 0;
  const activeRatio = row.active / row.total;
  const reviewRatio = row.total > 0 ? row.reviewed / row.total : 0;
  return Math.round((activeRatio * 60 + reviewRatio * 40));
}

async function scorePrivacyNotices(pool: Pool, orgId: number): Promise<number> {
  const { rows: [row] } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(CASE WHEN status = 'published' OR privacy_notice_status = 'published' THEN 1 END)::int AS published,
            COUNT(CASE WHEN review_date IS NOT NULL AND review_date > NOW() - INTERVAL '1 year' THEN 1 END)::int AS reviewed
     FROM privacy_notices WHERE organization_id = $1`, [orgId]
  );
  if (row.total === 0) return 0;
  const publishedRatio = row.published / row.total;
  const reviewedRatio = row.total > 0 ? row.reviewed / row.total : 0;
  return Math.round((publishedRatio * 60 + reviewedRatio * 40));
}

export async function recalculateComplianceScore(orgId: number): Promise<ScoringResult> {
  const pool = getPool();
  const breakdown: ScoringResult["breakdown"] = {};

  const scores: Record<string, number> = {
    auditCompliance: await scoreAuditCompliance(pool, orgId),
    dpiaCompletion: await scoreDpiaCompletion(pool, orgId),
    ropaCurrency: await scoreRopaCurrency(pool, orgId),
    breachHistory: await scoreBreachHistory(pool, orgId),
    dpoAppointment: await scoreDpoAppointment(pool, orgId),
    consentManagement: await scoreConsentManagement(pool, orgId),
    trainingCompletion: await scoreTrainingCompletion(pool, orgId),
    dataRetention: await scoreDataRetention(pool, orgId),
    privacyNotices: await scorePrivacyNotices(pool, orgId),
  };

  let overallScore = 0;
  for (const [category, weight] of Object.entries(SCORING_WEIGHTS)) {
    const score = scores[category] ?? 0;
    const weighted = score * weight;
    overallScore += weighted;
    breakdown[category] = { score, weight, weighted };
  }

  overallScore = Math.round(overallScore);
  const grade = gradeFromScore(overallScore);

  // Save to database
  try {
    await pool.query(
      `UPDATE organizations SET compliance_score = $1, compliance_grade = $2, score_updated_at = NOW()
       WHERE id = $3`,
      [overallScore, grade, orgId]
    );
  } catch {
    // Column may not exist — non-critical
  }

  logger.info(
    { orgId, overallScore, grade },
    "[Scoring] Recalculated compliance score: %d (%s)",
    overallScore, grade
  );

  return {
    organizationId: orgId,
    overallScore,
    grade,
    breakdown,
    calculatedAt: new Date().toISOString(),
  };
}

export async function recalculateAllScores(): Promise<number> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT id FROM organizations WHERE compliance_status IS NOT NULL`);
  let count = 0;
  for (const row of rows) {
    await recalculateComplianceScore(row.id);
    count++;
  }
  logger.info({ count }, "[Scoring] Recalculated %d organization scores", count);
  return count;
}
