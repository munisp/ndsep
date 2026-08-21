/**
 * NDSEP Consent Proof Chain — Immutable Audit Trail for Consent Changes
 * ======================================================================
 * Creates hash-chained audit entries for every consent state change.
 * Required for NDPA compliance: organizations must prove consent lifecycle.
 *
 * Recommendation M12: Consent audit trail using existing hash-chain verification
 */

import crypto from "crypto";
import { Pool } from "pg";
import { logger } from "./logger";
import { handleError } from "./errorClassifier";

export type ConsentAction = "grant" | "modify" | "withdraw" | "expire" | "renew";

export interface ConsentAuditEntry {
  id: number;
  subjectId: string;
  consentType: string;
  action: ConsentAction;
  previousState: string | null;
  newState: string;
  legalBasis: string;
  ipAddress: string;
  userAgent: string;
  hash: string;
  previousHash: string | null;
  timestamp: Date;
}

const CONSENT_AUDIT_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS consent_audit_chain (
  id SERIAL PRIMARY KEY,
  subject_id TEXT NOT NULL,
  consent_type TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('grant', 'modify', 'withdraw', 'expire', 'renew')),
  previous_state TEXT,
  new_state TEXT NOT NULL,
  legal_basis TEXT DEFAULT 'consent',
  ip_address TEXT NOT NULL,
  user_agent TEXT DEFAULT '',
  hash TEXT NOT NULL,
  previous_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consent_audit_subject ON consent_audit_chain(subject_id);
CREATE INDEX IF NOT EXISTS idx_consent_audit_type ON consent_audit_chain(consent_type);
`;

export async function initConsentAuditChain(pool: Pool): Promise<void> {
  try {
    await pool.query(CONSENT_AUDIT_TABLE_SQL);
    logger.info("[ConsentAudit] Chain initialized");
  } catch (err) {
    handleError(err, { module: "consentAuditChain", action: "init" });
  }
}

/** Compute SHA-256 hash for a consent audit entry */
function computeEntryHash(entry: {
  subjectId: string; consentType: string; action: string;
  previousState: string | null; newState: string; previousHash: string | null;
  timestamp: string;
}): string {
  const payload = JSON.stringify({
    s: entry.subjectId,
    t: entry.consentType,
    a: entry.action,
    ps: entry.previousState,
    ns: entry.newState,
    ph: entry.previousHash,
    ts: entry.timestamp,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/** Record a consent change in the immutable audit chain */
export async function recordConsentChange(
  pool: Pool,
  params: {
    subjectId: string;
    consentType: string;
    action: ConsentAction;
    previousState: string | null;
    newState: string;
    legalBasis?: string;
    ipAddress: string;
    userAgent: string;
  }
): Promise<ConsentAuditEntry> {
  // Get the last entry's hash for chaining
  const lastEntry = await pool.query(
    `SELECT hash FROM consent_audit_chain WHERE subject_id = $1 AND consent_type = $2 ORDER BY id DESC LIMIT 1`,
    [params.subjectId, params.consentType]
  );
  const previousHash = lastEntry.rows.length > 0 ? lastEntry.rows[0].hash : null;

  const timestamp = new Date().toISOString();
  const hash = computeEntryHash({
    subjectId: params.subjectId,
    consentType: params.consentType,
    action: params.action,
    previousState: params.previousState,
    newState: params.newState,
    previousHash,
    timestamp,
  });

  const result = await pool.query(
    `INSERT INTO consent_audit_chain (subject_id, consent_type, action, previous_state, new_state, legal_basis, ip_address, user_agent, hash, previous_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [params.subjectId, params.consentType, params.action, params.previousState, params.newState,
     params.legalBasis ?? "consent", params.ipAddress, params.userAgent, hash, previousHash, timestamp]
  );

  logger.info({ subjectId: params.subjectId, action: params.action, consentType: params.consentType },
    "[ConsentAudit] Consent change recorded");

  return mapRow(result.rows[0]);
}

/** Verify the integrity of the consent chain for a subject */
export async function verifyConsentChain(
  pool: Pool,
  subjectId: string,
  consentType?: string
): Promise<{ valid: boolean; entries: number; brokenAt: number | null }> {
  const query = consentType
    ? `SELECT * FROM consent_audit_chain WHERE subject_id = $1 AND consent_type = $2 ORDER BY id ASC`
    : `SELECT * FROM consent_audit_chain WHERE subject_id = $1 ORDER BY id ASC`;
  const params = consentType ? [subjectId, consentType] : [subjectId];
  const result = await pool.query(query, params);

  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows[i];
    const expectedHash = computeEntryHash({
      subjectId: row.subject_id,
      consentType: row.consent_type,
      action: row.action,
      previousState: row.previous_state,
      newState: row.new_state,
      previousHash: row.previous_hash,
      timestamp: row.created_at.toISOString(),
    });

    if (row.hash !== expectedHash) {
      return { valid: false, entries: result.rows.length, brokenAt: i };
    }

    if (i > 0 && row.previous_hash !== result.rows[i - 1].hash) {
      return { valid: false, entries: result.rows.length, brokenAt: i };
    }
  }

  return { valid: true, entries: result.rows.length, brokenAt: null };
}

function mapRow(row: Record<string, unknown>): ConsentAuditEntry {
  return {
    id: row.id as number,
    subjectId: row.subject_id as string,
    consentType: row.consent_type as string,
    action: row.action as ConsentAction,
    previousState: row.previous_state as string | null,
    newState: row.new_state as string,
    legalBasis: row.legal_basis as string,
    ipAddress: row.ip_address as string,
    userAgent: row.user_agent as string,
    hash: row.hash as string,
    previousHash: row.previous_hash as string | null,
    timestamp: row.created_at as Date,
  };
}
