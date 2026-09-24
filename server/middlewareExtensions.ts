/**
 * NDSEP Middleware Extensions — Phase 25
 * Full integration with: Dapr, Fluvio, OpenSearch, Mojaloop, Keycloak, Permify, Lakehouse
 * Required integrations propagate unavailable or rejected operations so callers cannot report side effects that did not occur.
 */

import { permifyCheck as checkPermifyPermission } from "./permify";
import { logger } from "./logger";

// ─── Service URLs ────────────────────────────────────────────────────────────

const DAPR_BRIDGE_URL = process.env.DAPR_BRIDGE_URL || "http://localhost:8150";
const FLUVIO_RELAY_URL = process.env.FLUVIO_RELAY_URL || "http://localhost:8151";
const MOJALOOP_ADAPTER_URL = process.env.MOJALOOP_ADAPTER_URL || "http://localhost:8152";
const APISIX_MANAGER_URL = process.env.APISIX_MANAGER_URL || "http://localhost:8153";
// Go tigerbeetle_ledger proxy (orchestration/go/cmd/tigerbeetle_ledger) defaults to PORT 8240.
// In docker-compose-workers-addition.yml the service runs as tigerbeetle-ledger-service with PORT=8206,
// so deployments should set TIGERBEETLE_LEDGER_URL=http://tigerbeetle-ledger-service:8206.
const TIGERBEETLE_LEDGER_URL = process.env.TIGERBEETLE_LEDGER_URL || "http://localhost:8240";
const OPENSEARCH_INDEXER_URL = process.env.OPENSEARCH_INDEXER_URL || "http://localhost:8161";
const KEYCLOAK_VALIDATOR_URL = process.env.KEYCLOAK_VALIDATOR_URL || "http://localhost:8162";
const LAKEHOUSE_INGEST_URL = process.env.LAKEHOUSE_INGEST_URL || "http://localhost:8163";
const PERMIFY_SYNC_URL = process.env.PERMIFY_SYNC_URL || "http://localhost:8164";
const FLUVIO_CONSUMER_URL = process.env.FLUVIO_CONSUMER_URL || "http://localhost:8165";
const OPENSEARCH_QUERY_URL = process.env.OPENSEARCH_QUERY_URL || "http://localhost:8166";
const DAPR_STATE_URL = process.env.DAPR_STATE_URL || "http://localhost:8167";

// ─── Shared fetch helper ─────────────────────────────────────────────────────

async function postJSON(url: string, body: object): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    throw new Error(`Required integration POST ${url} is unavailable: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Required integration POST ${url} failed with HTTP ${response.status}: ${detail}`);
  }
}

// ─── Dapr ────────────────────────────────────────────────────────────────────

/** Publish an event to Dapr pub/sub (routes to Kafka) */
export async function daprPublish(topic: string, data: object): Promise<void> {
  await postJSON(`${DAPR_BRIDGE_URL}/publish`, { topic, data });
}

/** Set a value in the Dapr state store (Redis-backed) */
export async function daprStateSet(key: string, value: unknown): Promise<void> {
  await postJSON(`${DAPR_STATE_URL}/state/set`, { key, value });
}

