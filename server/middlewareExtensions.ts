/**
 * NDSEP Middleware Extensions — Phase 25
 * Full integration with: Dapr, Fluvio, OpenSearch, Mojaloop, Keycloak, Permify, Lakehouse
 * Required integrations propagate unavailable or rejected operations so callers cannot report side effects that did not occur.
 */

import { permifyCheck as checkPermifyPermission } from "./permify";

// ─── Service URLs ────────────────────────────────────────────────────────────

const DAPR_BRIDGE_URL = process.env.DAPR_BRIDGE_URL || "http://localhost:8150";
const FLUVIO_RELAY_URL = process.env.FLUVIO_RELAY_URL || "http://localhost:8151";
const MOJALOOP_ADAPTER_URL = process.env.MOJALOOP_ADAPTER_URL || "http://localhost:8152";
const APISIX_MANAGER_URL = process.env.APISIX_MANAGER_URL || "http://localhost:8153";
const TIGERBEETLE_LEDGER_URL = process.env.TIGERBEETLE_LEDGER_URL || "http://localhost:8160";
const OPENSEARCH_INDEXER_URL = process.env.OPENSEARCH_INDEXER_URL || "http://localhost:8161";
const KEYCLOAK_VALIDATOR_URL = process.env.KEYCLOAK_VALIDATOR_URL || "http://localhost:8162";
const LAKEHOUSE_INGEST_URL = process.env.LAKEHOUSE_INGEST_URL || "http://localhost:8163";
const PERMIFY_SYNC_URL = process.env.PERMIFY_SYNC_URL || "http://localhost:8164";
const FLUVIO_CONSUMER_URL = process.env.FLUVIO_CONSUMER_URL || "http://localhost:8165";
const OPENSEARCH_QUERY_URL = process.env.OPENSEARCH_QUERY_URL || "http://localhost:8166";
const DAPR_STATE_URL = process.env.DAPR_STATE_URL || "http://localhost:8167";

// ─── Shared fetch helper ─────────────────────────────────────────────────────

const IS_PRODUCTION = process.env.NODE_ENV === "production" || process.env.APP_ENV === "production";

function trustedEndpoint(url: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(url);
  } catch {
    throw new Error("Required integration endpoint is not a valid absolute URL");
  }
  if (IS_PRODUCTION && endpoint.protocol !== "https:") {
    throw new Error(`Required production integration endpoint must use HTTPS: ${endpoint.origin}`);
  }
  if (endpoint.username || endpoint.password) {
    throw new Error(`Required integration endpoint must not contain inline credentials: ${endpoint.origin}`);
  }
  return endpoint;
}

async function postJSON(url: string, body: object): Promise<void> {
  const endpoint = trustedEndpoint(url);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    throw new Error(`Required integration POST ${endpoint.origin} is unavailable: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Required integration POST ${endpoint.origin} failed with HTTP ${response.status}: ${detail}`);
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
  const url = `${DAPR_STATE_URL}/state/get`;
  const endpoint = trustedEndpoint(url);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(2000),
    });
  } catch (err) {
    throw new Error(`Dapr state lookup for ${key} at ${endpoint.origin} is unavailable: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  if (!resp.ok) throw new Error(`Dapr state lookup for ${key} failed with HTTP ${resp.status}`);
  const data = await resp.json() as { value: unknown };
  return data.value;
}

// ─── Fluvio ──────────────────────────────────────────────────────────────────

/** Relay an event to Fluvio (high-throughput streaming) */
export async function fluvioPublish(topic: string, event: object): Promise<void> {
  await postJSON(`${FLUVIO_RELAY_URL}/publish`, { topic, payload: event });
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
  const url = `${OPENSEARCH_QUERY_URL}/search`;
  trustedEndpoint(url);
  const resp = await fetch(url, {
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
  const url = `${OPENSEARCH_QUERY_URL}/search/global`;
  trustedEndpoint(url);
  const resp = await fetch(url, {
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

/** Record a financial transaction in TigerBeetle */
export async function tigerbeetleTransfer(params: {
  debitAccountId: string;
  creditAccountId: string;
  amount: number;
  currency: string;
  reference: string;
  transferType?: string;
}): Promise<void> {
  await postJSON(`${TIGERBEETLE_LEDGER_URL}/transfers`, {
    debit_account_id: params.debitAccountId,
    credit_account_id: params.creditAccountId,
    amount: params.amount,
    currency: params.currency,
    user_data: params.reference,
    transfer_type: params.transferType || "REGULATORY_FINE",
  });
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
    const url = `${KEYCLOAK_VALIDATOR_URL}/validate`;
    trustedEndpoint(url);
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, required_roles: requiredRoles }),
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return { valid: false, roles: [] };
    const result = await resp.json() as { valid?: boolean; roles?: string[]; sub?: string; username?: string };
    if (!result.valid || !Array.isArray(result.roles)) return { valid: false, roles: [] };
    return { valid: true, roles: result.roles, sub: result.sub, username: result.username };
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
  await postJSON(`${PERMIFY_SYNC_URL}/relationships/write`, {
    entityType, entityId, relation, subjectType: "user", subjectId,
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
  trustedEndpoint(params.upstreamUrl);
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
