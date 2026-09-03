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
    const colCheck = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'audit_logs'
         AND column_name IN ('previous_hash', 'hash_chain')`
    );
    if (colCheck.rows.length !== 2) {
      throw new Error("audit_logs hash-chain columns are missing; apply the authoritative migration before verification");
    }

    if (lastId > 0) {
      const predecessor = await pool.query(
        `SELECT hash_chain
           FROM audit_logs
          WHERE id <= $1
          ORDER BY id DESC
          LIMIT 1`,
        [lastId]
      );
      const predecessorHash = predecessor.rows[0]?.hash_chain;
      if (!predecessorHash) {
        throw new Error("cannot begin partial audit verification without a predecessor hash");
      }
      previousHash = predecessorHash;
    }

    while (totalEntries < maxEntries) {
      const { rows } = await pool.query(
        `SELECT id, action, resource_type, resource_id, user_id,
                COALESCE(details::text, '{}') AS details,
                created_at::text AS created_at,
                previous_hash, hash_chain
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

        if (!row.hash_chain || row.previous_hash !== (previousHash === "GENESIS" ? null : previousHash) || row.hash_chain !== expected) {
          breaks.push({
            entryId: row.id,
            position: totalEntries,
            expectedHash: expected,
            storedHash: row.hash_chain ?? "[MISSING]",
          });
        }

        previousHash = row.hash_chain ?? expected;
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
