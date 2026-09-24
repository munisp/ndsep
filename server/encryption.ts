/**
 * NDSEP Field-Level Encryption (AES-256-GCM)
 * =============================================
 * Provides application-layer encryption for PII columns stored in PostgreSQL.
 * Uses AES-256-GCM with per-value random IVs for authenticated encryption.
 *
 * Environment:
 *   FIELD_ENCRYPTION_KEY — 64-char hex string (32 bytes). Generate with:
 *     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Encrypted values are stored as:  enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 * This prefix allows the system to detect whether a value is already encrypted.
 */

import crypto from "crypto";
import { getDataEncryptionKey, initializeKms } from "./kms";
import { logger } from "./logger";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM recommended IV length
const TAG_BYTES = 16;
const PREFIX = "enc:v1:";

/**
 * Initialize encryption subsystem.
 * Attempts KMS-based key retrieval first, falls back to FIELD_ENCRYPTION_KEY env var.
 * Call once at application startup.
 */
export async function initializeEncryption(): Promise<void> {
  try {
    await initializeKms();
  } catch (err) {
    // KMS initialization failed — fall back to local key
    const hex = process.env.FIELD_ENCRYPTION_KEY ?? "";
    if (hex.length === 64) {
      logger.info("[Encryption] KMS unavailable, using FIELD_ENCRYPTION_KEY fallback");
    } else {
      logger.warn("[Encryption] No encryption key available — PII will be stored in plaintext");
    }
  }
}

function getKey(): Buffer {
  // Try KMS-managed key first
  try {
    return getDataEncryptionKey();
  } catch {
    // Fall back to direct env var
    const hex = process.env.FIELD_ENCRYPTION_KEY ?? "";
    if (hex.length !== 64) {
      throw new Error(
        "[Encryption] No encryption key available. Configure KMS_PROVIDER or FIELD_ENCRYPTION_KEY."
      );
    }
    return Buffer.from(hex, "hex");
  }
}

/**
 * Check if the encryption key is configured.
 * Returns false in development when no key is set (graceful degradation).
 */
