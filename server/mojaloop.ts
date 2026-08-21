/**
 * NDSEP Mojaloop Integration
 * =============================
 * Payment interoperability for penalty collection, settlement,
 * and cross-border financial flows via Mojaloop Hub.
 *
 * Features:
 *   - Party lookup (MSISDN, account ID)
 *   - Quote creation for penalty payments
 *   - Transfer execution and settlement
 *   - Health check with hub status
 *   - Graceful degradation when hub is unavailable
 *
 * Environment:
 *   MOJALOOP_URL         — Mojaloop Hub URL (default: http://localhost:4002)
 *   MOJALOOP_ALS_URL     — Account Lookup Service (default: http://localhost:4001)
 *   MOJALOOP_FSPIOP_SRC  — Source DFSP ID (default: ndsep)
 *   MOJALOOP_ENABLED     — "true" | "false" (default: "true")
 */

import { logger } from "./logger";
import { captureError } from "./errorMonitoring";

const MOJALOOP_URL = process.env.MOJALOOP_URL ?? "http://localhost:4002";
const MOJALOOP_ALS_URL = process.env.MOJALOOP_ALS_URL ?? "http://localhost:4001";
const MOJALOOP_FSPIOP_SRC = process.env.MOJALOOP_FSPIOP_SRC ?? "ndsep";
const MOJALOOP_ENABLED = (process.env.MOJALOOP_ENABLED ?? "true") === "true";

let connected = false;
let transfers = 0;
let errors = 0;

function fspiopHeaders(dest?: string): Record<string, string> {
  return {
    "Content-Type": "application/vnd.interoperability.transfers+json;version=1.1",
    Accept: "application/vnd.interoperability.transfers+json;version=1.1",
    "FSPIOP-Source": MOJALOOP_FSPIOP_SRC,
    ...(dest ? { "FSPIOP-Destination": dest } : {}),
    Date: new Date().toUTCString(),
  };
}

