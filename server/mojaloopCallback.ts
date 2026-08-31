/**
 * Mojaloop Transfer Callback Handler
 *
 * The hub callback is a financial trust boundary. NDSEP accepts an update only
 * when it has a shared callback-authentication secret, the raw received bytes
 * validate, the request is fresh, its path/body transfer IDs agree, and the
 * proposed state is a legal idempotent transition from the durable ledger state.
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getPool } from "./db";
import { logger } from "./logger";
import { emitMutationEvent, EVENTS } from "./middlewareIntegration";

const router = Router();
const CALLBACK_MAX_AGE_MS = 5 * 60_000;
const CALLBACK_CLOCK_SKEW_MS = 30_000;

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

type LedgerStatus = "pending" | "completed" | "failed";

function safeEqualHex(expected: string, received: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function verifyCallback(req: Request): { ok: true } | { ok: false; reason: string } {
  const secret = process.env.MOJALOOP_CALLBACK_HMAC_SECRET;
  const timestamp = req.get("x-ndsep-mojaloop-timestamp");
  const signature = req.get("x-ndsep-mojaloop-signature");
  const rawBody = (req as Request & { rawMojaloopCallbackBody?: Buffer }).rawMojaloopCallbackBody;

  if (!secret || secret.length < 32) return { ok: false, reason: "callback authentication is not configured" };
  if (!timestamp || !/^\d{13}$/.test(timestamp)) return { ok: false, reason: "missing or invalid callback timestamp" };
  if (!signature) return { ok: false, reason: "missing callback signature" };
  if (!rawBody) return { ok: false, reason: "raw callback body unavailable" };

  const receivedAt = Date.now();
  const issuedAt = Number(timestamp);
  if (!Number.isSafeInteger(issuedAt) || issuedAt > receivedAt + CALLBACK_CLOCK_SKEW_MS || receivedAt - issuedAt > CALLBACK_MAX_AGE_MS) {
    return { ok: false, reason: "callback timestamp outside accepted window" };
  }

  // Versioned pre-authentication encoding binds timestamp and exact JSON bytes.
  const signingInput = Buffer.concat([Buffer.from(`ndsep-mojaloop-callback-v1.${timestamp}.`, "utf8"), rawBody]);
  const expected = createHmac("sha256", secret).update(signingInput).digest("hex");
  return safeEqualHex(expected, signature) ? { ok: true } : { ok: false, reason: "callback signature verification failed" };
}

function statusFor(state: TransferCallback["transferState"]): LedgerStatus {
  return state === "COMMITTED" ? "completed" : state === "ABORTED" ? "failed" : "pending";
}

function legalTransition(current: string, requested: LedgerStatus): boolean {
  if (current === requested) return true; // Safe idempotent redelivery.
  if (current === "pending") return requested === "completed" || requested === "failed";
  return false; // A terminal state never transitions back or changes terminal outcome.
}

/**
 * PUT /api/mojaloop/transfers/:transferId
 *
 * Sender computes `HMAC-SHA-256(secret, utf8("ndsep-mojaloop-callback-v1." +
 * timestamp + ".") || raw_body)` and sends lowercase hex in
 * `X-NDSEP-Mojaloop-Signature`, with a 13-digit epoch-millisecond timestamp.
 */
router.put("/transfers/:transferId", async (req: Request, res: Response) => {
  const { transferId } = req.params;
  const body = req.body as Partial<TransferCallback>;
  const verified = verifyCallback(req);
  if (!verified.ok) {
    logger.warn({ transferId, reason: verified.reason }, "[Mojaloop] Rejected unauthenticated or stale transfer callback");
    res.status(401).json({ error: "Callback authentication failed" });
    return;
  }

  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(transferId) || body.transferId !== transferId || !["COMMITTED", "ABORTED", "RESERVED"].includes(String(body.transferState))) {
    logger.warn({ transferId }, "[Mojaloop] Rejected malformed or path/body-mismatched callback");
    res.status(400).json({ error: "Invalid transfer callback" });
    return;
  }

  const state = body.transferState as TransferCallback["transferState"];
  const requestedStatus = statusFor(state);
  const completedAt = body.completedTimestamp ? new Date(body.completedTimestamp) : new Date();
  if (Number.isNaN(completedAt.getTime())) {
    res.status(400).json({ error: "Invalid completedTimestamp" });
    return;
  }

  const pool = getPool();
  if (!pool) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  try {
    const client = await pool.connect();
    let changed = false;
    try {
      await client.query("BEGIN");
      const current = await client.query<{ status: string }>(
        "SELECT status FROM financial_ledger WHERE reference = $1 FOR UPDATE",
        [transferId],
      );
      if (current.rowCount !== 1) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Transfer not found" });
        return;
      }
      if (!legalTransition(current.rows[0].status, requestedStatus)) {
        await client.query("ROLLBACK");
        logger.error({ transferId, currentStatus: current.rows[0].status, requestedStatus }, "[Mojaloop] Rejected illegal terminal-state transition");
        res.status(409).json({ error: "Illegal transfer state transition" });
        return;
      }

      if (current.rows[0].status !== requestedStatus) {
        const updated = await client.query(
          `UPDATE financial_ledger
             SET status = $1, completed_at = $2, mojaloop_fulfilment = $3, updated_at = NOW()
           WHERE reference = $4 AND status = $5
           RETURNING reference`,
          [requestedStatus, completedAt.toISOString(), body.fulfilment ?? null, transferId, current.rows[0].status],
        );
        if (updated.rowCount !== 1) throw new Error("Ledger state changed during callback transaction");
        changed = true;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    if (changed) {
      emitMutationEvent(EVENTS.ENFORCEMENT_PAYMENT, {
        entity: "transfer",
        transferId,
        newStatus: requestedStatus,
        completedAt: completedAt.toISOString(),
        authenticated: true,
      });
    }
    if (state === "ABORTED" && body.errorInformation) {
      logger.warn({ transferId, errorCode: body.errorInformation.errorCode }, "[Mojaloop] Authenticated transfer abort callback");
    }
    res.status(200).json({ accepted: true, idempotent: !changed, transferId, state: requestedStatus });
  } catch (err) {
    logger.error({ err, transferId }, "[Mojaloop] Authenticated callback processing failed");
    res.status(500).json({ error: "Internal error" });
  }
});

router.get("/transfers/:transferId/status", async (req: Request, res: Response) => {
  const { transferId } = req.params;
  try {
    const pool = getPool();
    if (!pool) { res.status(503).json({ error: "Database unavailable" }); return; }
    const result = await pool.query(
      "SELECT reference, status, amount, currency, completed_at FROM financial_ledger WHERE reference = $1",
      [transferId],
    );
    if (result.rows.length === 0) { res.status(404).json({ error: "Transfer not found" }); return; }
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: "Internal error" });
  }
});

export function registerMojaloopCallbacks(app: { use: (...args: any[]) => void }): void {
  app.use("/api/mojaloop", router);
  logger.info("[Mojaloop] Authenticated callback handler registered");
}

export const __test__ = { legalTransition, statusFor, verifyCallback };
