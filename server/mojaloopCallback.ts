/**
 * Mojaloop settlement callback boundary.
 *
 * Every callback is authenticated over the exact raw body, recorded with a
 * provider event identifier, and applied exactly once. A callback never creates
 * a ledger transaction; it may only advance a pre-existing non-terminal record.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import type { Request, Response } from "express";
import { getPool } from "./db";
import { logger } from "./logger";
import { emitMutationEvent, EVENTS } from "./middlewareIntegration";

const router = Router();
const CALLBACK_SIGNATURE_HEADER = "x-mojaloop-signature";
const CALLBACK_EVENT_ID_HEADER = "x-mojaloop-event-id";
const CALLBACK_GATEWAY_ATTESTATION_HEADER = "x-ndsep-mtls-gateway-attestation";
const MAX_CALLBACK_BYTES = 256 * 1024;

type TransferState = "COMMITTED" | "ABORTED" | "RESERVED";

interface TransferCallback {
  transferId: string;
  transferState: TransferState;
  completedTimestamp?: string;
  fulfilment?: string;
  condition?: string;
  errorInformation?: { errorCode: string; errorDescription?: string };
}

function validateCallbackSecret(secret: string | undefined): string {
  const normalized = secret?.trim();
  if (
    !normalized ||
    normalized.length < 32 ||
    /change[_-]?me|placeholder/i.test(normalized)
  ) {
    throw new Error(
      "MOJALOOP_CALLBACK_HMAC_SECRET must be a non-placeholder secret of at least 32 characters"
    );
  }
  return normalized;
}

function requiredCallbackSecret(): string {
  return validateCallbackSecret(process.env.MOJALOOP_CALLBACK_HMAC_SECRET);
}

function requiredGatewayAttestation(): string {
  const value = process.env.MOJALOOP_CALLBACK_GATEWAY_ATTESTATION?.trim();
  if (!value || value.length < 32 || /change[_-]?me|placeholder/i.test(value)) {
    throw new Error(
      "MOJALOOP_CALLBACK_GATEWAY_ATTESTATION must be a non-placeholder secret of at least 32 characters"
    );
  }
  return value;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function isApprovedMtlsClient(req: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const verified = firstHeader(req.headers["x-ndsep-mtls-verified"]);
  const subject = firstHeader(req.headers["x-ndsep-mtls-subject"]);
  const attestation = firstHeader(
    req.headers[CALLBACK_GATEWAY_ATTESTATION_HEADER]
  );
  const allowlist = (process.env.MOJALOOP_CALLBACK_MTLS_SUBJECT_DN ?? "")
    .split(";")
    .map(value => value.trim())
    .filter(Boolean);
  return (
    verified === "SUCCESS" &&
    attestation === requiredGatewayAttestation() &&
    !!subject &&
    allowlist.length > 0 &&
    allowlist.includes(subject)
  );
}

export function verifyMojaloopCallbackSignature(
  rawBody: Buffer,
  provided: string | undefined,
  secret = requiredCallbackSecret()
): boolean {
  const validatedSecret = validateCallbackSecret(secret);
  if (!provided || !rawBody.length) return false;
  const suppliedHex = provided
    .trim()
    .replace(/^sha256=/i, "")
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(suppliedHex)) return false;
  const expectedHex = createHmac("sha256", validatedSecret)
    .update(rawBody)
    .digest("hex");
  return timingSafeEqual(
    Buffer.from(expectedHex, "hex"),
    Buffer.from(suppliedHex, "hex")
  );
}

function parseCallback(rawBody: Buffer): TransferCallback {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new Error("callback body must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object")
    throw new Error("callback payload must be an object");
  const value = parsed as Record<string, unknown>;
  if (
    typeof value.transferId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(value.transferId)
  ) {
    throw new Error("callback transferId is invalid");
  }
  if (
    value.transferState !== "COMMITTED" &&
    value.transferState !== "ABORTED" &&
    value.transferState !== "RESERVED"
  ) {
    throw new Error("callback transferState is invalid");
  }
  if (
    value.completedTimestamp !== undefined &&
    (typeof value.completedTimestamp !== "string" ||
      Number.isNaN(Date.parse(value.completedTimestamp)))
  ) {
    throw new Error("callback completedTimestamp is invalid");
  }
  if (
    value.fulfilment !== undefined &&
    (typeof value.fulfilment !== "string" || value.fulfilment.length > 4096)
  ) {
    throw new Error("callback fulfilment is invalid");
  }
  return {
    transferId: value.transferId,
    transferState: value.transferState,
    ...(typeof value.completedTimestamp === "string"
      ? { completedTimestamp: value.completedTimestamp }
      : {}),
    ...(typeof value.fulfilment === "string"
      ? { fulfilment: value.fulfilment }
      : {}),
  };
}

function statusForState(
  state: TransferState
): "settled" | "failed" | "processing" {
  return state === "COMMITTED"
    ? "settled"
    : state === "ABORTED"
      ? "failed"
      : "processing";
}

/**
 * PUT /api/mojaloop/transfers/:transferId
 * Must be mounted before express.json(), using express.raw(), so verification is
 * calculated over the exact bytes sent by the approved Mojaloop adapter.
 */
