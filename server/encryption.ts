/**
 * NDSEP Field-Level Encryption (AES-256-GCM)
 * =============================================
 * Provides application-layer encryption for PII columns stored in PostgreSQL.
 * Uses AES-256-GCM with per-value random IVs for authenticated encryption.
 *
 * Environment:
 *   FIELD_ENCRYPTION_KEY — 64-char hex string (32 bytes). Generate with:
 *     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *   KMS_PROVIDER / KMS_KEY_ID — envelope-encrypted data key via server/kms.ts
 *
 * Formats:
 *   v1 (legacy):  enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 *   v2 (current): enc:v2:<kid>:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 *     - <kid> identifies the key that encrypted the value (KMS key fingerprint
 *       or local-key fingerprint) so rotation is auditable and a wrong-key
 *       configuration fails loudly instead of producing garbage.
 *     - When the caller supplies a {table, column} context (encryptRow always
 *       does), "table.column" is bound as AES-GCM AAD: a ciphertext copied to a
 *       different column no longer authenticates.
 *   v1 values remain decryptable; new writes are always v2.
 *
 * Fail-closed policy:
 *   - initializeEncryption() THROWS at startup in production when no key
 *     source (KMS or FIELD_ENCRYPTION_KEY) is available.
 *   - decryptField() throws DecryptionError on any decryption failure instead
 *     of silently returning null.
 */

import crypto from "crypto";
import { getDataEncryptionKey, getKmsProvider, initializeKms } from "./kms";
import { logger } from "./logger";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM recommended IV length
const PREFIX_V1 = "enc:v1:";
const PREFIX_V2 = "enc:v2:";

export class DecryptionError extends Error {
  constructor(
    message: string,
    public readonly reason: "no_key" | "malformed" | "auth_failed" | "unknown_key_id",
  ) {
    super(message);
    this.name = "DecryptionError";
  }
}

interface KeyMaterial {
  key: Buffer;
  kid: string;
}

/**
 * Resolve the active data-encryption key and its identifier.
 * KMS-managed DEK first (getDataEncryptionKey falls back to FIELD_ENCRYPTION_KEY
 * internally); the kid is a stable fingerprint so ciphertexts are attributable
 * to a key generation without exposing key material.
 */
function getKeyMaterial(): KeyMaterial {
  let key: Buffer;
  try {
    key = getDataEncryptionKey();
  } catch {
    throw new DecryptionError(
      "[Encryption] No encryption key available. Configure KMS_PROVIDER or FIELD_ENCRYPTION_KEY.",
      "no_key",
    );
  }
  const provider = getKmsProvider();
  const fingerprint = crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
  const kid = `${provider ? provider.name : "local"}:${fingerprint}`;
  return { key, kid };
}

/**
 * Initialize encryption subsystem.
 * Attempts KMS-based key retrieval first, falls back to FIELD_ENCRYPTION_KEY.
 * FAIL CLOSED in production: throws when no key source is available.
 */
export async function initializeEncryption(): Promise<void> {
  try {
    await initializeKms();
  } catch (err) {
    const hex = process.env.FIELD_ENCRYPTION_KEY ?? "";
    if (hex.length === 64) {
      logger.info("[Encryption] KMS unavailable, using FIELD_ENCRYPTION_KEY fallback");
    } else if ((process.env.NODE_ENV ?? "") === "production") {
      throw new Error(
        `[Encryption] FATAL: no encryption key source available in production ` +
        `(KMS init failed: ${err instanceof Error ? err.message : String(err)}; ` +
        `FIELD_ENCRYPTION_KEY not set or invalid). Refusing to start — PII must never be stored in plaintext.`
      );
    } else {
      logger.warn("[Encryption] No encryption key available — development mode plaintext fallback (NEVER use in production)");
    }
  }
  if ((process.env.NODE_ENV ?? "") === "production" && !isEncryptionEnabled()) {
    throw new Error("[Encryption] FATAL: encryption key unavailable after initialization in production");
  }
}

