import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getDb, getPool } from "./db";
import { createTigerBeetleTransaction } from "./tigerbeetle";
import { mojaloopTransfer } from "./middlewareExtensions";
import { logger } from "./logger";

export type PaymentKind = "nip" | "rtgs";
export type PaymentCommandStatus =
  | "pending_ledger"
  | "processing_ledger"
  | "pending_settlement"
  | "processing_settlement"
  | "pending_confirmation"
  | "completed"
  | "failed";

interface PaymentCommandRow {
  id: string;
  payment_kind: PaymentKind;
  payment_reference: string;
  nip_transaction_id: number | null;
  rtgs_transaction_id: number | null;
  status: PaymentCommandStatus;
  amount: number;
  currency: "NGN" | "USD";
  debit_account: string;
  credit_account: string;
  tigerbeetle_transaction_id: string | null;
  mojaloop_reference: string | null;
  attempts: number;
}

export interface EnqueuePaymentCommandInput {
  paymentKind: PaymentKind;
  paymentReference: string;
  nipTransactionId?: number;
  rtgsTransactionId?: number;
  amount: number;
  currency: "NGN" | "USD";
  debitAccount: string;
  creditAccount: string;
}

const MAX_ATTEMPTS = 5;
const LEASE_MS = 30_000;
const PROCESS_INTERVAL_MS = 1_000;
let processorTimer: NodeJS.Timeout | undefined;
let processorTickRunning = false;

async function requiredPaymentPool() {
  await getDb();
  const pool = getPool();
  if (!pool) throw new Error("Database unavailable");
  return pool;
}

function assertInput(input: EnqueuePaymentCommandInput): void {
  if (!/^[A-Za-z0-9._:-]{8,64}$/.test(input.paymentReference)) {
    throw new Error("paymentReference must contain 8-64 safe identifier characters");
  }
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new Error("Payment command amount must be a positive safe integer in minor units");
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.debitAccount) || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.creditAccount)) {
    throw new Error("Payment command account identifiers are invalid");
  }
  const hasNip = input.nipTransactionId !== undefined;
  const hasRtgs = input.rtgsTransactionId !== undefined;
  if ((input.paymentKind === "nip" && (!hasNip || hasRtgs)) || (input.paymentKind === "rtgs" && (!hasRtgs || hasNip))) {
    throw new Error("Payment command must reference exactly one matching NIP or RTGS transaction");
  }
}

export async function enqueuePaymentCommand(client: PoolClient, input: EnqueuePaymentCommandInput): Promise<{ id: string; status: "pending_ledger" }> {
  assertInput(input);
  const id = randomUUID();
  const result = await client.query<{ id: string; status: "pending_ledger" }>(
    `INSERT INTO payment_commands (
       id, payment_kind, payment_reference, nip_transaction_id, rtgs_transaction_id,
       status, amount, currency, debit_account, credit_account
     ) VALUES ($1, $2, $3, $4, $5, 'pending_ledger', $6, $7, $8, $9)
     RETURNING id, status`,
    [
      id,
      input.paymentKind,
      input.paymentReference,
      input.nipTransactionId ?? null,
      input.rtgsTransactionId ?? null,
      input.amount,
      input.currency,
      input.debitAccount,
      input.creditAccount,
    ],
  );
  if (result.rowCount !== 1 || !result.rows[0]) throw new Error("Failed to persist payment command");
  return result.rows[0];
}

function retryStatus(status: PaymentCommandStatus): "pending_ledger" | "pending_settlement" {
  return status === "processing_settlement" ? "pending_settlement" : "pending_ledger";
}

export function retryDelayMs(attempts: number): number {
  return Math.min(5 * 60_000, 1_000 * (2 ** Math.min(8, Math.max(0, attempts - 1))));
}

async function claimNextPaymentCommand(): Promise<PaymentCommandRow | undefined> {
  const pool = await requiredPaymentPool();
  const result = await pool.query<PaymentCommandRow>(
    `WITH candidate AS (
       SELECT id
         FROM payment_commands
        WHERE (
          status IN ('pending_ledger', 'pending_settlement') AND next_attempt_at <= NOW()
        ) OR (
          status IN ('processing_ledger', 'processing_settlement')
          AND lease_expires_at IS NOT NULL AND lease_expires_at < NOW()
        )
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     UPDATE payment_commands command
        SET status = CASE
              WHEN command.status IN ('pending_ledger', 'processing_ledger') THEN 'processing_ledger'::payment_command_status
              ELSE 'processing_settlement'::payment_command_status
            END,
            attempts = command.attempts + 1,
            lease_expires_at = NOW() + INTERVAL '30 seconds',
            updated_at = NOW()
       FROM candidate
      WHERE command.id = candidate.id
     RETURNING command.*`,
  );
  return result.rows[0];
}

async function scheduleRetry(command: PaymentCommandRow, error: unknown): Promise<void> {
  const pool = await requiredPaymentPool();
  const message = error instanceof Error ? error.message : String(error);
  const terminal = command.attempts >= MAX_ATTEMPTS;
  const nextStatus = terminal ? "failed" : retryStatus(command.status);
  const nextAttemptAt = new Date(Date.now() + retryDelayMs(command.attempts));
  await pool.query(
    `UPDATE payment_commands
        SET status = $1::payment_command_status,
            next_attempt_at = $2,
            lease_expires_at = NULL,
            last_error = $3,
            completed_at = CASE WHEN $4 THEN NOW() ELSE completed_at END,
            updated_at = NOW()
      WHERE id = $5 AND status = $6::payment_command_status`,
    [nextStatus, nextAttemptAt.toISOString(), message.slice(0, 4_000), terminal, command.id, command.status],
  );
}

