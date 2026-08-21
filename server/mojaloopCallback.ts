/**
 * Mojaloop Transfer Callback Handler
 * Receives asynchronous transfer status updates from the Mojaloop hub.
 * Updates financial_ledger status and emits domain events.
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { getPool } from "./db";
import { logger } from "./logger";
import { emitMutationEvent, EVENTS } from "./middlewareIntegration";

const router = Router();

interface TransferCallback {
  transferId: string;
  transferState: "COMMITTED" | "ABORTED" | "RESERVED";
  completedTimestamp?: string;
  fulfilment?: string;
  condition?: string;
  errorInformation?: {
    errorCode: string;
    errorDescription: string;
  };
}

/**
 * PUT /api/mojaloop/transfers/:transferId
 * Mojaloop sends this when a transfer completes or fails.
 */
router.put("/transfers/:transferId", async (req: Request, res: Response) => {
  const { transferId } = req.params;
  const body = req.body as TransferCallback;
  const state = body.transferState;

  logger.info({ transferId, state }, "[Mojaloop] Transfer callback received");

  try {
    const pool = getPool();
    if (!pool) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }

    const dbStatus = state === "COMMITTED" ? "completed" : state === "ABORTED" ? "failed" : "pending";

    await pool.query(
      `UPDATE financial_ledger 
       SET status = $1, completed_at = $2, mojaloop_fulfilment = $3, updated_at = NOW()
       WHERE reference = $4`,
      [dbStatus, body.completedTimestamp ?? new Date().toISOString(), body.fulfilment ?? null, transferId]
    );

    emitMutationEvent(EVENTS.ENFORCEMENT_PAYMENT, {
      entity: "transfer",
      transferId,
      newStatus: dbStatus,
      completedAt: body.completedTimestamp,
    });

    if (state === "ABORTED" && body.errorInformation) {
      logger.warn({ transferId, error: body.errorInformation }, "[Mojaloop] Transfer aborted");
    }

    res.status(200).json({ accepted: true, transferId, state: dbStatus });
  } catch (err) {
    logger.error({ err, transferId }, "[Mojaloop] Callback processing failed");
    res.status(500).json({ error: "Internal error" });
  }
});

/**
 * GET /api/mojaloop/transfers/:transferId/status
 * Allows checking current transfer status from the DB.
 */
router.get("/transfers/:transferId/status", async (req: Request, res: Response) => {
  const { transferId } = req.params;
  try {
    const pool = getPool();
    if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }
    const result = await pool.query(
      `SELECT reference, status, amount, currency, completed_at FROM financial_ledger WHERE reference = $1`,
      [transferId]
    );
    const rows = result.rows;
    if (rows.length === 0) { res.status(404).json({ error: "Transfer not found" }); return; }
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Internal error" });
  }
});

export function registerMojaloopCallbacks(app: { use: (...args: any[]) => void }): void {
  app.use("/api/mojaloop", router);
  logger.info("[Mojaloop] Callback handler registered (PUT /api/mojaloop/transfers/:id)");
}
