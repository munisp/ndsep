import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "./db";
import { logger } from "./logger";
import {
  lookupMojaloopTransfer,
  lookupTigerBeetleTransfer,
  mojaloopTransfer,
  tigerbeetleTransfer,
  type FinancialProviderTransferState,
} from "./middlewareExtensions";

export type FinancialTransferKind = "NIP" | "RTGS" | "SWIFT";

export type TransferPayload = {
  payerFsp: string;
  payeeFsp: string;
  narration?: string;
  ledgerDebitAccount: string;
  ledgerCreditAccount: string;
};

type OutboxRow = {
  id: string;
  transfer_reference: string;
  transfer_kind: FinancialTransferKind;
  amount_minor: string | number;
  currency: string;
  payload: TransferPayload;
  attempts: number;
  tigerbeetle_transfer_id: string | null;
  mojaloop_transfer_id: string | null;
};

export type AtomicFinancialIntent = {
  actorId: string;
  idempotencyKey: string;
  reference: string;
  kind: "NIP" | "RTGS";
  amountMinor: number;
  currency: string;
  payload: TransferPayload;
  /** Stable caller business input only. Never include generated references or timestamps. */
  request: Record<string, unknown>;
  localTransaction:
    | {
        kind: "NIP";
        sessionId: string;
        senderBankCode: string;
        senderAccountNumber: string;
        senderAccountName: string;
        receiverBankCode: string;
        receiverAccountNumber: string;
        receiverAccountName: string;
        narration?: string;
        nibssRef: string;
        channelCode: string;
        amlFlagged: boolean;
        fraudFlagged: boolean;
      }
    | {
        kind: "RTGS";
        reference: string;
        senderBankCode: string;
        senderAccountNumber?: string;
        receiverBankCode: string;
        receiverAccountNumber?: string;
        narration?: string;
        priority: string;
        settlementCycle: string;
        cbnRef: string;
      };
};

const MAX_ATTEMPTS = 12;
const LEASE_SECONDS = 45;

function assertTransfer(
  reference: string,
  kind: FinancialTransferKind,
  amountMinor: number,
  currency: string,
  payload: TransferPayload
): void {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(reference))
    throw new Error("Invalid financial transfer reference");
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error(
      "Financial transfer amount must be a positive safe integer in minor units"
    );
  }
  if (!/^[A-Z]{3}$/.test(currency))
    throw new Error("Financial transfer currency must be ISO-4217 uppercase");
  if (
    !payload.payerFsp ||
    !payload.payeeFsp ||
    !payload.ledgerDebitAccount ||
    !payload.ledgerCreditAccount
  ) {
    throw new Error("Financial transfer payload is incomplete");
  }
  if (kind === "SWIFT")
    throw new Error(
      "SWIFT external dispatch is not enabled through the Mojaloop financial outbox"
    );
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function requestFingerprint(
  kind: FinancialTransferKind,
  request: Record<string, unknown>
): string {
  return createHash("sha256")
    .update(stableJson({ kind, request }))
    .digest("hex");
}

async function insertLocalTransaction(
  client: PoolClient,
  intent: AtomicFinancialIntent
): Promise<void> {
  const local = intent.localTransaction;
  if (local.kind === "NIP") {
    await client.query(
      `INSERT INTO nip_transactions (session_id, sender_bank_code, sender_bank_name, sender_account_number, sender_account_name,
        receiver_bank_code, receiver_bank_name, receiver_account_number, receiver_account_name,
        amount, narration, status, nibss_ref, channel_code, aml_flagged, fraud_flagged)
       VALUES ($1, $2, NULL, $3, $4, $5, NULL, $6, $7, $8, $9, 'initiated', $10, $11, $12, $13)`,
      [
        local.sessionId,
        local.senderBankCode,
        local.senderAccountNumber,
        local.senderAccountName,
        local.receiverBankCode,
        local.receiverAccountNumber,
        local.receiverAccountName,
        intent.amountMinor,
        local.narration ?? null,
        local.nibssRef,
        local.channelCode,
        local.amlFlagged,
        local.fraudFlagged,
      ]
    );
    return;
  }
  await client.query(
    `INSERT INTO rtgs_transactions (reference, sender_bank_code, sender_account_number, receiver_bank_code,
      receiver_account_number, amount, narration, status, priority, settlement_cycle, cbn_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8, $9, $10)`,
    [
      local.reference,
      local.senderBankCode,
      local.senderAccountNumber ?? null,
      local.receiverBankCode,
      local.receiverAccountNumber ?? null,
      intent.amountMinor,
      local.narration ?? null,
      local.priority,
      local.settlementCycle,
      local.cbnRef,
    ]
  );
}

