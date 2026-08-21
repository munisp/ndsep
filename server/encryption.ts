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