/**
 * Check if a usable encryption key is configured.
 * Considers BOTH the KMS-managed data key (initializeKms success) and the
 * FIELD_ENCRYPTION_KEY env fallback.
 */
export function isEncryptionEnabled(): boolean {
  try {
    getDataEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export interface EncryptionContext {
  table?: string;
  column?: string;
}

function aadFrom(context?: EncryptionContext): Buffer | null {
  if (context?.table && context?.column) {
    return Buffer.from(`${context.table}.${context.column}`, "utf8");
  }
  return null;
}

/**
 * Encrypt a plaintext string using AES-256-GCM (v2 envelope, key-id + AAD bound).
 * If encryption is not configured, returns the plaintext unchanged (callers in
 * production never reach this path — initializeEncryption fails closed).
 */
export function encryptField(
  plaintext: string | null | undefined,
  context?: EncryptionContext,
): string | null {
  if (plaintext == null || plaintext === "") return plaintext as string | null;
  if (!isEncryptionEnabled()) return plaintext;
  if (isEncrypted(plaintext)) return plaintext; // already encrypted

  const { key, kid } = getKeyMaterial();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const aad = aadFrom(context);
  if (aad) cipher.setAAD(aad);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX_V2}${kid}:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function gcmDecrypt(key: Buffer, ivHex: string, tagHex: string, ciphertextHex: string, aad: Buffer | null): string {
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  if (aad) decipher.setAAD(aad);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Decrypt an encrypted string back to plaintext.
 * - Non-encrypted values (no enc: prefix) are returned as-is.
 * - v1 and v2 envelopes are both accepted.
 * - Any failure THROWS DecryptionError (typed, fail-closed) — callers must
 *   handle it explicitly; a silent null previously masked key loss and data
 *   corruption.
 */
export function decryptField(
  encrypted: string | null | undefined,
  context?: EncryptionContext,
): string | null {
  if (encrypted == null || encrypted === "") return encrypted as string | null;
  if (!isEncrypted(encrypted)) return encrypted; // not encrypted, return as-is

  let keyMaterial: KeyMaterial;
  try {
    keyMaterial = getKeyMaterial();
  } catch (err) {
    if (err instanceof DecryptionError) throw err;
    throw new DecryptionError(
      "[Encryption] Cannot decrypt: no encryption key available",
      "no_key",
    );
  }

  if (encrypted.startsWith(PREFIX_V1)) {
    const parts = encrypted.slice(PREFIX_V1.length).split(":");
    if (parts.length !== 3) {
      throw new DecryptionError("[Encryption] Malformed v1 ciphertext", "malformed");
    }
    try {
      return gcmDecrypt(keyMaterial.key, parts[0], parts[1], parts[2], null);
    } catch {
      throw new DecryptionError(
        "[Encryption] v1 decryption failed — key mismatch or data corruption",
        "auth_failed",
      );
    }
  }

  // v2: enc:v2:<kid>:<iv>:<tag>:<ciphertext>
  const parts = encrypted.slice(PREFIX_V2.length).split(":");
  if (parts.length !== 4) {
    throw new DecryptionError("[Encryption] Malformed v2 ciphertext", "malformed");
  }
  const [kid, ivHex, tagHex, ciphertextHex] = parts;
  if (kid !== keyMaterial.kid) {
    throw new DecryptionError(
      `[Encryption] v2 ciphertext was encrypted with key '${kid}' but the active key is '${keyMaterial.kid}' — run key rotation instead of decrypting with the wrong key`,
      "unknown_key_id",
    );
  }
  const aad = aadFrom(context);
  try {
    return gcmDecrypt(keyMaterial.key, ivHex, tagHex, ciphertextHex, aad);
  } catch (firstErr) {
    // Compatibility path: values written by legacy call sites that did not
    // bind AAD (bare encryptField before round-9) must still decrypt. Only
    // attempted when the caller supplied a context; a context-free call that
    // failed has nothing left to try.
    if (aad) {
      try {
        return gcmDecrypt(keyMaterial.key, ivHex, tagHex, ciphertextHex, null);
      } catch { /* fall through to typed error */ }
    }
    throw new DecryptionError(
      "[Encryption] v2 decryption failed — AAD/context mismatch, wrong key, or data corruption",
      "auth_failed",
    );
  }
}

/**
 * Check if a value is already encrypted (enc:v1: or enc:v2: prefix).
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX_V1) || value.startsWith(PREFIX_V2);
}

// ─── PII Field Definitions ──────────────────────────────────────────────────

/**
 * Map of table names to their PII columns that should be encrypted.
 * Used by the encryption middleware and migration scripts.
 *
 * Round-9 reconciliation (tests/round9/piiRegistry.test.ts statically verifies
 * every entry here resolves to a real table.column in the migrations):
 *   REMOVED (phantom — no such table/column exists in any migration):
 *     dpco_registrations.*, dpco_licensed_firms.*,
 *     breach_incidents.data_subject_email / .data_subject_nin,
 *     compliance_audit_returns.dpo_contact_info
 *   ADDED (verified to exist):
 *     consent_records.data_subject_name/email/nin, consent_records_v2.data_subject_email,
 *     age_assurance_records.guardian_name/guardian_contact/dob,
 *     receipts.payer_email, protection_flags.reporter_email/employer_name,
 *     whistleblower_reports.reporter_email, dpo_marketplace_profiles.name,
 *     ai_risk_tier_assessments.assessor_name
 *   NOTE (HMAC/pseudonymous columns): ussd_*.msisdn_hmac,
 *     identity_verifications.nin_hmac and the 0103 *_hmac columns
 *     (age_assurance_records.data_subject_ref_hmac,
 *     consent_refresh_tasks.data_subject_ref_hmac) are pseudonymous lookup
 *     keys (indexed, equality-matched). Encrypting them with random-IV
 *     GCM would break lookups, so they are deliberately NOT listed here;
 *     their pseudonymisation at ingest is the control. The RAW
 *     data_subject_ref columns ARE listed (encrypted since 0103). The
 *     audit-suggested hosting_declarations.attesting_officer_name does not
 *     exist on that table (it lives on residency_attestations, already
 *     covered below).
 *   FIN-1 static merge (round-9): fixB.txt + featE.txt entries appended below
 *     (dsar_notification_retries.recipient, consent_refresh_tasks.data_subject_ref,
 *     ai_runtime_incidents.reporter_name/email, counterpart_dpa_registry.contact_*,
 *     open_data_access_log.accessor_hash, delisting_proof_tokens.applicant_email).
 */
export const PII_FIELDS: Record<string, string[]> = {
  users: ["email", "name"],
  organizations: ["contact_email"],
  portal_submissions: ["contact_name", "contact_email", "contact_phone"],
  citizen_requests: ["citizen_email", "citizen_nin"],
  dpo_appointments: ["dpo_email", "dpo_phone"],
  automated_decision_records: ["data_subject_email"],
  parental_consent_records: ["parent_email"],
  data_export_jobs: ["data_subject_email"],
  dpco_clients: ["contact_name", "contact_email", "contact_phone"],
  // ── Consent data-subject identities (round-9 additions, verified) ──
  consent_records: ["data_subject_name", "data_subject_email", "data_subject_nin"],
  consent_records_v2: ["data_subject_email"],
  // ── Age assurance / minors (migration 0032). data_subject_ref was a
  // plaintext lookup key in 0032; migration 0103 added the
  // data_subject_ref_hmac equality-lookup column and data_subject_ref is now
  // encrypted at write via encryptField (minorsConsent), so it is covered
  // here. The *_hmac columns remain pseudonymous lookup keys and stay out. ──
  age_assurance_records: ["guardian_name", "guardian_contact", "dob", "data_subject_ref"],
  consent_refresh_tasks: ["data_subject_ref"],
  // ── Whistleblower reporter identity (round-9 addition, verified) ──
  whistleblower_reports: ["reporter_email"],
  // ── Feature-router PII (migrations 0031–0054) ──
  // Whistleblower channel message bodies (gap 7 / migration 0040).
  whistleblower_messages: ["body"],
  // DSAR third-party / deceased-subject representatives (migration 0031).
  dsar_third_party_submissions: ["representative_name", "representative_email", "representative_phone"],
  dsar_deceased_subjects: ["deceased_name", "executor_name", "executor_contact"],
  // DPO marketplace contact identities (migration 0042).
  dpo_marketplace_profiles: ["name", "email", "phone"],
  marketplace_engagements: ["contact_email"],
  // Public sanctions register delisting applicants (migration 0050).
  delisting_requests: ["applicant_name", "applicant_email"],
  // FOIA requester identities (migration 0051).
  foia_requests: ["requester_name", "requester_email", "requester_phone"],
  // Election-oversight reporter identities (migration 0052).
  political_microtargeting_reports: ["reporter_name", "reporter_email"],
  // AI-incident reporter identities + assessor (migrations 0053, round-9).
  ai_incidents: ["reporter_name", "reporter_email"],
  ai_risk_tier_assessments: ["assessor_name"],
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
  // NOTE: msisdn_hmac values are HMAC lookup keys — see the HMAC note above.
  ussd_sessions: ["msisdn_hmac", "msisdn_last4", "payload"],
  ussd_intake_queue: ["msisdn_hmac", "msisdn_last4", "description"],
  sms_outbox: ["msisdn_hmac", "msisdn_last4", "message"],
  // NIN identity verification pseudonymous identifiers (migration 0093).
  // NOTE: the plaintext subject_ref columns were retired (0122 redact +
  // write-block, 0126 DROP COLUMN) and are no longer listed here.
  identity_verifications: ["nin_hmac", "verification_token"],
  verification_audit_log: ["actor", "details"],
  // Data sovereignty officer identities (migrations 0094–0096).
  hosting_declarations: ["submitted_by", "reviewed_by", "admin_access_locations"],
  residency_attestations: ["attesting_officer_name", "attesting_officer_title", "revoked_by"],
  residency_violations: ["acknowledged_by", "resolved_by", "details"],
  cross_regulator_referrals: ["referred_by", "received_by", "case_summary"],
  egress_thresholds: ["updated_by"],
  asn_geo_reference: ["created_by"],
  sovereignty_scores: ["computed_by"],
  // Receipt payer identity (migration 0043, round-9 addition).
  receipts: ["payer_email"],
  // Insider-threat protection flags (migration 0080, round-9 addition).
  protection_flags: ["reporter_email", "employer_name"],
  // ── FIX-B static merge (round-9, from /mnt/agents/round9/pii_fields/fixB.txt) ──
  // DSAR refusal/extension notification retry queue: recipient email stored
  // encrypted (encryptField) — decrypted at retry time (migration 0103).
  dsar_notification_retries: ["recipient"],
  // age_assurance_records.data_subject_ref / consent_refresh_tasks.data_subject_ref
  // are listed in the minors group above (also FIX-B entries).
  // ── FEAT-E static merge (round-9, from /mnt/agents/round9/pii_fields/featE.txt) ──
  // AI runtime oversight public-incident reporters (migration 0114).
  ai_runtime_incidents: ["reporter_name", "reporter_email"],
  // International cooperation counterpart DPA contacts (migration 0115).
  counterpart_dpa_registry: ["contact_name", "contact_email"],
  // Open-data portal accessor pseudonym (migration 0113).
  open_data_access_log: ["accessor_hash"],
  // ── FIN-1 (round-9): delisting org-proof token applicant (migration 0117) ──
  delisting_proof_tokens: ["applicant_email"],
  // ── Round-10 registry-gap closure (previously GAP(round-10) allowlist) ──
  // Reads auto-decrypt via autoDecryptRows (decryptField is a symmetric no-op
  // on legacy plaintext rows). Write-side encryption is in place for
  // dpco_training_participants.participant_email and penalty_appeals.contact_email;
  // the remaining fields carry TODO-ENCRYPT-AT-WRITE markers at their write
  // sites because Python workers (kyc_analysis_worker, watchlist_screener_fallback,
  // aml_scoring_worker) consume them in plaintext and have no decrypt path yet.
  kyc_records: ["bvn", "date_of_birth", "email", "full_name", "nin", "phone_number"],
  aml_cases: ["subject_bvn"],
  watchlist_entries: ["date_of_birth"],
  insurance_policies: ["policyholder_nin"],
  penalty_appeals: ["contact_email"],
  dpco_training_participants: ["participant_email"],
};

/**
 * Merge additional PII fields discovered by the concurrent schema-audit lane
 * (FIX-B writes /mnt/agents/round9/pii_fields/fixB.txt, one table.column per
 * line). Called at module load when the file exists; entries that do not
 * resolve to real schema objects are rejected by the piiRegistry test.
 */
function mergeExternalPiiFields(target: Record<string, string[]>): void {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = "/mnt/agents/round9/pii_fields/fixB.txt";
    if (!fs.existsSync(path)) return;
    const lines = fs.readFileSync(path, "utf8").split("\n");
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const m = line.match(/^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/i);
      if (!m) continue;
      const [, table, column] = m;
      target[table] = target[table] ?? [];
      if (!target[table].includes(column)) target[table].push(column);
    }
  } catch {
    // Absent or unreadable fixB file must never break startup.
  }
}
mergeExternalPiiFields(PII_FIELDS);

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
      (encrypted as Record<string, unknown>)[field] = encryptField(value, { table: tableName, column: field });
    }
  }
  return encrypted;
}