/**
 * Atomically commits a local payment instruction and matching outbox message.
 * Reusing the same actor/idempotency key returns the original reference only when
 * the canonical request fingerprint matches exactly; a changed retry is rejected.
 */
export async function createFinancialIntentAtomically(
  intent: AtomicFinancialIntent
): Promise<{ reference: string; duplicate: boolean }> {
  assertTransfer(
    intent.reference,
    intent.kind,
    intent.amountMinor,
    intent.currency,
    intent.payload
  );
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      intent.idempotencyKey
    )
  ) {
    throw new Error("Financial transfer idempotency key must be a UUID");
  }
  if (!intent.actorId || intent.actorId.length > 128)
    throw new Error("Financial transfer actor identity is invalid");
  if (intent.localTransaction.kind !== intent.kind)
    throw new Error(
      "Financial local transaction kind does not match outbox kind"
    );

  const pool = getPool();
  if (!pool)
    throw new Error(
      "Database is unavailable; refusing to accept financial transfer intent"
    );
  const fingerprint = requestFingerprint(intent.kind, intent.request);
  const payload = stableJson(intent.payload);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Per-actor advisory lock closes the empty-row race before the unique row exists.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [intent.actorId, intent.idempotencyKey]
    );
    const existing = await client.query(
      `SELECT transfer_reference, request_fingerprint
       FROM financial_transfer_outbox
       WHERE actor_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [intent.actorId, intent.idempotencyKey]
    );
    if (existing.rowCount === 1) {
      if (existing.rows[0].request_fingerprint !== fingerprint) {
        throw new Error(
          "Financial transfer idempotency key was reused with a different request"
        );
      }
      await client.query("COMMIT");
      return {
        reference: String(existing.rows[0].transfer_reference),
        duplicate: true,
      };
    }

    await insertLocalTransaction(client, intent);
    await client.query(
      `INSERT INTO financial_transfer_outbox
       (transfer_reference, transfer_kind, amount_minor, currency, payload, actor_id, idempotency_key, request_fingerprint)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::uuid, $8)`,
      [
        intent.reference,
        intent.kind,
        intent.amountMinor,
        intent.currency,
        payload,
        intent.actorId,
        intent.idempotencyKey,
        fingerprint,
      ]
    );
    await client.query("COMMIT");
    return { reference: intent.reference, duplicate: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function claimOne(workerId: string): Promise<OutboxRow | null> {
  const pool = getPool();
  if (!pool)
    throw new Error("Database is unavailable; financial dispatch is paused");
  const result = await pool.query(
    `WITH candidate AS (
       SELECT id FROM financial_transfer_outbox
       WHERE (state = 'pending' AND available_at <= NOW())
          OR (state = 'leased' AND lease_expires_at < NOW())
       ORDER BY available_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE financial_transfer_outbox outbox
     SET state = 'leased', lease_owner = $1,
         lease_expires_at = NOW() + ($2::text || ' seconds')::interval,
         attempts = attempts + 1
     FROM candidate
     WHERE outbox.id = candidate.id
     RETURNING outbox.*`,
    [workerId, LEASE_SECONDS]
  );
  return (result.rows[0] as OutboxRow | undefined) ?? null;
}

async function requireReconciliation(
  id: string,
  error: unknown
): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  const detail = error instanceof Error ? error.message : String(error);
  await pool.query(
    `UPDATE financial_transfer_outbox
     SET state = 'reconciliation_required', lease_owner = NULL, lease_expires_at = NULL,
         last_error = $2
     WHERE id = $1 AND state = 'leased'`,
    [id, detail.slice(0, 4000)]
  );
}

async function markDispatched(
  id: string,
  tigerbeetleReference?: string,
  mojaloopReference?: string
): Promise<void> {
  const pool = getPool();
  if (!pool)
    throw new Error(
      "Database is unavailable while persisting dispatch acknowledgement"
    );
  await pool.query(
    `UPDATE financial_transfer_outbox
     SET state = 'dispatched', tigerbeetle_transfer_id = COALESCE($2, tigerbeetle_transfer_id),
         mojaloop_transfer_id = COALESCE($3, mojaloop_transfer_id), dispatched_at = NOW(),
         lease_owner = NULL, lease_expires_at = NULL, last_error = NULL
     WHERE id = $1 AND state = 'leased'`,
    [id, tigerbeetleReference ?? null, mojaloopReference ?? null]
  );
}

/** Dispatch at most one durable intent. It is safe to run concurrently in many processes. */
export async function dispatchNextFinancialTransfer(
  workerId = `financial-outbox-${randomUUID()}`
): Promise<boolean> {
  const row = await claimOne(workerId);
  if (!row) return false;
  try {
    const amountMinor = Number(row.amount_minor);
    const payload = row.payload;
    // An acknowledgement loss is intentionally not retried blindly. Reconciliation
    // must determine the provider state before a subsequent dispatch attempt.
    if (!row.tigerbeetle_transfer_id) {
      await tigerbeetleTransfer({
        debitAccountId: payload.ledgerDebitAccount,
        creditAccountId: payload.ledgerCreditAccount,
        amount: amountMinor,
        currency: row.currency,
        reference: row.transfer_reference,
        transferType: `${row.transfer_kind}_TRANSFER`,
      });
      const pool = getPool();
      if (!pool)
        throw new Error(
          "Database is unavailable after TigerBeetle acknowledgement"
        );
      await pool.query(
        `UPDATE financial_transfer_outbox SET tigerbeetle_transfer_id = $2 WHERE id = $1 AND state = 'leased'`,
        [row.id, row.transfer_reference]
      );
    }
    await mojaloopTransfer({
      payerFsp: payload.payerFsp,
      payeeFsp: payload.payeeFsp,
      amount: String(amountMinor),
      currency: row.currency,
      reference: row.transfer_reference,
      note: payload.narration,
    });
    await markDispatched(
      row.id,
      row.transfer_reference,
      row.transfer_reference
    );
    return true;
  } catch (error) {
    await requireReconciliation(String(row.id), error);
    logger.error(
      { err: error, reference: row.transfer_reference },
      "[FinancialOutbox] dispatch acknowledgement is ambiguous; quarantined for provider reconciliation"
    );
    return false;
  }
}

async function recordProviderObservation(
  reference: string,
  provider: "tigerbeetle" | "mojaloop",
  state: FinancialProviderTransferState,
  action: string,
  detail?: string
): Promise<void> {
  const pool = getPool();
  if (!pool)
    throw new Error(
      "Database unavailable while recording provider reconciliation evidence"
    );
  const responseHash = createHash("sha256")
    .update(`${provider}:${reference}:${state}`)
    .digest("hex");
  await pool.query(
    `INSERT INTO financial_provider_reconciliation
       (transfer_reference, provider, observed_state, response_sha256, action, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [reference, provider, state, responseHash, action, detail ?? null]
  );
}

