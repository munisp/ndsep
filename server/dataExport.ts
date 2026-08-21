/**
 * NDSEP Data Export / Portability (NDPA Section 36)
 * ==================================================
 * Implements the right to data portability: data subjects can request
 * a machine-readable export of all their personal data.
 *
 * Export formats: JSON (default), CSV
 * Includes: consent records, DSAR history, processing activities,
 *           breach notifications, and any PII stored.
 */

import { Pool } from "pg";
import { getDatabaseUrl } from "./config";
import { getPgSslConfig } from "./dbSslConfig";
import { logger } from "./logger";

export interface DataExportRequest {
  subjectEmail: string;
  format: "json" | "csv";
  includeMetadata?: boolean;
}

export interface DataExportResult {
  subjectEmail: string;
  format: "json" | "csv";
  sections: string[];
  totalRecords: number;
  data: string;
  exportedAt: string;
}

let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: getDatabaseUrl(),
      ssl: getPgSslConfig(),
      max: 3,
    });
  }
  return _pool;
}

export async function exportSubjectData(
  req: DataExportRequest
): Promise<DataExportResult> {
  const pool = getPool();
  const sections: string[] = [];
  const allData: Record<string, unknown[]> = {};
  let totalRecords = 0;

  // 1. DSAR requests
  const dsars = await pool.query(
    `SELECT id, reference_number, request_type, status, submitted_at,
            response_deadline, completed_at, response_notes
     FROM citizen_requests
     WHERE citizen_email = $1
     ORDER BY submitted_at DESC`,
    [req.subjectEmail]
  );
  if (dsars.rows.length > 0) {
    allData.dsar_requests = dsars.rows;
    sections.push("dsar_requests");
    totalRecords += dsars.rows.length;
  }

  // 2. Consent records
  const consents = await pool.query(
    `SELECT id, organization_id, consent_type, consent_status,
            purpose, legal_basis, granted_at, withdrawn_at,
            created_at, updated_at
     FROM consent_records
     WHERE data_subject_email = $1
     ORDER BY created_at DESC`,
    [req.subjectEmail]
  );
  if (consents.rows.length > 0) {
    allData.consent_records = consents.rows;
    sections.push("consent_records");
    totalRecords += consents.rows.length;
  }

  // 3. Breach notifications (where subject was affected)
  const breaches = await pool.query(
    `SELECT b.id, b.title, b.breach_incident_severity, b.breach_incident_status,
            b.discovered_date, b.reported_date, b.affected_data_types
     FROM breach_incidents b
     INNER JOIN breach_affected_subjects bas ON b.id = bas.breach_id
     WHERE bas.subject_email = $1
     ORDER BY b.discovered_date DESC`,
    [req.subjectEmail]
  );
  if (breaches.rows.length > 0) {
    allData.breach_notifications = breaches.rows;
    sections.push("breach_notifications");
    totalRecords += breaches.rows.length;
  }

  // 4. Audit trail (actions by/about this subject)
  const auditLogs = await pool.query(
    `SELECT id, action, resource_type, resource_id, created_at
     FROM audit_logs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 500`,
    [req.subjectEmail]
  );
  if (auditLogs.rows.length > 0) {
    allData.audit_trail = auditLogs.rows;
    sections.push("audit_trail");
    totalRecords += auditLogs.rows.length;
  }

  // 5. Portal submissions
  const submissions = await pool.query(
    `SELECT id, submission_type, status, submitted_at, response_at
     FROM portal_submissions
     WHERE contact_email = $1
     ORDER BY submitted_at DESC`,
    [req.subjectEmail]
  );
  if (submissions.rows.length > 0) {
    allData.portal_submissions = submissions.rows;
    sections.push("portal_submissions");
    totalRecords += submissions.rows.length;
  }

  if (req.includeMetadata) {
    allData._metadata = [{
      exportedAt: new Date().toISOString(),
      subjectEmail: req.subjectEmail,
      format: req.format,
      sections,
      totalRecords,
      platform: "NDSEP",
      legalBasis: "NDPA Section 36 — Right to Data Portability",
    }];
  }

  let data: string;
  if (req.format === "csv") {
    data = convertToCsv(allData);
  } else {
    data = JSON.stringify(allData, null, 2);
  }

  logger.info(
    { subjectEmail: req.subjectEmail, sections, totalRecords },
    "[DataExport] Exported %d records across %d sections",
    totalRecords, sections.length
  );

  return {
    subjectEmail: req.subjectEmail,
    format: req.format,
    sections,
    totalRecords,
    data,
    exportedAt: new Date().toISOString(),
  };
}

function convertToCsv(allData: Record<string, unknown[]>): string {
  const lines: string[] = [];

  for (const [section, rows] of Object.entries(allData)) {
    if (rows.length === 0) continue;
    lines.push(`# Section: ${section}`);

    const headers = Object.keys(rows[0] as Record<string, unknown>);
    lines.push(headers.map(h => `"${h}"`).join(","));

    for (const row of rows) {
      const r = row as Record<string, unknown>;
      const values = headers.map(h => {
        const v = r[h];
        if (v === null || v === undefined) return "";
        return `"${String(v).replace(/"/g, '""')}"`;
      });
      lines.push(values.join(","));
    }
    lines.push("");
  }

  return lines.join("\n");
}
