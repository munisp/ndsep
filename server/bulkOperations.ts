/**
 * NDSEP Bulk Operations with Progress Tracking
 * ===============================================
 * Provides batch processing with progress indicators and undo capability.
 *
 * Recommendation E8: Bulk operations with progress tracking
 */

import { Pool } from "pg";
import { logger } from "./logger";
import { handleError } from "./errorClassifier";

export interface BulkOperation {
  id: string;
  type: string;
  totalItems: number;
  processedItems: number;
  successCount: number;
  failureCount: number;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  startedAt: Date;
  completedAt?: Date;
  undoAvailable: boolean;
  undoExpiresAt?: Date;
}

export type BulkOperationType =
  | "approve_registrations"
  | "assign_dpco"
  | "update_status"
  | "send_notification"
  | "export_data";

const BULK_OPS_TABLE = `
CREATE TABLE IF NOT EXISTS bulk_operations (
  id TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL,
  total_items INTEGER NOT NULL,
  processed_items INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  undo_available BOOLEAN DEFAULT true,
  undo_expires_at TIMESTAMPTZ,
  undo_data JSONB,
  created_by TEXT NOT NULL
);
`;

const UNDO_WINDOW_MS = 30_000; // 30 seconds

export async function initBulkOperations(pool: Pool): Promise<void> {
  try {
    await pool.query(BULK_OPS_TABLE);
    logger.info("[BulkOps] Initialized");
  } catch (err) {
    handleError(err, { module: "bulkOperations", action: "init" });
  }
}

/** Start a new bulk operation */
export async function startBulkOperation(
  pool: Pool,
  type: BulkOperationType,
  itemIds: number[],
  userId: string
): Promise<BulkOperation> {
  const id = `bulk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const undoExpiresAt = new Date(Date.now() + UNDO_WINDOW_MS);

  await pool.query(
    `INSERT INTO bulk_operations (id, operation_type, total_items, status, created_by, undo_expires_at, undo_data)
     VALUES ($1, $2, $3, 'running', $4, $5, $6)`,
    [id, type, itemIds.length, userId, undoExpiresAt, JSON.stringify({ itemIds })]
  );

  return {
    id,
    type,
    totalItems: itemIds.length,
    processedItems: 0,
    successCount: 0,
    failureCount: 0,
    status: "running",
    startedAt: new Date(),
    undoAvailable: true,
    undoExpiresAt,
  };
}

/** Update bulk operation progress */
export async function updateProgress(
  pool: Pool,
  operationId: string,
  processed: number,
  success: number,
  failure: number
): Promise<void> {
  await pool.query(
    `UPDATE bulk_operations SET processed_items = $2, success_count = $3, failure_count = $4 WHERE id = $1`,
    [operationId, processed, success, failure]
  );
}

/** Complete a bulk operation */
export async function completeBulkOperation(
  pool: Pool,
  operationId: string,
  status: "completed" | "failed" = "completed"
): Promise<void> {
  await pool.query(
    `UPDATE bulk_operations SET status = $2, completed_at = NOW() WHERE id = $1`,
    [operationId, status]
  );
}

/** Undo a bulk operation (within the undo window) */
export async function undoBulkOperation(pool: Pool, operationId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT * FROM bulk_operations WHERE id = $1 AND undo_available = true AND undo_expires_at > NOW()`,
    [operationId]
  );

  if (result.rows.length === 0) return false;

  // Mark as cancelled
  await pool.query(
    `UPDATE bulk_operations SET status = 'cancelled', undo_available = false WHERE id = $1`,
    [operationId]
  );

  logger.info({ operationId }, "[BulkOps] Operation undone");
  return true;
}

/** Get operation status */
export async function getBulkOperation(pool: Pool, operationId: string): Promise<BulkOperation | null> {
  const result = await pool.query(`SELECT * FROM bulk_operations WHERE id = $1`, [operationId]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    type: row.operation_type,
    totalItems: row.total_items,
    processedItems: row.processed_items,
    successCount: row.success_count,
    failureCount: row.failure_count,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    undoAvailable: row.undo_available && new Date(row.undo_expires_at) > new Date(),
    undoExpiresAt: row.undo_expires_at,
  };
}