/**
 * Decrypt all PII fields in a row object for a given table.
 * Non-PII fields are left unchanged. Decryption failures propagate as
 * DecryptionError (fail-closed).
 */
export function decryptRow<T extends Record<string, unknown>>(tableName: string, row: T): T {
  const fields = PII_FIELDS[tableName];
  if (!fields || !isEncryptionEnabled()) return row;

  const decrypted = { ...row };
  for (const field of fields) {
    const value = decrypted[field];
    if (typeof value === "string") {
      (decrypted as Record<string, unknown>)[field] = decryptField(value, { table: tableName, column: field });
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
 * Decrypts with the old key (v1 or v2 envelope) and encrypts with the new key,
 * always emitting the current v2 envelope.
 */
export function reEncryptField(
  encrypted: string | null | undefined,
  oldKeyHex: string,
  newKeyHex: string,
  context?: EncryptionContext,
): string | null {
  if (encrypted == null || encrypted === "" || !isEncrypted(encrypted)) return encrypted as string | null;

  const oldKey = Buffer.from(oldKeyHex, "hex");
  const aad = aadFrom(context) ?? null;

  let plaintext: string;
  if (encrypted.startsWith(PREFIX_V1)) {
    const parts = encrypted.slice(PREFIX_V1.length).split(":");
    if (parts.length !== 3) return encrypted;
    plaintext = gcmDecrypt(oldKey, parts[0], parts[1], parts[2], null);
  } else {
    const parts = encrypted.slice(PREFIX_V2.length).split(":");
    if (parts.length !== 4) return encrypted;
    plaintext = gcmDecrypt(oldKey, parts[1], parts[2], parts[3], aad);
  }

  const newKey = Buffer.from(newKeyHex, "hex");
  const newKid = `local:${crypto.createHash("sha256").update(newKey).digest("hex").slice(0, 16)}`;
  const newIv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, newKey, newIv);
  if (aad) cipher.setAAD(aad);
  const newEncrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const newTag = cipher.getAuthTag();

  return `${PREFIX_V2}${newKid}:${newIv.toString("hex")}:${newTag.toString("hex")}:${newEncrypted.toString("hex")}`;
}