async function claimReconciliation(
  workerId: string
): Promise<OutboxRow | null> {
  const pool = getPool();
  if (!pool)
    throw new Error(
      "Database is unavailable; financial reconciliation is paused"
    );
  const result = await pool.query(
    `WITH candidate AS (
       SELECT id FROM financial_transfer_outbox
       WHERE state = 'reconciliation_required'
       ORDER BY updated_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE financial_transfer_outbox outbox
     SET state = 'leased', lease_owner = $1,
         lease_expires_at = NOW() + ($2::text || ' seconds')::interval
     FROM candidate
     WHERE outbox.id = candidate.id
     RETURNING outbox.*`,
    [workerId, LEASE_SECONDS]
  );
  return (result.rows[0] as OutboxRow | undefined) ?? null;
}

async function setReconciledState(
  id: string,
  state: "pending" | "dispatched" | "failed" | "dead_letter",
  detail: string
): Promise<void> {
  const pool = getPool();
  if (!pool)
    throw new Error(
      "Database unavailable while storing reconciliation outcome"
    );
  await pool.query(
    `UPDATE financial_transfer_outbox
     SET state = $2, lease_owner = NULL, lease_expires_at = NULL, last_error = $3,
         available_at = CASE WHEN $2 = 'pending' THEN NOW() ELSE available_at END
     WHERE id = $1 AND state = 'leased'`,
    [id, state, detail.slice(0, 4000)]
  );
}

/**
 * Resolve one ambiguous acknowledgement using provider reference lookups. A
 * missing state at both authorities proves no side effect and re-enables dispatch;
 * any partial, pending, or contradictory state is retained or dead-lettered for
 * explicit operations review. This function never replays a TigerBeetle transfer.
 */