export function isEncryptionEnabled(): boolean {
  const hex = process.env.FIELD_ENCRYPTION_KEY ?? "";
  return hex.length === 64;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns the encrypted string in the format: enc:v1:<iv>:<tag>:<ciphertext>
 * If encryption is not configured, returns the plaintext unchanged.
 */
export function encryptField(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === "") return plaintext as string | null;
  if (!isEncryptionEnabled()) return plaintext;
  if (isEncrypted(plaintext)) return plaintext; // already encrypted

  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt an encrypted string back to plaintext.
 * If the value is not encrypted (no prefix), returns it as-is.
 * If encryption is not configured, returns the value as-is.
 */
export function decryptField(encrypted: string | null | undefined): string | null {
  if (encrypted == null || encrypted === "") return encrypted as string | null;
  if (!isEncrypted(encrypted)) return encrypted; // not encrypted, return as-is
  if (!isEncryptionEnabled()) {
    // Key not available — return the raw encrypted string
    // This prevents data loss but values will be unreadable
    return encrypted;
  }

  try {
    const payload = encrypted.slice(PREFIX.length);
    const parts = payload.split(":");
    if (parts.length !== 3) return encrypted;

    const [ivHex, tagHex, ciphertextHex] = parts;
    const key = getKey();
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const ciphertext = Buffer.from(ciphertextHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (err) {
    // If decryption fails (wrong key, corrupted data), return null to prevent data leaks
    logger.error("[Encryption] Decryption failed — possible key mismatch or data corruption");
    return null;
  }
}

/**
 * Check if a value is already encrypted (has the enc:v1: prefix).
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

// ─── PII Field Definitions ──────────────────────────────────────────────────

/**
 * Map of table names to their PII columns that should be encrypted.
 * Used by the encryption middleware and migration scripts.
 */
export const PII_FIELDS: Record<string, string[]> = {
  users: ["email", "name"],
  organizations: ["contact_email"],
  portal_submissions: ["contact_name", "contact_email", "contact_phone"],
  citizen_requests: ["citizen_email", "citizen_nin"],
  breach_incidents: ["data_subject_email", "data_subject_nin"],
  dpo_appointments: ["dpo_email", "dpo_phone"],
  compliance_audit_returns: ["dpo_contact_info"],
  automated_decision_records: ["data_subject_email"],
  parental_consent_records: ["parent_email"],
  data_export_jobs: ["data_subject_email"],
  dpco_registrations: ["email", "phone", "dpo_email", "contact_name", "contact_email", "contact_phone"],
  dpco_clients: ["contact_name", "contact_email", "contact_phone"],
  dpco_licensed_firms: ["email", "phone"],
  // ── Feature-router PII (migrations 0031–0054) ──
  // Whistleblower channel message bodies (gap 7 / migration 0040).
  whistleblower_messages: ["body"],
  // DSAR third-party / deceased-subject representatives (migration 0031).
  dsar_third_party_submissions: ["representative_name", "representative_email", "representative_phone"],
  dsar_deceased_subjects: ["deceased_name", "executor_name", "executor_contact"],
  // DPO marketplace contact identities (migration 0042).
  dpo_marketplace_profiles: ["email", "phone"],
  marketplace_engagements: ["contact_email"],
  // Public sanctions register delisting applicants (migration 0050).
  delisting_requests: ["applicant_name", "applicant_email"],
  // FOIA requester identities (migration 0051).
  foia_requests: ["requester_name", "requester_email", "requester_phone"],
  // Election-oversight reporter identities (migration 0052).
  political_microtargeting_reports: ["reporter_name", "reporter_email"],
  // AI-incident reporter identities (migration 0053).
  ai_incidents: ["reporter_name", "reporter_email"],
  // Consent-propagation data-subject references + processor contacts (migration 0054).
  withdrawal_events: ["subject_ref"],
  downstream_processors: ["contact_email"],
  // ── Round-8 feature-router PII (migrations 0081–0096) ──
  // Public complaints channel (migration 0081).
  public_complaints: ["complainant_name", "complainant_email", "complainant_phone", "description", "submitter_ip_hash"],
  // Compliance scanning officer identities (migration 0083).
  scan_targets: ["created_by"],
  scan_runs: ["created_by"],
  scan_artifacts: ["attested_by"],
  scan_findings: ["resolved_by"],
  scan_suppressions: ["requested_by", "approved_by"],
  // Policy monitor officer identities (migration 0084).
  monitored_policies: ["created_by"],
  policy_reviews: ["assigned_to", "assigned_by", "decided_by", "escalated_by", "controller_notified_by", "created_by"],
  // Tribunal bundle officer/accessor identities (migration 0085).
  tribunal_bundles: ["assembled_by", "sealed_by", "export_requested_by", "export_first_approver", "export_second_approver", "manifest"],
  bundle_artifacts: ["metadata"],
  bundle_access_log: ["accessor"],
  // Settlement workflow counterparty + officer identities (migration 0086).
  settlements: ["proposed_by", "respondent_name", "respondent_email", "reduction_legal_basis"],
  settlement_terms: ["proposed_by", "transparency_rationale"],
  settlement_approvals: ["approver"],
  // Revenue verification attestation identities (migration 0087).
  verified_revenues: ["attestation", "verifier", "created_by", "external_ref"],
  integration_credentials_audit: ["actor", "credential_fingerprint"],
  penalty_computations: ["computed_by"],
  // Supervision risk officer identities (migration 0088).
  supervision_plans: ["generated_by", "approved_by"],
  supervision_plan_items: ["assigned_team", "referred_by"],
  risk_scores: ["computed_by"],
  risk_weights: ["updated_by"],
  // Cross-border transfer declarations (migration 0089).
  transfer_declarations: ["processors", "submitted_by"],
  declaration_amendments: ["prior_state", "amended_by"],
  transfer_findings: ["evidence", "resolved_by", "created_by"],
  // Publication workbench unredacted text + redaction keys (migration 0090).
  publication_documents: ["body_raw", "summary", "title", "org_name", "created_by"],
  redaction_tasks: ["redaction_map", "minor_names_applied", "reviewer_id", "created_by"],
  publication_approvals: ["approver_id", "approver_name"],
  disclosure_access_log: ["accessor_id"],
  // Reg-intel legal query text + asker/officer identities (migration 0091).
  legal_queries: ["question", "asked_by"],
  legal_instruments: ["created_by"],
  legal_versions: ["created_by"],
  rule_legal_references: ["created_by"],
  // USSD/SMS channel pseudonymous subscriber identifiers (migration 0092).
  ussd_sessions: ["msisdn_hmac", "msisdn_last4", "payload"],
  ussd_intake_queue: ["msisdn_hmac", "msisdn_last4", "description"],
  sms_outbox: ["msisdn_hmac", "msisdn_last4", "message"],
  // NIN identity verification pseudonymous identifiers (migration 0093).
  identity_verifications: ["nin_hmac", "verification_token", "subject_ref"],
  verification_audit_log: ["actor", "subject_ref", "details"],
  // Data sovereignty officer identities (migrations 0094–0096).
  hosting_declarations: ["submitted_by", "reviewed_by", "admin_access_locations"],
  residency_attestations: ["attesting_officer_name", "attesting_officer_title", "revoked_by"],
  residency_violations: ["acknowledged_by", "resolved_by", "details"],
  cross_regulator_referrals: ["referred_by", "received_by", "case_summary"],
  egress_thresholds: ["updated_by"],
  asn_geo_reference: ["created_by"],
  sovereignty_scores: ["computed_by"],
};

/**
 * Encrypt all PII fields in a row object for a given table.
 * Non-PII fields are left unchanged.
 */
export function encryptRow<T extends Record<string, unknown>>(tableName: string, row: T): T {
  const fields = PII_FIELDS[tableName];
  if (!fields || !isEncryptionEnabled()) return row;

  const encrypted = { ...row };
  for (const field of fields) {
    const value = encrypted[field];
    if (typeof value === "string") {
      (encrypted as Record<string, unknown>)[field] = encryptField(value);
    }
  }
  return encrypted;
}

/**
 * Decrypt all PII fields in a row object for a given table.
 * Non-PII fields are left unchanged.
 */
export function decryptRow<T extends Record<string, unknown>>(tableName: string, row: T): T {
  const fields = PII_FIELDS[tableName];
  if (!fields || !isEncryptionEnabled()) return row;

  const decrypted = { ...row };
  for (const field of fields) {
    const value = decrypted[field];
    if (typeof value === "string") {
      (decrypted as Record<string, unknown>)[field] = decryptField(value);
    }
  }
  return decrypted;
}

/**
 * Decrypt all PII fields in an array of rows.
 */
export function decryptRows<T extends Record<string, unknown>>(tableName: string, rows: T[]): T[] {
  if (!isEncryptionEnabled()) return rows;
  return rows.map(row => decryptRow(tableName, row));
}

// ─── Key Rotation Support ────────────────────────────────────────────────────

/**
 * Re-encrypt a value with a new key. Used during key rotation.
 * Decrypts with the old key and encrypts with the new key.
 */
export function reEncryptField(
  encrypted: string | null | undefined,
  oldKeyHex: string,
  newKeyHex: string
): string | null {
  if (encrypted == null || encrypted === "" || !isEncrypted(encrypted)) return encrypted as string | null;

  // Decrypt with old key
  const payload = encrypted.slice(PREFIX.length);
  const parts = payload.split(":");
  if (parts.length !== 3) return encrypted;

  const [ivHex, tagHex, ciphertextHex] = parts;
  const oldKey = Buffer.from(oldKeyHex, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, oldKey, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");

  // Re-encrypt with new key
  const newKey = Buffer.from(newKeyHex, "hex");
  const newIv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, newKey, newIv);
  const newEncrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const newTag = cipher.getAuthTag();

  return `${PREFIX}${newIv.toString("hex")}:${newTag.toString("hex")}:${newEncrypted.toString("hex")}`;
}
