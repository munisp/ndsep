import { createHash } from "node:crypto";
import { logger } from "./logger";

/**
 * TigerBeetle HTTP Client
 *
 * Financial state is durable only after the trusted proxy acknowledges a valid,
 * idempotency-bound request. There is no PostgreSQL success fallback here.
 */
const TB_BASE = process.env.TIGERBEETLE_HTTP_URL ?? "http://localhost:8240";
const TB_TIMEOUT_MS = 5_000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

let tbTransactions = 0;
let tbErrors = 0;

export type TbTransactionType = "penalty" | "fine" | "settlement" | "refund" | "escrow";

export interface TbTransaction {
  id?: string;
  orgId: string;
  penaltyId: string;
  amountUsd: number;
  currency?: string;
  type: TbTransactionType;
  description?: string;
  issuedBy?: string;
  timestamp?: string;
}

export interface TbTransactionResult {
  success: boolean;
  transactionId?: string;
  ledgerEntryId?: string;
  error?: string;
  degraded?: boolean;
}

export interface TbBalance {
  orgId: string;
  total_penalties_issued: number;
  total_penalties_paid: number;
  total_escrow_held: number;
  total_refunds: number;
  net_liability: number;
  currency: string;
  lastUpdated: string;
}

function requireTrustedTigerBeetleTransport(): void {
  if (IS_PRODUCTION && !TB_BASE.startsWith("https://")) {
    throw new Error("TigerBeetle HTTP proxy must use HTTPS in production");
  }
}

function validateTransaction(tx: TbTransaction): void {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(tx.orgId)) throw new Error("Invalid TigerBeetle orgId");
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(tx.penaltyId)) throw new Error("Invalid TigerBeetle penaltyId");
  if (!Number.isFinite(tx.amountUsd) || tx.amountUsd <= 0 || !Number.isSafeInteger(Math.round(tx.amountUsd * 100))) {
    throw new Error("TigerBeetle amountUsd must be a finite positive currency amount");
  }
  if (tx.currency && !/^[A-Z]{3}$/.test(tx.currency)) throw new Error("TigerBeetle currency must be a three-letter ISO code");
}

function idempotencyKey(tx: TbTransaction): string {
  // Repeated delivery of the same business event must produce the same durable request key.
  const canonical = JSON.stringify({
    id: tx.id ?? null,
    orgId: tx.orgId,
    penaltyId: tx.penaltyId,
    amountUsd: tx.amountUsd.toFixed(2),
    currency: tx.currency ?? "USD",
    type: tx.type,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Create a durable, idempotency-bound TigerBeetle ledger transaction. */
export async function createTigerBeetleTransaction(tx: TbTransaction): Promise<TbTransactionResult> {
  validateTransaction(tx);
  requireTrustedTigerBeetleTransport();
  const key = idempotencyKey(tx);
  try {
    const res = await fetch(`${TB_BASE}/transaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key, "X-NDSEP-Ledger-Request": key },
      body: JSON.stringify({
        org_id: tx.orgId,
        penalty_id: tx.penaltyId,
        amount_usd: tx.amountUsd,
        currency: tx.currency ?? "USD",
        type: tx.type,
        description: tx.description ?? `${tx.type} for org ${tx.orgId}`,
        issued_by: tx.issuedBy ?? "system",
        timestamp: tx.timestamp ?? new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(TB_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`TigerBeetle proxy rejected transaction with HTTP ${res.status}: ${body.slice(0, 512)}`);
    }
    const data = await res.json() as { transaction_id?: unknown; ledger_entry_id?: unknown };
    if (typeof data.transaction_id !== "string" || typeof data.ledger_entry_id !== "string") {
      throw new Error("TigerBeetle proxy acknowledgement is missing durable transaction identifiers");
    }
    tbTransactions++;
    return { success: true, transactionId: data.transaction_id, ledgerEntryId: data.ledger_entry_id };
  } catch (err: unknown) {
    tbErrors++;
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errMsg, idempotencyKey: key }, "[TigerBeetle] Durable transaction failed");
    throw err instanceof Error ? err : new Error(errMsg);
  }
}

export async function getTigerBeetleBalance(orgId: string): Promise<TbBalance> {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(orgId)) throw new Error("Invalid TigerBeetle orgId");
  requireTrustedTigerBeetleTransport();
  try {
    const res = await fetch(`${TB_BASE}/balance/${encodeURIComponent(orgId)}`, { signal: AbortSignal.timeout(TB_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`TigerBeetle balance lookup failed with HTTP ${res.status}`);
    return await res.json() as TbBalance;
  } catch (error) {
    tbErrors++;
    throw error;
  }
}

export async function isTigerBeetleHealthy(): Promise<boolean> {
  try {
    requireTrustedTigerBeetleTransport();
    const res = await fetch(`${TB_BASE}/health`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch { return false; }
}

export function tigerbeetleMetrics() {
  return { url: TB_BASE, transactions: tbTransactions, errors: tbErrors, productionTransportRequired: IS_PRODUCTION };
}

export async function tigerBeetleSmokeTest(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const ok = await isTigerBeetleHealthy();
    return { ok, latencyMs: Date.now() - start, ...(ok ? {} : { error: "TigerBeetle proxy is unavailable or untrusted" }) };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - start, error: error instanceof Error ? error.message : String(error) };
  }
}

export const __test__ = { idempotencyKey, validateTransaction };
