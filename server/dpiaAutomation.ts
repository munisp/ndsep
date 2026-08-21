/**
 * NDSEP DPIA Mandatory Trigger Automation
 * =========================================
 * Implements NDPA Section 39 — automatically triggers a DPIA when:
 *   1. New high-risk processing activity is registered
 *   2. Processing involves large-scale monitoring
 *   3. Processing involves sensitive personal data
 *   4. New technology is introduced for processing
 *   5. Cross-border transfer to non-adequate country
 *
 * Trigger evaluation runs on:
 *   - New data processing activity creation
 *   - Existing activity modification
 *   - Organization risk level change
 */

import { Pool } from "pg";
import { getDatabaseUrl } from "./config";
import { getPgSslConfig } from "./dbSslConfig";
import { logger } from "./logger";

export interface DpiaTrigger {
  triggered: boolean;
  reason: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  processingActivityId?: number;
  organizationId: number;
}

const HIGH_RISK_CATEGORIES = [
  "biometric_data",
  "health_data",
  "genetic_data",
  "criminal_records",
  "children_data",
  "financial_data",
  "location_tracking",
  "profiling",
  "automated_decisions",
  "large_scale_monitoring",
  "systematic_monitoring",
  "cross_border_transfer",
];

let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: getDatabaseUrl(), ssl: getPgSslConfig(), max: 3 });
  }
  return _pool;
}

export async function evaluateDpiaTriggers(
  orgId: number,
  processingCategories: string[],
  dataSubjectCount: number,
  isNewTechnology: boolean = false,
  destinationCountry?: string
): Promise<DpiaTrigger> {
  const triggers: string[] = [];

  // Rule 1: High-risk data categories
  const highRiskMatches = processingCategories.filter(c => HIGH_RISK_CATEGORIES.includes(c));
  if (highRiskMatches.length > 0) {
    triggers.push(`High-risk data categories: ${highRiskMatches.join(", ")}`);
  }

  // Rule 2: Large-scale processing (> 10,000 data subjects)
  if (dataSubjectCount > 10000) {
    triggers.push(`Large-scale processing: ${dataSubjectCount.toLocaleString()} data subjects`);
  }

  // Rule 3: New technology
  if (isNewTechnology) {
    triggers.push("New technology introduction for data processing");
  }

  // Rule 4: Cross-border to non-adequate country
  if (destinationCountry) {
    const { validateCrossBorderTransfer } = await import("./crossBorderTransfer");
    const validation = await validateCrossBorderTransfer(orgId, destinationCountry);
    if (!validation.checks.adequacyCountry) {
      triggers.push(`Cross-border transfer to non-adequate country: ${destinationCountry}`);
    }
  }

  // Rule 5: Multiple risk factors combined
  if (triggers.length >= 2) {
    triggers.push("Multiple risk factors present — mandatory DPIA");
  }

  const triggered = triggers.length > 0;
  const riskLevel = triggers.length >= 3 ? "critical" : triggers.length >= 2 ? "high" : triggers.length === 1 ? "medium" : "low";

  if (triggered) {
    // Auto-create DPIA record
    const pool = getPool();
    try {
      const { rows: [existing] } = await pool.query(
        `SELECT id FROM dpia_records
         WHERE organization_id = $1 AND status IN ('draft', 'in_progress')
         LIMIT 1`,
        [orgId]
      );

      if (!existing) {
        await pool.query(
          `INSERT INTO dpia_records (organization_id, status, risk_level, triggers, created_at, updated_at)
           VALUES ($1, 'draft', $2, $3, NOW(), NOW())`,
          [orgId, riskLevel, JSON.stringify(triggers)]
        );
        logger.info({ orgId, triggers, riskLevel }, "[DPIA] Auto-triggered DPIA creation");
      }
    } catch (err) {
      logger.warn({ err, orgId }, "[DPIA] Failed to auto-create DPIA record");
    }
  }

  return { triggered, reason: triggers.join("; "), riskLevel, organizationId: orgId };
}