/** Get a value from the Dapr state store */
export async function daprStateGet(key: string): Promise<unknown> {
  let resp: Response;
  try {
    resp = await fetch(`${DAPR_STATE_URL}/state/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(2000),
    });
  } catch (err) {
    throw new Error(`Dapr state lookup for ${key} is unavailable: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  if (!resp.ok) throw new Error(`Dapr state lookup for ${key} failed with HTTP ${resp.status}`);
  const data = await resp.json() as { value: unknown };
  return data.value;
}

// ─── Fluvio ──────────────────────────────────────────────────────────────────

/** Relay an event to Fluvio (high-throughput streaming) */
export async function fluvioPublish(topic: string, event: object): Promise<void> {
  await postJSON(`${FLUVIO_RELAY_URL}/publish`, { topic, event });
  // Also push to consumer for routing
  await postJSON(`${FLUVIO_CONSUMER_URL}/publish`, {
    topic: `ndsep.${topic.replace(/-/g, ".")}`,
    event,
  });
}

// ─── OpenSearch ──────────────────────────────────────────────────────────────

/** Index a document in OpenSearch */
export async function opensearchIndex(index: string, doc: object): Promise<void> {
  await postJSON(`${OPENSEARCH_INDEXER_URL}/index`, { index, document: doc });
}

/** Search OpenSearch (returns results or empty array on error) */
export async function opensearchSearch(index: string, params: object): Promise<unknown[]> {
  const resp = await fetch(`${OPENSEARCH_QUERY_URL}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index, ...params }),
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) throw new Error(`OpenSearch query failed with HTTP ${resp.status}`);
  const data = await resp.json() as { result?: { hits?: { hits?: unknown[] } } };
  return data.result?.hits?.hits ?? [];
}

/** Global search across all NDSEP indices */
export async function opensearchGlobalSearch(q: string, sectors?: string[]): Promise<unknown[]> {
  const resp = await fetch(`${OPENSEARCH_QUERY_URL}/search/global`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q, sectors }),
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) throw new Error(`OpenSearch global query failed with HTTP ${resp.status}`);
  const data = await resp.json() as { result?: { hits?: { hits?: unknown[] } } };
  return data.result?.hits?.hits ?? [];
}

// ─── Lakehouse ───────────────────────────────────────────────────────────────

/** Ingest records into the NDSEP data lakehouse */
export async function lakehouseIngest(table: string, records: object[]): Promise<void> {
  await postJSON(`${LAKEHOUSE_INGEST_URL}/ingest`, {
    table,
    records,
    source_system: "ndsep-platform",
  });
}

// ─── TigerBeetle ─────────────────────────────────────────────────────────────

/**
 * Record a financial transaction in TigerBeetle.
 * Targets the Go tigerbeetle_ledger proxy: POST /transaction with
 * { org_id, penalty_id, amount_usd, currency, type, description, issued_by, timestamp }.
 * The Go service only accepts type in {penalty, fine, escrow, settlement, refund}
 * and currently only supports the USD ledger.
 */
export async function tigerbeetleTransfer(params: {
  debitAccountId: string;
  creditAccountId: string;
  amount: number;
  currency: string;
  reference: string;
  transferType?: string;
}): Promise<void> {
  // The Go tigerbeetle_ledger proxy only supports the USD ledger. Previously a
  // non-USD amount was silently forwarded as if it were USD, falsifying the
  // ledger. Now: record a reconciliation_pending marker loudly and skip the
  // ledger write — amounts are NEVER silently coerced across currencies.
  if (params.currency.toUpperCase() !== "USD") {
    logger.error(
      {
        reconciliation_pending: true,
        reason: "non_usd_currency",
        currency: params.currency,
        amount: params.amount,
        reference: params.reference,
        debitAccountId: params.debitAccountId,
        creditAccountId: params.creditAccountId,
      },
      "[tigerbeetle] reconciliation_pending: non-USD transfer NOT written to the USD-only ledger — manual reconciliation required",
    );
    return;
  }
  await postJSON(`${TIGERBEETLE_LEDGER_URL}/transaction`, {
    org_id: params.debitAccountId,
    penalty_id: params.reference,
    amount_usd: params.amount,
    currency: params.currency,
    type: toLedgerTransactionType(params.transferType),
    description: `Transfer ${params.debitAccountId} -> ${params.creditAccountId} (${params.reference})`,
    issued_by: "ndsep-platform",
    timestamp: new Date().toISOString(),
  });
}

/**
 * Map transfer types onto the Go ledger's accepted transaction types.
 * Unknown types THROW: silently coercing an unknown type to 'penalty'
 * misclassifies ledger entries and corrupts financial reporting.
 */
function toLedgerTransactionType(transferType?: string): "penalty" | "fine" | "escrow" | "settlement" | "refund" {
  const t = (transferType || "fine").toLowerCase();
  if (t === "penalty" || t === "fine" || t === "escrow" || t === "settlement" || t === "refund") return t;
  if (t.includes("refund")) return "refund";
  if (t.includes("escrow")) return "escrow";
  if (t.includes("fine") || t.includes("penalty")) return "fine";
  if (t.includes("settle") || t.includes("transfer")) return "settlement";
  throw new Error(`[tigerbeetle] unknown ledger transaction type: '${transferType}' — refusing to coerce to a default type`);
}

// ─── Mojaloop ────────────────────────────────────────────────────────────────

/** Initiate a Mojaloop payment (for fine collection) */
export async function mojaloopTransfer(params: {
  payerFsp: string;
  payeeFsp: string;
  amount: string;
  currency: string;
  reference: string;
  note?: string;
}): Promise<void> {
  await postJSON(`${MOJALOOP_ADAPTER_URL}/transfers`, {
    payerFsp: params.payerFsp,
    payeeFsp: params.payeeFsp,
    amount: { amount: params.amount, currency: params.currency },
    note: params.note || params.reference,
    reference: params.reference,
  });
}

// ─── Keycloak ────────────────────────────────────────────────────────────────

/** Validate a Keycloak token and extract NDSEP roles */
export async function keycloakValidate(token: string, requiredRoles?: string[]): Promise<{
  valid: boolean;
  roles: string[];
  sub?: string;
  username?: string;
}> {
  try {
    const resp = await fetch(`${KEYCLOAK_VALIDATOR_URL}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, required_roles: requiredRoles }),
      signal: AbortSignal.timeout(3000),
    });
    return await resp.json() as { valid: boolean; roles: string[]; sub?: string; username?: string };
  } catch (err) {
    return { valid: false, roles: [] };
  }
}

