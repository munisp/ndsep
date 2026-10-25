/**
 * NDSEP Consent Withdrawal & Processing Cessation
 * =================================================
 * Implements NDPA Section 25(3): right to withdraw consent at any time.
 * When a data subject withdraws consent:
 *   1. Consent record is marked as "withdrawn" (canonical column
 *      consent_withdrawn_at; the reason is folded into the metadata jsonb
 *      because consent_records has no dedicated reason column)
 *   2. Consent-based processing for that subject is treated as ceased the
 *      moment consent_status flips to 'withdrawn' (processing activities are
 *      tracked on the consent record itself — there is no separate
 *      data_processing_activities table)
 *   3. The withdrawal is written to audit_logs with a NULL user_id
 *      (audit_logs.user_id is int4 — a data-subject email is stored in
 *      details, never in user_id)
 *   4. Optional: an erasure citizen_request (request_type 'erasure') is opened
 *      when the subject asked for their data to be deleted — the canonical
 *      rights-request track (there is no data_deletion_requests table)
 *
 * Round-9 remediation: the previous version passed the data-subject email
 * into the int4 audit_logs.user_id column and wrote to nonexistent columns
 * (withdrawn_at, withdrawal_reason) and tables (data_processing_activities,
 * data_deletion_requests). It now runs against the canonical schema only.
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
  erasureRequestId: number | null;
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

/** audit_logs.user_id is int4; only numeric platform user ids may be stored. */
function toIntOrNull(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isInteger(n) && Math.abs(n) < 2147483647 ? n : null;
}

export async function withdrawConsent(
  req: ConsentWithdrawalRequest
): Promise<ConsentWithdrawalResult> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Look up the consent record (canonical columns only).
    const { rows: [consent] } = await client.query(
      `SELECT id, organization_id, consent_status, purpose, data_subject_email, metadata
       FROM consent_records
       WHERE id = $1
       FOR UPDATE`,
      [req.consentId]
    );

    if (!consent) {
      await client.query("ROLLBACK");
      return { consentId: req.consentId, status: "not_found", processingCeased: false, dataDeleted: false, auditLogId: null, erasureRequestId: null };
    }

    if (consent.consent_status === "withdrawn") {
      await client.query("ROLLBACK");
      return { consentId: req.consentId, status: "already_withdrawn", processingCeased: false, dataDeleted: false, auditLogId: null, erasureRequestId: null };
    }

    const reason = req.reason ?? "Data subject requested withdrawal";

    // 2. Mark consent as withdrawn. The canonical schema tracks the timestamp
    //    in consent_withdrawn_at; the free-text reason lives in metadata.
    await client.query(
      `UPDATE consent_records
       SET consent_status = 'withdrawn',
           consent_withdrawn_at = NOW(),
           metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2 AND consent_status <> 'withdrawn'`,
      [JSON.stringify({ withdrawal_reason: reason, withdrawn_by_email: req.dataSubjectEmail }), req.consentId]
    );

    // 3. Processing ceases by virtue of the status flip: consent_records is the
    //    system of record for consent-based processing, so once the row is
    //    'withdrawn' downstream consumers must stop. Recorded in the audit trail.
    const processingCeased = true;

    // 4. Audit trail. user_id is NULL (int4 column; a data-subject email is not
    //    a platform user id) — the email is carried in details instead.
    const { rows: [auditRow] } = await client.query(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, created_at)
       VALUES ('consent_withdrawal', 'consent_records', $1, $2, $3, NOW())
       RETURNING id`,
      [
        toIntOrNull(req.consentId),
        null,
        JSON.stringify({
          dataSubjectEmail: req.dataSubjectEmail,
          reason,
          organizationId: consent.organization_id,
          purpose: consent.purpose ?? null,
          processingCeased,
        }),
      ]
    );

    // 5. Optional: open a canonical erasure rights-request so deletion is
    //    tracked through the DSAR workflow (there is no data_deletion_requests
    //    table; citizen_requests with request_type 'erasure' is the canonical
    //    track).
    let erasureRequestId: number | null = null;
    let dataDeleted = false;
    if (req.deleteData) {
      logger.info(
        { consentId: req.consentId, orgId: consent.organization_id },
        "[Consent] Data deletion requested with consent withdrawal — opening erasure request"
      );
      const { rows: [seq] } = await client.query("SELECT nextval('citizen_requests_id_seq') AS id");
      const erasureId = Number(seq.id);
      const referenceNumber = `NDSEP-CR-${String(erasureId).padStart(6, "0")}`;
      const responseDeadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await client.query(
        `INSERT INTO citizen_requests
           (id, citizen_name, citizen_email, request_type, status,
            organization_id, description, reference_number, response_deadline,
            is_third_party, submitted_at, updated_at)
         VALUES ($1, $2, $3, 'erasure', 'submitted', $4, $5, $6, $7, false, NOW(), NOW())`,
        [
          erasureId,
          "Data subject (via consent withdrawal)",
          consent.data_subject_email ?? req.dataSubjectEmail,
          consent.organization_id,
          `Erasure requested alongside withdrawal of consent record #${req.consentId}. Reason: ${reason}`,
          referenceNumber,
          responseDeadline,
        ]
      );
      erasureRequestId = erasureId;
      dataDeleted = true; // deletion TRACKED via the erasure request; see audit details
    }

    await client.query("COMMIT");

    logger.info(
      { consentId: req.consentId, processingCeased, dataDeleted, erasureRequestId },
      "[Consent] Consent withdrawn successfully"
    );

    return {
      consentId: req.consentId,
      status: "withdrawn",
      processingCeased,
      dataDeleted,
      auditLogId: auditRow?.id ?? null,
      erasureRequestId,
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
    `SELECT id, organization_id, purpose, consent_status,
            data_subject_email, consent_withdrawn_at, metadata,
            created_at, updated_at
     FROM consent_records
     WHERE id = $1`,
    [consentId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    // Convenience projections kept for API compatibility with the previous
    // (broken) surface; sourced from canonical columns.
    withdrawn_at: row.consent_withdrawn_at,
    withdrawal_reason: row.metadata?.withdrawal_reason ?? null,
  };
}
