#!/usr/bin/env tsx
/**
 * NDSEP Encryption Key Rotation Script
 * =======================================
 * Re-encrypts all PII fields in the database with a new encryption key.
 *
 * Usage:
 *   OLD_KEY=<old_hex> NEW_KEY=<new_hex> DATABASE_URL=<url> npx tsx scripts/rotate-encryption-key.ts
 *
 * This script:
 * 1. Reads all PII fields from all tables defined in PII_FIELDS
 * 2. Decrypts each value with the OLD_KEY
 * 3. Re-encrypts with the NEW_KEY
 * 4. Updates the row in-place
 * 5. Updates the field_encryption_status tracking table
 *
 * Safety:
 * - Runs in a transaction per table (rollback on failure)
 * - Logs progress per table
 * - Validates both keys before starting
 * - Dry-run mode with --dry-run flag
 */

import pg from "pg";
import { reEncryptField, isEncrypted } from "../server/encryption";

const { Pool } = pg;

const OLD_KEY = process.env.OLD_KEY ?? "";
const NEW_KEY = process.env.NEW_KEY ?? "";
const DB_URL = process.env.DATABASE_URL ?? process.env.LOCAL_DATABASE_URL ?? "";
const DRY_RUN = process.argv.includes("--dry-run");

// PII field definitions (must match server/encryption.ts)
const PII_FIELDS: Record<string, string[]> = {
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

async function main() {
  // Validate inputs
  if (OLD_KEY.length !== 64) {
    console.error("ERROR: OLD_KEY must be a 64-char hex string");
    process.exit(1);
  }
  if (NEW_KEY.length !== 64) {
    console.error("ERROR: NEW_KEY must be a 64-char hex string");
    process.exit(1);
  }
  if (!DB_URL) {
    console.error("ERROR: DATABASE_URL or LOCAL_DATABASE_URL must be set");
    process.exit(1);
  }
  if (OLD_KEY === NEW_KEY) {
    console.error("ERROR: OLD_KEY and NEW_KEY must be different");
    process.exit(1);
  }

  console.log(`NDSEP Encryption Key Rotation${DRY_RUN ? " (DRY RUN)" : ""}`);
  console.log(`Tables: ${Object.keys(PII_FIELDS).length}`);
  console.log(`Fields: ${Object.values(PII_FIELDS).reduce((s, f) => s + f.length, 0)}`);
  console.log("");

  const pool = new Pool({ connectionString: DB_URL, max: 3 });
  let totalRotated = 0;
  let totalSkipped = 0;

  for (const [table, fields] of Object.entries(PII_FIELDS)) {
    const client = await pool.connect();
    try {
      // Check if table exists
      const tableCheck = await client.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)`,
        [table]
      );
      if (!tableCheck.rows[0].exists) {
        console.log(`  SKIP ${table} — table does not exist`);
        continue;
      }

      await client.query("BEGIN");

      // Select all rows with PII fields + id
      const existingCols = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [table]
      );
      const colNames = new Set(existingCols.rows.map((r: { column_name: string }) => r.column_name));
      const validFields = fields.filter(f => colNames.has(f));

      if (validFields.length === 0) {
        console.log(`  SKIP ${table} — no matching PII columns`);
        await client.query("ROLLBACK");
        continue;
      }

      const selectCols = ["id", ...validFields].join(", ");
      const result = await client.query(`SELECT ${selectCols} FROM "${table}"`);
      let rotated = 0;

      for (const row of result.rows) {
        const updates: string[] = [];
        const values: (string | null)[] = [];
        let paramIdx = 1;

        for (const field of validFields) {
          const value = row[field];
          if (typeof value === "string" && isEncrypted(value)) {
            const reEncrypted = reEncryptField(value, OLD_KEY, NEW_KEY);
            if (reEncrypted !== value) {
              updates.push(`"${field}" = $${paramIdx}`);
              values.push(reEncrypted);
              paramIdx++;
            }
          }
        }

        if (updates.length > 0) {
          const sql = `UPDATE "${table}" SET ${updates.join(", ")} WHERE id = $${paramIdx}`;
          values.push(row.id);
          if (!DRY_RUN) {
            await client.query(sql, values);
          }
          rotated++;
        }
      }

      if (!DRY_RUN) {
        // Update tracking table
        for (const field of validFields) {
          await client.query(
            `UPDATE field_encryption_status SET updated_at = NOW(), last_encrypted_at = NOW()
             WHERE table_name = $1 AND column_name = $2`,
            [table, field]
          );
        }
        await client.query("COMMIT");
      } else {
        await client.query("ROLLBACK");
      }

      totalRotated += rotated;
      totalSkipped += result.rows.length - rotated;
      console.log(`  ${table}: ${rotated} rows rotated, ${result.rows.length - rotated} skipped`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`  ERROR on ${table}:`, err);
    } finally {
      client.release();
    }
  }

  console.log(`\nDone. Rotated: ${totalRotated}, Skipped: ${totalSkipped}`);
  await pool.end();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
