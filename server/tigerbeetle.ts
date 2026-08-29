import { logger } from "./logger";
/**
 * TigerBeetle HTTP Client
 * ─────────────────────────────────────────────────────────────────────────────
 * Wraps the TigerBeetle HTTP proxy (port 8240) that is spawned by the
 * tigerbeetle_ledger Go orchestration service. Financial state is durable only
 * after TigerBeetle acknowledges it; proxy failures are propagated to callers.
 *
 * Double-entry semantics:
 *   - Every penalty creates two ledger entries: DEBIT (org liability) + CREDIT (NDSEP revenue)
 *   - Every settlement creates a CREDIT on the org account (reducing liability)
 *   - Every escrow hold creates a HOLD entry pending dispute resolution
 */

const TB_BASE = process.env.TIGERBEETLE_HTTP_URL ?? "http://localhost:8240";
const TB_TIMEOUT_MS = 5_000;

let tbTransactions = 0;
let tbErrors = 0;
const tbDegraded = 0;

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

/**
 * Create a double-entry ledger transaction in TigerBeetle.
 * Throws when the durable TigerBeetle proxy rejects or cannot accept the transaction.
 */
export async function createTigerBeetleTransaction(tx: TbTransaction): Promise<TbTransactionResult> {
  try {
    const res = await fetch(`${TB_BASE}/transaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      throw new Error(`TigerBeetle proxy rejected transaction with HTTP ${res.status}: ${body}`);
    }
    const data = await res.json();
    tbTransactions++;
    return { success: true, transactionId: data.transaction_id, ledgerEntryId: data.ledger_entry_id };
  } catch (err: unknown) {
    tbErrors++;
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errMsg }, "[TigerBeetle] Durable transaction failed");
    throw err instanceof Error ? err : new Error(errMsg);
  }
}

/**
 * Get the ledger balance for an organisation.
 */
export async function getTigerBeetleBalance(orgId: string): Promise<TbBalance> {
  try {
    const res = await fetch(`${TB_BASE}/balance/${encodeURIComponent(orgId)}`, {
      signal: AbortSignal.timeout(TB_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`TigerBeetle balance lookup failed with HTTP ${res.status}`);
    return await res.json() as TbBalance;
  } catch (error) {
    tbErrors++;
    throw error;
  }
}

/**
 * Health check — returns true if the TigerBeetle proxy is reachable.
 */
export async function isTigerBeetleHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${TB_BASE}/health`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Metrics for monitoring and health dashboard.
 */
export function tigerbeetleMetrics() {
  return {
    url: TB_BASE,
    transactions: tbTransactions,
    errors: tbErrors,
    degraded: tbDegraded,
  };
}

/**
 * Smoke-test: verify the TigerBeetle proxy health without writing a test ledger event.
 */
export async function tigerBeetleSmokeTest(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const ok = await isTigerBeetleHealthy();
    return { ok, latencyMs: Date.now() - start, ...(ok ? {} : { error: "TigerBeetle proxy is unavailable" }) };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - start, error: error instanceof Error ? error.message : String(error) };
  }
}