async function processClaimedPaymentCommand(command: PaymentCommandRow): Promise<void> {
  const pool = await requiredPaymentPool();
  try {
    if (command.status === "processing_ledger") {
      const result = await createTigerBeetleTransaction({
        orgId: command.debit_account,
        penaltyId: command.payment_reference,
        amount: command.amount,
        currency: command.currency,
        type: "transfer",
        debitAccountId: command.debit_account,
        creditAccountId: command.credit_account,
        description: command.payment_kind === "nip" ? "NIP_TRANSFER" : "RTGS_TRANSFER",
      });
      await pool.query(
        `UPDATE payment_commands
            SET status = 'pending_settlement', tigerbeetle_transaction_id = $1,
                next_attempt_at = NOW(), lease_expires_at = NULL, last_error = NULL, updated_at = NOW()
          WHERE id = $2 AND status = 'processing_ledger'`,
        [result.transactionId, command.id],
      );
      return;
    }

    if (command.status === "processing_settlement") {
      await mojaloopTransfer({
        payerFsp: command.debit_account,
        payeeFsp: command.credit_account,
        amount: String(command.amount),
        currency: command.currency,
        reference: command.payment_reference,
        note: `${command.payment_kind.toUpperCase()}:${command.payment_reference}`,
      });
      await pool.query(
        `UPDATE payment_commands
            SET status = 'pending_confirmation', mojaloop_reference = $1,
                lease_expires_at = NULL, last_error = NULL, updated_at = NOW()
          WHERE id = $2 AND status = 'processing_settlement'`,
        [command.payment_reference, command.id],
      );
    }
  } catch (error) {
    await scheduleRetry(command, error).catch((retryError) => {
      logger.error({ err: retryError, paymentReference: command.payment_reference }, "[Payments] Failed to persist payment command retry state");
    });
    logger.warn({ err: error, paymentReference: command.payment_reference, attempts: command.attempts }, "[Payments] Durable payment command attempt failed");
  }
}

async function processTick(): Promise<void> {
  if (processorTickRunning) return;
  processorTickRunning = true;
  try {
    const command = await claimNextPaymentCommand();
    if (command) await processClaimedPaymentCommand(command);
  } catch (error) {
    logger.error({ err: error }, "[Payments] Payment command processor tick failed");
  } finally {
    processorTickRunning = false;
  }
}

export type MojaloopCallbackState = "COMMITTED" | "ABORTED" | "RESERVED";
export type PaymentCallbackResult = "updated" | "idempotent" | "not_found" | "illegal_transition";

export async function applyMojaloopPaymentCallback(
  paymentReference: string,
  state: MojaloopCallbackState,
  completedAt: Date,
): Promise<PaymentCallbackResult> {
  const pool = await requiredPaymentPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<PaymentCommandRow>(
      `SELECT * FROM payment_commands
        WHERE payment_reference = $1 OR mojaloop_reference = $1
        FOR UPDATE`,
      [paymentReference],
    );
    if (current.rowCount !== 1 || !current.rows[0]) {
      await client.query("ROLLBACK");
      return "not_found";
    }
    const command = current.rows[0];
    if (state === "RESERVED") {
      const accepted = command.status === "pending_confirmation" || command.status === "completed" || command.status === "failed";
      await client.query("COMMIT");
      return accepted ? "idempotent" : "illegal_transition";
    }

    const terminalStatus: "completed" | "failed" = state === "COMMITTED" ? "completed" : "failed";
    if (command.status === terminalStatus) {
      await client.query("COMMIT");
      return "idempotent";
    }
    if (command.status !== "pending_confirmation") {
      await client.query("ROLLBACK");
      return "illegal_transition";
    }

    const updated = await client.query(
      `UPDATE payment_commands
          SET status = $1::payment_command_status, completed_at = $2,
              lease_expires_at = NULL, last_error = NULL, updated_at = NOW()
        WHERE id = $3 AND status = 'pending_confirmation'
        RETURNING id`,
      [terminalStatus, completedAt.toISOString(), command.id],
    );
    if (updated.rowCount !== 1) throw new Error("Payment command state changed during callback transaction");

    if (command.payment_kind === "nip") {
      const nipStatus = terminalStatus === "completed" ? "completed" : "failed";
      await client.query(
        `UPDATE nip_transactions
            SET status = $1::nip_status, completed_at = $2,
                response_code = CASE WHEN $1 = 'completed' THEN '00' ELSE response_code END
          WHERE id = $3`,
        [nipStatus, completedAt.toISOString(), command.nip_transaction_id],
      );
    } else {
      const rtgsStatus = terminalStatus === "completed" ? "settled" : "rejected";
      await client.query(
        `UPDATE rtgs_transactions
            SET status = $1::rtgs_status,
                settled_at = CASE WHEN $1 = 'settled' THEN $2 ELSE settled_at END,
                rejection_reason = CASE WHEN $1 = 'rejected' THEN 'Mojaloop transfer aborted' ELSE rejection_reason END
          WHERE id = $3`,
        [rtgsStatus, completedAt.toISOString(), command.rtgs_transaction_id],
      );
    }
    await client.query("COMMIT");
    return "updated";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function startPaymentCommandProcessor(): void {
  if (processorTimer) return;
  processorTimer = setInterval(() => { void processTick(); }, PROCESS_INTERVAL_MS);
  processorTimer.unref?.();
  void processTick();
}

export function stopPaymentCommandProcessor(): void {
  if (!processorTimer) return;
  clearInterval(processorTimer);
  processorTimer = undefined;
}

export const __test__ = { assertInput, retryDelayMs, retryStatus };