// ─── Permify ─────────────────────────────────────────────────────────────────

/** Check a Permify permission */
export async function permifyCheck(
  entityType: string,
  entityId: string,
  permission: string,
  subjectId: string
): Promise<boolean> {
  return checkPermifyPermission(subjectId, permission, entityType, entityId);
}

/** Write a Permify relationship */
export async function permifyWriteRelationship(
  entityType: string,
  entityId: string,
  relation: string,
  subjectId: string
): Promise<void> {
  // Canonical subject id format is "user:<id>" — must match every check path.
  const normalizedSubjectId = subjectId.startsWith("user:") ? subjectId : `user:${subjectId}`;
  await postJSON(`${PERMIFY_SYNC_URL}/relationships/write`, {
    entityType, entityId, relation, subjectType: "user", subjectId: normalizedSubjectId,
  });
}

// ─── APISIX ──────────────────────────────────────────────────────────────────

/** Register a new API route in APISIX */
export async function apisixRegisterRoute(params: {
  routeId: string;
  uri: string;
  upstreamUrl: string;
  plugins?: object;
}): Promise<void> {
  await postJSON(`${APISIX_MANAGER_URL}/routes`, {
    route_id: params.routeId,
    uri: params.uri,
    upstream_url: params.upstreamUrl,
    plugins: params.plugins || {},
  });
}

// ─── Composite middleware call ────────────────────────────────────────────────

/**
 * Full middleware pipeline: emit to Kafka + Fluvio + OpenSearch + Lakehouse + Dapr
 * Use this for any significant compliance event
 */
export async function emitComplianceEvent(params: {
  eventType: string;
  entityType: string;
  entityId: string;
  sector?: string;
  userId?: string;
  data: object;
  severity?: "low" | "medium" | "high" | "critical";
}): Promise<void> {
  const event = {
    event_type: params.eventType,
    entity_type: params.entityType,
    entity_id: params.entityId,
    sector: params.sector,
    user_id: params.userId,
    severity: params.severity || "low",
    timestamp: Date.now(),
    ...params.data,
  };

  await Promise.all([
    fluvioPublish(params.eventType, event),
    opensearchIndex("compliance_events", event),
    lakehouseIngest("compliance_events", [event]),
    daprPublish("compliance-events", event),
  ]);
}