export async function reconcileNextFinancialTransfer(
  workerId = `financial-reconciler-${randomUUID()}`
): Promise<boolean> {
  const row = await claimReconciliation(workerId);
  if (!row) return false;
  try {
    const [tigerbeetle, mojaloop] = await Promise.all([
      lookupTigerBeetleTransfer(row.transfer_reference),
      lookupMojaloopTransfer(row.transfer_reference),
    ]);
    await recordProviderObservation(
      row.transfer_reference,
      "tigerbeetle",
      tigerbeetle,
      "lookup"
    );
    await recordProviderObservation(
      row.transfer_reference,
      "mojaloop",
      mojaloop,
      "lookup"
    );

    if (tigerbeetle === "aborted" || mojaloop === "aborted") {
      if (
        (tigerbeetle === "committed" && mojaloop === "aborted") ||
        (mojaloop === "committed" && tigerbeetle === "aborted")
      ) {
        await setReconciledState(
          String(row.id),
          "dead_letter",
          `provider state conflict: tigerbeetle=${tigerbeetle}, mojaloop=${mojaloop}`
        );
      } else {
        await setReconciledState(
          String(row.id),
          "failed",
          `provider rejected transfer: tigerbeetle=${tigerbeetle}, mojaloop=${mojaloop}`
        );
      }
      return true;
    }

    if (tigerbeetle === "not_found" && mojaloop === "not_found") {
      await setReconciledState(
        String(row.id),
        "pending",
        "both providers confirmed no transfer by immutable reference; safe to dispatch"
      );
      return true;
    }

    if (tigerbeetle === "not_found" && mojaloop !== "not_found") {
      await setReconciledState(
        String(row.id),
        "dead_letter",
        `Mojaloop state exists without TigerBeetle ledger state: ${mojaloop}`
      );
      return true;
    }

    if (tigerbeetle === "committed" && mojaloop === "not_found") {
      // Reissue only after TigerBeetle definitively committed the ledger side.
      // The immutable reference remains the provider idempotency key.
      const payload = row.payload;
      try {
        await mojaloopTransfer({
          payerFsp: payload.payerFsp,
          payeeFsp: payload.payeeFsp,
          amount: String(row.amount_minor),
          currency: row.currency,
          reference: row.transfer_reference,
          note: payload.narration,
        });
        await setReconciledState(
          String(row.id),
          "dispatched",
          "TigerBeetle committed; Mojaloop dispatch reissued after authoritative absence lookup"
        );
      } catch (error) {
        await setReconciledState(
          String(row.id),
          "dead_letter",
          `Mojaloop dispatch remains ambiguous after TigerBeetle commit: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      return true;
    }

    if (tigerbeetle === "pending" && mojaloop === "not_found") {
      await setReconciledState(
        String(row.id),
        "dead_letter",
        "TigerBeetle remains pending while Mojaloop is absent; manual provider reconciliation is required before settlement dispatch"
      );
      return true;
    }

    await setReconciledState(
      String(row.id),
      "dispatched",
      `provider state established: tigerbeetle=${tigerbeetle}, mojaloop=${mojaloop}; awaiting terminal callback`
    );
    return true;
  } catch (error) {
    // The provider state was not authoritative. Re-quarantine without retrying.
    const pool = getPool();
    if (pool) {
      await pool.query(
        `UPDATE financial_transfer_outbox
         SET state = 'reconciliation_required', lease_owner = NULL, lease_expires_at = NULL, last_error = $2
         WHERE id = $1 AND state = 'leased'`,
        [
          row.id,
          (error instanceof Error ? error.message : String(error)).slice(
            0,
            4000
          ),
        ]
      );
    }
    logger.error(
      { err: error, reference: row.transfer_reference },
      "[FinancialOutbox] provider reconciliation is unavailable; transfer remains quarantined"
    );
    return false;
  }
}

let dispatcherTimer: NodeJS.Timeout | null = null;
let dispatcherStopping = false;

export function startFinancialTransferDispatcher(): void {
  if (
    dispatcherTimer ||
    process.env.FINANCIAL_OUTBOX_DISPATCHER_ENABLED !== "true"
  )
    return;
  dispatcherStopping = false;
  const workerId = `financial-outbox-${process.pid}-${randomUUID()}`;
  const tick = async () => {
    if (dispatcherStopping) return;
    // Resolve ambiguous acknowledgements before processing any newly pending work.
    for (let i = 0; i < 10 && !dispatcherStopping; i += 1) {
      const reconciled = await reconcileNextFinancialTransfer(workerId).catch(
        error => {
          logger.error(
            { err: error },
            "[FinancialOutbox] reconciliation tick failed"
          );
          return false;
        }
      );
      if (!reconciled) break;
    }
    for (let i = 0; i < 10 && !dispatcherStopping; i += 1) {
      const processed = await dispatchNextFinancialTransfer(workerId).catch(
        error => {
          logger.error(
            { err: error },
            "[FinancialOutbox] dispatcher tick failed"
          );
          return false;
        }
      );
      if (!processed) break;
    }
  };
  void tick();
  dispatcherTimer = setInterval(() => void tick(), 1_000);
  dispatcherTimer.unref();
  logger.info({ workerId }, "[FinancialOutbox] durable dispatcher started");
}

export async function stopFinancialTransferDispatcher(): Promise<void> {
  dispatcherStopping = true;
  if (dispatcherTimer) clearInterval(dispatcherTimer);
  dispatcherTimer = null;
  logger.info(
    "[FinancialOutbox] dispatcher stopped; leased intents will recover after their expiry"
  );
}
