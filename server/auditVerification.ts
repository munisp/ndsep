/**
 * NDSEP Audit Log Immutability Verification
 * ==========================================
 * Implements hash-chain verification for the audit log.
 * Each audit log entry stores a SHA-256 hash that chains to the previous entry,
 * making tampering detectable.
 *
 * Verification process:
 *   1. Read audit log entries in chronological order
 *   2. Recompute hash for each entry from its data + previous hash
 *   3. Compare computed hash against stored hash
 *   4. Report any breaks in the chain
 */

import crypto from "crypto";
import { Pool } from "pg";
import { getDatabaseUrl } from "./config";
import { getPgSslConfig } from "./dbSslConfig";
import { logger } from "./logger";

export interface VerificationResult {
  verified: boolean;
  totalEntries: number;
  verifiedEntries: number;
  firstBreak: number | null;
  breaks: Array<{
    entryId: number;
    position: number;
    expectedHash: string;
    storedHash: string;
  }>;
  duration: number;
}

function computeEntryHash(
  entry: {
    action: string;
    resource_type: string;
    resource_id: string;
    user_id: string;
    details: string;
    created_at: string;
  },
  previousHash: string
): string {
  const payload = [
    previousHash,
    entry.action,
    entry.resource_type,
    entry.resource_id,
    entry.user_id,
    entry.details,
    entry.created_at,
  ].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export async function verifyAuditLogIntegrity(
  options?: {
    batchSize?: number;
    startId?: number;
    limit?: number;
  }
): Promise<VerificationResult> {
  const pool = new Pool({
    connectionString: getDatabaseUrl(),
    ssl: getPgSslConfig(),
    max: 2,
  });

  const start = Date.now();
  const batchSize = options?.batchSize ?? 1000;
  const breaks: VerificationResult["breaks"] = [];
  let verifiedEntries = 0;
  let totalEntries = 0;
  let previousHash = "GENESIS";
  let lastId = options?.startId ?? 0;
  const maxEntries = options?.limit ?? Infinity;

  try {
    // Check if hash_chain column exists
    const colCheck = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'audit_logs' AND column_name = 'hash_chain'`
    );

    if (colCheck.rows.length === 0) {
      // hash_chain column doesn't exist yet — add it
      await pool.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS hash_chain TEXT`);
      logger.info("[AuditVerify] Added hash_chain column to audit_logs");
    }

    while (totalEntries < maxEntries) {
      const { rows } = await pool.query(
        `SELECT id, action, resource_type, resource_id, user_id,
                COALESCE(details::text, '{}') AS details,
                created_at::text AS created_at,
                hash_chain
         FROM audit_logs
         WHERE id > $1
         ORDER BY id ASC
         LIMIT $2`,
        [lastId, batchSize]
      );

      if (rows.length === 0) break;

      for (const row of rows) {
        totalEntries++;
        const expected = computeEntryHash(row, previousHash);

        if (row.hash_chain && row.hash_chain !== expected) {
          breaks.push({
            entryId: row.id,
            position: totalEntries,
            expectedHash: expected,
            storedHash: row.hash_chain,
          });
        } else if (!row.hash_chain) {
          // Backfill missing hashes
          await pool.query(
            `UPDATE audit_logs SET hash_chain = $1 WHERE id = $2`,
            [expected, row.id]
          );
        }

        previousHash = expected;
        verifiedEntries++;
        lastId = row.id;

        if (totalEntries >= maxEntries) break;
      }
    }
  } finally {
    await pool.end();
  }

  const duration = Date.now() - start;
  const result: VerificationResult = {
    verified: breaks.length === 0,
    totalEntries,
    verifiedEntries,
    firstBreak: breaks.length > 0 ? breaks[0].entryId : null,
    breaks,
    duration,
  };

  if (breaks.length > 0) {
    logger.error(
      { breaks: breaks.length, firstBreak: breaks[0].entryId },
      "[AuditVerify] INTEGRITY VIOLATION — %d breaks detected in audit chain",
      breaks.length
    );
  } else {
    logger.info(
      { totalEntries, verifiedEntries, durationMs: duration },
      "[AuditVerify] Chain verified — %d entries, no breaks",
      totalEntries
    );
  }

  return result;
}

/**
 * Middleware helper to add hash chain to new audit log entries.
 * Call this before inserting a new audit log row.
 */
export async function computeNextAuditHash(
  pool: Pool,
  entry: {
    action: string;
    resource_type: string;
    resource_id: string;
    user_id: string;
    details: string;
    created_at: string;
  }
): Promise<string> {
  const { rows } = await pool.query(
    `SELECT hash_chain FROM audit_logs ORDER BY id DESC LIMIT 1`
  );
  const previousHash = rows[0]?.hash_chain ?? "GENESIS";
  return computeEntryHash(entry, previousHash);
}
