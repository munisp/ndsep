/**
 * NDSEP Data Retention Policy Engine
 * =====================================
 * Enforces configurable data retention policies per data category.
 * Auto-purges expired data with audit trail.
 *
 * Recommendation M11: Configurable retention policies with auto-purge
 */

import { Pool } from "pg";
import { logger } from "./logger";
import { handleError } from "./errorClassifier";

export interface RetentionPolicy {
  category: string;
  tableName: string;
  retentionDays: number;
  dateColumn: string;
  purgeable: boolean;
  anonymizeOnly: boolean; // anonymize instead of delete for compliance
  description: string;
}

// Default retention policies based on NDPA requirements
export const DEFAULT_POLICIES: RetentionPolicy[] = [
  {
    category: "audit_logs",
    tableName: "audit_logs",
    retentionDays: 2555,  // 7 years (legal requirement)
    dateColumn: "created_at",
    purgeable: false,
    anonymizeOnly: true,
    description: "Audit logs retained for 7 years per NDPA S.42",
  },
  {
    category: "dsar_requests",
    tableName: "citizen_requests",
    retentionDays: 1095,  // 3 years
    dateColumn: "created_at",
    purgeable: false,
    anonymizeOnly: true,
    description: "DSAR records retained for 3 years for compliance verification",
  },
  {
    category: "breach_incidents",
    tableName: "breach_incidents",
    retentionDays: 2555,  // 7 years
    dateColumn: "created_at",
    purgeable: false,
    anonymizeOnly: true,
    description: "Breach records retained for 7 years per NDPC guidance",
  },
  {
    category: "session_data",
    tableName: "sessions",
    retentionDays: 90,
    dateColumn: "created_at",
    purgeable: true,
    anonymizeOnly: false,
    description: "Session data purged after 90 days",
  },
  {
    category: "form_drafts",
    tableName: "form_drafts",
    retentionDays: 30,
    dateColumn: "updated_at",
    purgeable: true,
    anonymizeOnly: false,
    description: "Unsaved form drafts purged after 30 days",
  },
  {
    category: "analytics_events",
    tableName: "analytics_events",
    retentionDays: 365,
    dateColumn: "created_at",
    purgeable: true,
    anonymizeOnly: false,
    description: "Analytics events purged after 1 year",
  },
  {
    category: "push_notification_log",
    tableName: "push_notification_log",
    retentionDays: 180,
    dateColumn: "sent_at",
    purgeable: true,
    anonymizeOnly: false,
    description: "Notification logs purged after 6 months",
  },
  {
    category: "webhook_deliveries",
    tableName: "webhook_deliveries",
    retentionDays: 90,
    dateColumn: "delivered_at",
    purgeable: true,
    anonymizeOnly: false,
    description: "Webhook delivery logs purged after 90 days",
  },
];

const RETENTION_LOG_TABLE = `
CREATE TABLE IF NOT EXISTS retention_purge_log (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  table_name TEXT NOT NULL,
  records_purged INTEGER NOT NULL,
  records_anonymized INTEGER DEFAULT 0,
  purged_at TIMESTAMPTZ DEFAULT NOW(),
  policy_days INTEGER NOT NULL
);
`;

export async function initRetentionPolicies(pool: Pool): Promise<void> {
  try {
    await pool.query(RETENTION_LOG_TABLE);
    logger.info("[Retention] Policy engine initialized with %d policies", DEFAULT_POLICIES.length);
  } catch (err) {
    handleError(err, { module: "dataRetention", action: "init" });
  }
}

/** Run retention policy enforcement (call via cron) */
export async function enforceRetentionPolicies(pool: Pool): Promise<{
  category: string;
  purged: number;
  anonymized: number;
}[]> {
  const results: { category: string; purged: number; anonymized: number }[] = [];

  for (const policy of DEFAULT_POLICIES) {
    try {
      const cutoffDate = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);

      if (policy.purgeable && !policy.anonymizeOnly) {
        // Hard delete
        const result = await pool.query(
          `DELETE FROM ${policy.tableName} WHERE ${policy.dateColumn} < $1`,
          [cutoffDate]
        );
        const purged = result.rowCount ?? 0;
        if (purged > 0) {
          await pool.query(
            `INSERT INTO retention_purge_log (category, table_name, records_purged, policy_days)
             VALUES ($1, $2, $3, $4)`,
            [policy.category, policy.tableName, purged, policy.retentionDays]
          );
          logger.info({ category: policy.category, purged }, "[Retention] Records purged");
        }
        results.push({ category: policy.category, purged, anonymized: 0 });
      } else if (policy.anonymizeOnly) {
        // Soft purge — anonymize PII but keep record structure
        // This is a no-op for now — would need per-table PII column mapping
        results.push({ category: policy.category, purged: 0, anonymized: 0 });
      }
    } catch (err) {
      handleError(err, { module: "dataRetention", category: policy.category });
      results.push({ category: policy.category, purged: 0, anonymized: 0 });
    }
  }

  return results;
}
