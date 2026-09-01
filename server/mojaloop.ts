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

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const MOJALOOP_URL = process.env.MOJALOOP_URL ?? "http://localhost:4002";
const MOJALOOP_ALS_URL = process.env.MOJALOOP_ALS_URL ?? "http://localhost:4001";
const MOJALOOP_FSPIOP_SRC = process.env.MOJALOOP_FSPIOP_SRC ?? "ndsep";
const MOJALOOP_ENABLED = (process.env.MOJALOOP_ENABLED ?? (IS_PRODUCTION ? "false" : "true")) === "true";
const MOJALOOP_AUTH_TOKEN = process.env.MOJALOOP_AUTH_TOKEN;

function trustedMojaloopConfiguration(): string | null {
  if (!MOJALOOP_ENABLED) return "Mojaloop disabled";
  if (IS_PRODUCTION && (!MOJALOOP_URL.startsWith("https://") || !MOJALOOP_ALS_URL.startsWith("https://"))) return "Mojaloop endpoints must use HTTPS in production";
  if (IS_PRODUCTION && (!MOJALOOP_AUTH_TOKEN || MOJALOOP_AUTH_TOKEN.length < 32)) return "Mojaloop authentication token is not configured securely";
  if (!/^[A-Za-z0-9._-]{2,32}$/.test(MOJALOOP_FSPIOP_SRC)) return "Mojaloop FSPIOP source is invalid";
  return null;
}

let connected = false;
let transfers = 0;
let errors = 0;

function fspiopHeaders(dest?: string): Record<string, string> {
  return {
    "Content-Type": "application/vnd.interoperability.transfers+json;version=1.1",
    Accept: "application/vnd.interoperability.transfers+json;version=1.1",
    "FSPIOP-Source": MOJALOOP_FSPIOP_SRC,
    ...(MOJALOOP_AUTH_TOKEN ? { Authorization: `Bearer ${MOJALOOP_AUTH_TOKEN}` } : {}),
    ...(dest ? { "FSPIOP-Destination": dest } : {}),
    Date: new Date().toUTCString(),
  };
}

async function mojaRequest(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<{ ok: boolean; status: number; data: unknown }> {
  const configurationError = trustedMojaloopConfiguration();
  if (configurationError) return { ok: false, status: 0, data: { error: configurationError } };
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

function validateAmount(amount: { amount: string; currency: string }): void {
  if (!/^\d+(\.\d{1,2})?$/.test(amount.amount) || Number(amount.amount) <= 0) throw new Error("Mojaloop amount must be a positive decimal with at most two fractional digits");
  if (!/^[A-Z]{3}$/.test(amount.currency)) throw new Error("Mojaloop currency must be a three-letter ISO code");
}

export async function createQuote(
  quoteId: string,
  payerFsp: string,
  payeeFsp: string,
  amount: { amount: string; currency: string },
  transactionType: string,
): Promise<{ ok: boolean; quoteId: string; data?: unknown }> {
  validateAmount(amount);
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(quoteId)) throw new Error("Invalid Mojaloop quote ID");
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
  validateAmount(amount);
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(transferId)) throw new Error("Invalid Mojaloop transfer ID");
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
  const reportedState = typeof d.transferState === "string" ? d.transferState.trim() : "";
  // A successful HTTP submission proves only hub acceptance. Terminal settlement
  // state is established by the authenticated callback path, never inferred here.
  return { ok, transferId, state: ok ? (reportedState || "ACCEPTED") : undefined };
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
  const settlementId = typeof d.id === "string" ? d.id.trim() : "";
  // A 2xx response without a durable hub identifier cannot be reconciled safely.
  return { ok: ok && settlementId.length > 0, settlementId: settlementId || undefined, data: ok && settlementId ? data : undefined };
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
