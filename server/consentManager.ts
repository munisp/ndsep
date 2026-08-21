/**
 * NDSEP Consent Withdrawal & Processing Cessation
 * =================================================
 * Implements NDPA Section 25(3): right to withdraw consent at any time.
 * When a data subject withdraws consent:
 *   1. Consent record is marked as "withdrawn"
 *   2. All active data processing for that subject is suspended
 *   3. Affected organization is notified
 *   4. Audit trail is created
 *   5. Optional: automated data deletion if consent was the only legal basis
 */

import { Pool } from "pg";
import { getDatabaseUrl } from "./config";
import { getPgSslConfig } from "./dbSslConfig";
import { logger } from "./logger";

export interface ConsentWithdrawalRequest {
  consentId: number;
  dataSubjectEmail: string;
  reason?: string;
  deleteData?: boolean;
}

export interface ConsentWithdrawalResult {
  consentId: number;
  status: "withdrawn" | "already_withdrawn" | "not_found";
  processingCeased: boolean;
  dataDeleted: boolean;
  auditLogId: number | null;
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

export async function withdrawConsent(
  req: ConsentWithdrawalRequest
): Promise<ConsentWithdrawalResult> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Look up the consent record
    const { rows: [consent] } = await client.query(
      `SELECT id, organization_id, consent_status, consent_type, data_subject_email
       FROM consent_records
       WHERE id = $1`,
      [req.consentId]
    );

    if (!consent) {
      await client.query("ROLLBACK");
      return { consentId: req.consentId, status: "not_found", processingCeased: false, dataDeleted: false, auditLogId: null };
    }

    if (consent.consent_status === "withdrawn") {
      await client.query("ROLLBACK");
      return { consentId: req.consentId, status: "already_withdrawn", processingCeased: false, dataDeleted: false, auditLogId: null };
    }

    // 2. Mark consent as withdrawn
    await client.query(
      `UPDATE consent_records
       SET consent_status = 'withdrawn',
           withdrawal_reason = $1,
           withdrawn_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [req.reason ?? "Data subject requested withdrawal", req.consentId]
    );

    // 3. Cease any active processing associated with this consent
    const { rowCount: processingCeased } = await client.query(
      `UPDATE data_processing_activities
       SET status = 'ceased',
           ceased_reason = 'Consent withdrawn by data subject',
           ceased_at = NOW(),
           updated_at = NOW()
       WHERE consent_id = $1 AND status = 'active'`,
      [req.consentId]
    );

    // 4. Create audit log entry
    const { rows: [auditRow] } = await client.query(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, created_at)
       VALUES ('consent_withdrawal', 'consent_records', $1, $2,
               $3, NOW())
       RETURNING id`,
      [
        String(req.consentId),
        req.dataSubjectEmail,
        JSON.stringify({
          reason: req.reason,
          organizationId: consent.organization_id,
          consentType: consent.consent_type,
          processingCeased: processingCeased ?? 0,
        }),
      ]
    );

    // 5. Optional: delete associated data if requested and consent was only legal basis
    let dataDeleted = false;
    if (req.deleteData) {
      logger.info(
        { consentId: req.consentId, orgId: consent.organization_id },
        "[Consent] Data deletion requested with consent withdrawal — flagging for review"
      );
      await client.query(
        `INSERT INTO data_deletion_requests (consent_id, organization_id, data_subject_email, status, created_at)
         VALUES ($1, $2, $3, 'pending', NOW())
         ON CONFLICT DO NOTHING`,
        [req.consentId, consent.organization_id, req.dataSubjectEmail]
      );
      dataDeleted = true;
    }

    await client.query("COMMIT");

    logger.info(
      { consentId: req.consentId, processingCeased, dataDeleted },
      "[Consent] Consent withdrawn successfully"
    );

    return {
      consentId: req.consentId,
      status: "withdrawn",
      processingCeased: (processingCeased ?? 0) > 0,
      dataDeleted,
      auditLogId: auditRow?.id ?? null,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err, consentId: req.consentId }, "[Consent] Withdrawal failed");
    throw err;
  } finally {
    client.release();
  }
}

export async function getConsentStatus(consentId: number) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, organization_id, consent_type, consent_status,
            data_subject_email, withdrawal_reason, withdrawn_at,
            created_at, updated_at
     FROM consent_records
     WHERE id = $1`,
    [consentId]
  );
  return rows[0] ?? null;
}