router.put("/transfers/:transferId", async (req: Request, res: Response) => {
  const transferId = req.params.transferId;
  if (!isApprovedMtlsClient(req)) {
    logger.warn(
      { transferId, ip: req.ip },
      "[Mojaloop] Rejected callback without approved mTLS client identity"
    );
    res.status(401).json({ error: "Client certificate verification failed" });
    return;
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body : undefined;
  const signature = firstHeader(req.headers[CALLBACK_SIGNATURE_HEADER]);
  const eventId = firstHeader(req.headers[CALLBACK_EVENT_ID_HEADER]);

  if (!rawBody || rawBody.length === 0 || rawBody.length > MAX_CALLBACK_BYTES) {
    res.status(400).json({
      error: "Raw callback body is required and must be within the size limit",
    });
    return;
  }
  if (!eventId || !/^[A-Za-z0-9._:-]{1,128}$/.test(eventId)) {
    res
      .status(400)
      .json({ error: "A valid X-Mojaloop-Event-Id header is required" });
    return;
  }

  try {
    if (!verifyMojaloopCallbackSignature(rawBody, signature)) {
      logger.warn(
        { transferId, eventId },
        "[Mojaloop] Rejected callback with invalid signature"
      );
      res.status(401).json({ error: "Invalid callback signature" });
      return;
    }
  } catch (error) {
    logger.error(
      { err: error, transferId, eventId },
      "[Mojaloop] Callback verifier is unavailable"
    );
    res.status(503).json({ error: "Callback verifier is unavailable" });
    return;
  }

  let callback: TransferCallback;
  try {
    callback = parseCallback(rawBody);
  } catch (error) {
    res.status(400).json({
      error:
        error instanceof Error ? error.message : "Invalid callback payload",
    });
    return;
  }
  if (callback.transferId !== transferId) {
    res
      .status(400)
      .json({ error: "Path transferId does not match callback transferId" });
    return;
  }

  const pool = getPool();
  if (!pool) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const acceptedEvent = await client.query(
      `INSERT INTO payment_settlement_events
         (provider, provider_event_id, transfer_reference, transfer_state, payload_sha256)
       VALUES ('mojaloop', $1, $2, $3, $4)
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING id`,
      [eventId, transferId, callback.transferState, payloadHash]
    );
    if (acceptedEvent.rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(200).json({ accepted: true, duplicate: true, transferId });
      return;
    }

    const ledgerStatus = statusForState(callback.transferState);
    type SettlementTarget = "ledger" | "nip" | "rtgs";
    let target: SettlementTarget | null = null;
    let targetId: string | number | null = null;
    let currentStatus = "";

    const ledger = await client.query(
      `SELECT id, status FROM financial_ledger
       WHERE external_reference = $1 OR transaction_id = $1
       FOR UPDATE`,
      [transferId]
    );
    if (ledger.rowCount === 1) {
      target = "ledger";
      targetId = ledger.rows[0].id;
      currentStatus = String(ledger.rows[0].status);
    } else if (ledger.rowCount === 0) {
      const nip = await client.query(
        `SELECT id, status FROM nip_transactions WHERE session_id = $1 FOR UPDATE`,
        [transferId]
      );
      if (nip.rowCount === 1) {
        target = "nip";
        targetId = nip.rows[0].id;
        currentStatus = String(nip.rows[0].status);
      } else if (nip.rowCount === 0) {
        const rtgs = await client.query(
          `SELECT id, status FROM rtgs_transactions WHERE reference = $1 FOR UPDATE`,
          [transferId]
        );
        if (rtgs.rowCount === 1) {
          target = "rtgs";
          targetId = rtgs.rows[0].id;
          currentStatus = String(rtgs.rows[0].status);
        }
      }
    }

    if (!target || targetId === null) {
      await client.query(
        `UPDATE payment_settlement_events
         SET processed_at = NOW(), processing_result = 'rejected', error_detail = 'unknown or ambiguous transfer reference'
         WHERE provider = 'mojaloop' AND provider_event_id = $1`,
        [eventId]
      );
      await client.query("COMMIT");
      logger.warn(
        { transferId, eventId },
        "[Mojaloop] Rejected callback for unknown or ambiguous transfer reference"
      );
      res.status(404).json({ error: "Transfer not found" });
      return;
    }

    const allowed =
      target === "ledger"
        ? callback.transferState === "RESERVED"
          ? currentStatus === "pending"
          : currentStatus === "pending" || currentStatus === "processing"
        : target === "nip"
          ? callback.transferState === "RESERVED"
            ? currentStatus === "initiated"
            : currentStatus === "initiated" ||
              currentStatus === "pending" ||
              currentStatus === "processing"
          : callback.transferState === "RESERVED"
            ? currentStatus === "queued"
            : currentStatus === "queued" || currentStatus === "processing";
    if (!allowed) {
      await client.query(
        `UPDATE payment_settlement_events
         SET processed_at = NOW(), processing_result = 'rejected', error_detail = $2
         WHERE provider = 'mojaloop' AND provider_event_id = $1`,
        [
          eventId,
          `illegal transition from ${currentStatus} via ${callback.transferState}`,
        ]
      );
      await client.query("COMMIT");
      res.status(409).json({ error: "Illegal settlement state transition" });
      return;
    }

    if (target === "ledger") {
      await client.query(
        `UPDATE financial_ledger
         SET status = $1,
             completed_at = CASE WHEN $1 IN ('settled', 'failed') THEN COALESCE($2::timestamptz, NOW()) ELSE completed_at END,
             settled_at = CASE WHEN $1 = 'settled' THEN COALESCE($2::timestamptz, NOW()) ELSE settled_at END,
             provider_fulfilment = COALESCE($3, provider_fulfilment),
             mojaloop_id = COALESCE(mojaloop_id, $4)
         WHERE id = $5`,
        [
          ledgerStatus,
          callback.completedTimestamp ?? null,
          callback.fulfilment ?? null,
          transferId,
          targetId,
        ]
      );
    } else if (target === "nip") {
      const nipStatus =
        callback.transferState === "COMMITTED"
          ? "completed"
          : callback.transferState === "ABORTED"
            ? "failed"
            : "pending";
      await client.query(
        `UPDATE nip_transactions
         SET status = $1, completed_at = CASE WHEN $1 IN ('completed', 'failed') THEN COALESCE($2::timestamptz, NOW()) ELSE completed_at END
         WHERE id = $3`,
        [nipStatus, callback.completedTimestamp ?? null, targetId]
      );
    } else {
      const rtgsStatus =
        callback.transferState === "COMMITTED"
          ? "settled"
          : callback.transferState === "ABORTED"
            ? "rejected"
            : "processing";
      await client.query(
        `UPDATE rtgs_transactions
         SET status = $1, settled_at = CASE WHEN $1 = 'settled' THEN COALESCE($2::timestamptz, NOW()) ELSE settled_at END
         WHERE id = $3`,
        [rtgsStatus, callback.completedTimestamp ?? null, targetId]
      );
    }

    const outboxState =
      callback.transferState === "COMMITTED"
        ? "settled"
        : callback.transferState === "ABORTED"
          ? "failed"
          : "dispatched";
    await client.query(
      `UPDATE financial_transfer_outbox
       SET state = $2, settled_at = CASE WHEN $2 = 'settled' THEN COALESCE($3::timestamptz, NOW()) ELSE settled_at END,
           lease_owner = NULL, lease_expires_at = NULL
       WHERE transfer_reference = $1 AND state IN ('leased', 'dispatched')`,
      [transferId, outboxState, callback.completedTimestamp ?? null]
    );
    await client.query(
      `UPDATE payment_settlement_events
       SET processed_at = NOW(), processing_result = 'applied'
       WHERE provider = 'mojaloop' AND provider_event_id = $1`,
      [eventId]
    );
    await client.query("COMMIT");

    void emitMutationEvent(EVENTS.ENFORCEMENT_PAYMENT, {
      entity: "transfer",
      transferId,
      newStatus: ledgerStatus,
      providerEventId: eventId,
      completedAt: callback.completedTimestamp,
    }).catch((error: unknown) =>
      logger.error(
        { err: error, transferId, eventId },
        "[Mojaloop] Settlement event publication failed after durable commit"
      )
    );
    res.status(200).json({
      accepted: true,
      duplicate: false,
      transferId,
      state: ledgerStatus,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    logger.error(
      { err: error, transferId, eventId },
      "[Mojaloop] Callback processing failed"
    );
    res.status(500).json({ error: "Internal error" });
  } finally {
    client.release();
  }
});

router.get(
  "/transfers/:transferId/status",
  async (req: Request, res: Response) => {
    const transferId = req.params.transferId;
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(transferId)) {
      res.status(400).json({ error: "Invalid transfer reference" });
      return;
    }
    try {
      const pool = getPool();
      if (!pool) {
        res.status(503).json({ error: "Database unavailable" });
        return;
      }
      const result = await pool.query(
        `SELECT external_reference, transaction_id, status, amount_minor, currency, completed_at
       FROM financial_ledger
       WHERE external_reference = $1 OR transaction_id = $1`,
        [transferId]
      );
      if (result.rows.length !== 1) {
        res.status(404).json({ error: "Transfer not found" });
        return;
      }
      res.json(result.rows[0]);
    } catch (error) {
      logger.error(
        { err: error, transferId },
        "[Mojaloop] Transfer status lookup failed"
      );
      res.status(500).json({ error: "Internal error" });
    }
  }
);

export function registerMojaloopCallbacks(app: {
  use: (...args: any[]) => void;
}): void {
  app.use(
    "/api/mojaloop",
    express.raw({ type: "application/json", limit: `${MAX_CALLBACK_BYTES}b` }),
    router
  );
  logger.info("[Mojaloop] Authenticated callback handler registered");
}