async function mojaRequest(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<{ ok: boolean; status: number; data: unknown }> {
  if (!MOJALOOP_ENABLED) return { ok: false, status: 0, data: { error: "Mojaloop disabled" } };
  try {
    const res = await fetch(url, {
      method,
      headers: headers ?? fspiopHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && !connected) {
      connected = true;
      logger.info(`[Mojaloop] Connected at ${MOJALOOP_URL}`);
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    if (connected) {
      connected = false;
      logger.warn("[Mojaloop] Connection lost — degrading gracefully");
    }
    errors++;
    return { ok: false, status: 0, data: { error: err instanceof Error ? err.message : String(err) } };
  }
}

// ─── Health ──────────────────────────────────────────────────────────────────

export async function mojalookHealth(): Promise<{
  connected: boolean;
  hubUrl: string;
  enabled: boolean;
  metrics: { transfers: number; errors: number };
}> {
  const { ok } = await mojaRequest("GET", `${MOJALOOP_URL}/health`, undefined, {
    Accept: "application/json",
  });
  return {
    connected: ok,
    hubUrl: MOJALOOP_URL,
    enabled: MOJALOOP_ENABLED,
    metrics: { transfers, errors },
  };
}

// ─── Party Lookup ────────────────────────────────────────────────────────────

export async function lookupParty(
  idType: "MSISDN" | "ACCOUNT_ID" | "BUSINESS",
  idValue: string,
): Promise<{ found: boolean; party?: Record<string, unknown> }> {
  const { ok, data } = await mojaRequest(
    "GET",
    `${MOJALOOP_ALS_URL}/parties/${idType}/${idValue}`,
    undefined,
    {
      Accept: "application/vnd.interoperability.parties+json;version=1.1",
      "FSPIOP-Source": MOJALOOP_FSPIOP_SRC,
      Date: new Date().toUTCString(),
    },
  );
  return { found: ok, party: ok ? (data as Record<string, unknown>) : undefined };
}

// ─── Quote ───────────────────────────────────────────────────────────────────

export async function createQuote(
  quoteId: string,
  payerFsp: string,
  payeeFsp: string,
  amount: { amount: string; currency: string },
  transactionType: string,
): Promise<{ ok: boolean; quoteId: string; data?: unknown }> {
  const { ok, data } = await mojaRequest("POST", `${MOJALOOP_URL}/quotes`, {
    quoteId,
    transactionId: `txn-${quoteId}`,
    payee: { partyIdInfo: { partyIdType: "BUSINESS", partyIdentifier: payeeFsp, fspId: payeeFsp } },
    payer: { partyIdInfo: { partyIdType: "BUSINESS", partyIdentifier: payerFsp, fspId: payerFsp } },
    amountType: "SEND",
    amount,
    transactionType: { scenario: "PAYMENT", initiator: "PAYER", initiatorType: "BUSINESS" },
    note: `NDSEP ${transactionType}`,
  });
  return { ok, quoteId, data: ok ? data : undefined };
}

// ─── Transfer ────────────────────────────────────────────────────────────────

export async function executeTransfer(
  transferId: string,
  payerFsp: string,
  payeeFsp: string,
  amount: { amount: string; currency: string },
  ilpPacket?: string,
  condition?: string,
): Promise<{ ok: boolean; transferId: string; state?: string }> {
  const { ok, data } = await mojaRequest("POST", `${MOJALOOP_URL}/transfers`, {
    transferId,
    payerFsp,
    payeeFsp,
    amount,
    ilpPacket: ilpPacket ?? "",
    condition: condition ?? "",
    expiration: new Date(Date.now() + 30_000).toISOString(),
  });
  if (ok) transfers++;
  const d = data as Record<string, unknown>;
  return { ok, transferId, state: ok ? String(d.transferState ?? "COMMITTED") : undefined };
}

// ─── Smoke Test ──────────────────────────────────────────────────────────────

export function mojaloopMetrics() {
  return {
    connected,
    enabled: MOJALOOP_ENABLED,
    hubUrl: MOJALOOP_URL,
    alsUrl: MOJALOOP_ALS_URL,
    fspiopSource: MOJALOOP_FSPIOP_SRC,
    transfers,
    errors,
  };
}

export async function mojalookSmokeTest() {
  const health = await mojalookHealth();
  return {
    ...health,
    fspiopSource: MOJALOOP_FSPIOP_SRC,
    alsUrl: MOJALOOP_ALS_URL,
  };
}

// ─── Participant Management ─────────────────────────────────────────────────

export async function registerParticipant(
  fspId: string,
  name: string,
  currency: string,
): Promise<{ ok: boolean; data?: unknown }> {
  const { ok, data } = await mojaRequest("POST", `${MOJALOOP_URL}/participants`, {
    fspId,
    name,
    currency,
    isActive: true,
  });
  return { ok, data: ok ? data : undefined };
}

export async function getParticipants(): Promise<{ ok: boolean; participants: unknown[] }> {
  const { ok, data } = await mojaRequest("GET", `${MOJALOOP_URL}/participants`);
  return { ok, participants: ok && Array.isArray(data) ? data : [] };
}

// ─── Settlement ─────────────────────────────────────────────────────────────

export async function createSettlement(
  settlementModelId: string,
  reason: string,
): Promise<{ ok: boolean; settlementId?: string; data?: unknown }> {
  const { ok, data } = await mojaRequest("POST", `${MOJALOOP_URL}/settlements`, {
    reason,
    settlementModel: settlementModelId,
  });
  const d = data as Record<string, unknown>;
  return { ok, settlementId: ok ? String(d.id ?? "") : undefined, data: ok ? data : undefined };
}

export async function getSettlements(state?: string): Promise<{ ok: boolean; settlements: unknown[] }> {
  const url = state ? `${MOJALOOP_URL}/settlements?state=${state}` : `${MOJALOOP_URL}/settlements`;
  const { ok, data } = await mojaRequest("GET", url);
  return { ok, settlements: ok && Array.isArray(data) ? data : [] };
}

// ─── Hub Account Setup ──────────────────────────────────────────────────────

export async function createHubAccount(
  type: "HUB_MULTILATERAL_SETTLEMENT" | "HUB_RECONCILIATION",
  currency: string,
): Promise<{ ok: boolean; data?: unknown }> {
  const { ok, data } = await mojaRequest("POST", `${MOJALOOP_URL}/participants/Hub/accounts`, {
    type,
    currency,
  });
  return { ok, data: ok ? data : undefined };
}

export async function depositToHub(
  accountId: string,
  amount: { amount: string; currency: string },
  reason: string,
): Promise<{ ok: boolean }> {
  const { ok } = await mojaRequest("POST", `${MOJALOOP_URL}/participants/Hub/accounts/${accountId}`, {
    transferId: `hub-deposit-${Date.now()}`,
    externalReference: `ndsep-${reason}`,
    action: "recordFundsIn",
    reason,
    amount,
  });
  return { ok };
}

if (MOJALOOP_ENABLED) {
  mojalookHealth().catch(() => {
    logger.warn("[Mojaloop] Not available — payment interoperability degraded");
  });
}
