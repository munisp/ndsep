/**
 * NDSEP Middleware Extensions — Phase 25
 * Full integration with: Dapr, Fluvio, OpenSearch, Mojaloop, Keycloak, Permify, Lakehouse
 * Required integrations propagate unavailable or rejected operations so callers cannot report side effects that did not occur.
 */

import { permifyCheck as checkPermifyPermission } from "./permify";

// ─── Service URLs ────────────────────────────────────────────────────────────

const DAPR_BRIDGE_URL = process.env.DAPR_BRIDGE_URL || "http://localhost:8150";
const FLUVIO_RELAY_URL =
  process.env.FLUVIO_RELAY_URL || "http://localhost:8151";
const MOJALOOP_ADAPTER_URL =
  process.env.MOJALOOP_ADAPTER_URL || "http://localhost:8152";
const APISIX_MANAGER_URL =
  process.env.APISIX_MANAGER_URL || "http://localhost:8153";
const TIGERBEETLE_LEDGER_URL =
  process.env.TIGERBEETLE_LEDGER_URL || "http://localhost:8160";
const OPENSEARCH_INDEXER_URL =
  process.env.OPENSEARCH_INDEXER_URL || "http://localhost:8161";
const KEYCLOAK_VALIDATOR_URL =
  process.env.KEYCLOAK_VALIDATOR_URL || "http://localhost:8162";
const LAKEHOUSE_INGEST_URL =
  process.env.LAKEHOUSE_INGEST_URL || "http://localhost:8163";
const PERMIFY_SYNC_URL =
  process.env.PERMIFY_SYNC_URL || "http://localhost:8164";
const FLUVIO_CONSUMER_URL =
  process.env.FLUVIO_CONSUMER_URL || "http://localhost:8165";
const OPENSEARCH_QUERY_URL =
  process.env.OPENSEARCH_QUERY_URL || "http://localhost:8166";
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
    throw new Error(
      `Required integration POST ${url} is unavailable: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Required integration POST ${url} failed with HTTP ${response.status}: ${detail}`
    );
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
    throw new Error(
      `Dapr state lookup for ${key} is unavailable: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!resp.ok)
    throw new Error(
      `Dapr state lookup for ${key} failed with HTTP ${resp.status}`
    );
  const data = (await resp.json()) as { value: unknown };
  return data.value;
}

// ─── Fluvio ──────────────────────────────────────────────────────────────────

/** Relay an event to Fluvio (high-throughput streaming) */
export async function fluvioPublish(
  topic: string,
  event: object
): Promise<void> {
  await postJSON(`${FLUVIO_RELAY_URL}/publish`, { topic, event });
  // Also push to consumer for routing
  await postJSON(`${FLUVIO_CONSUMER_URL}/publish`, {
    topic: `ndsep.${topic.replace(/-/g, ".")}`,
    event,
  });
}

// ─── OpenSearch ──────────────────────────────────────────────────────────────

/** Index a document in OpenSearch */
export async function opensearchIndex(
  index: string,
  doc: object
): Promise<void> {
  await postJSON(`${OPENSEARCH_INDEXER_URL}/index`, { index, document: doc });
}

/** Search OpenSearch (returns results or empty array on error) */
export async function opensearchSearch(
  index: string,
  params: object
): Promise<unknown[]> {
  const resp = await fetch(`${OPENSEARCH_QUERY_URL}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index, ...params }),
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok)
    throw new Error(`OpenSearch query failed with HTTP ${resp.status}`);
  const data = (await resp.json()) as {
    result?: { hits?: { hits?: unknown[] } };
  };
  return data.result?.hits?.hits ?? [];
}

/** Global search across all NDSEP indices */
export async function opensearchGlobalSearch(
  q: string,
  sectors?: string[]
): Promise<unknown[]> {
  const resp = await fetch(`${OPENSEARCH_QUERY_URL}/search/global`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q, sectors }),
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok)
    throw new Error(`OpenSearch global query failed with HTTP ${resp.status}`);
  const data = (await resp.json()) as {
    result?: { hits?: { hits?: unknown[] } };
  };
  return data.result?.hits?.hits ?? [];
}

// ─── Lakehouse ───────────────────────────────────────────────────────────────

/** Ingest records into the NDSEP data lakehouse */
export async function lakehouseIngest(
  table: string,
  records: object[]
): Promise<void> {
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
export async function keycloakValidate(
  token: string,
  requiredRoles?: string[]
): Promise<{
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
    return (await resp.json()) as {
      valid: boolean;
      roles: string[];
      sub?: string;
      username?: string;
    };
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
    entityType,
    entityId,
    relation,
    subjectType: "user",
    subjectId,
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

// ─── Financial-provider reconciliation ──────────────────────────────────────

export type FinancialProviderTransferState =
  | "not_found"
  | "pending"
  | "committed"
  | "aborted";

async function lookupTransferState(
  adapter: "tigerbeetle" | "mojaloop",
  reference: string
): Promise<FinancialProviderTransferState> {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(reference))
    throw new Error("Invalid financial transfer reference");
  const base =
    adapter === "tigerbeetle" ? TIGERBEETLE_LEDGER_URL : MOJALOOP_ADAPTER_URL;
  let response: Response;
  try {
    response = await fetch(
      `${base}/transfers/${encodeURIComponent(reference)}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(3_000),
      }
    );
  } catch (error) {
    throw new Error(
      `${adapter} reconciliation lookup unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (response.status === 404) return "not_found";
  if (!response.ok)
    throw new Error(
      `${adapter} reconciliation lookup failed with HTTP ${response.status}`
    );
  const payload = (await response.json().catch(() => null)) as {
    state?: unknown;
    transferState?: unknown;
    status?: unknown;
  } | null;
  const raw = String(
    payload?.state ?? payload?.transferState ?? payload?.status ?? ""
  ).toUpperCase();
  if (["COMMITTED", "SETTLED", "SUCCESS", "COMPLETED"].includes(raw))
    return "committed";
  if (["ABORTED", "FAILED", "REJECTED", "CANCELLED"].includes(raw))
    return "aborted";
  if (
    ["PENDING", "PROCESSING", "RESERVED", "ACCEPTED", "PREPARED"].includes(raw)
  )
    return "pending";
  throw new Error(
    `${adapter} reconciliation lookup returned an unrecognized transfer state`
  );
}

/** Query the approved TigerBeetle adapter by immutable user-data reference. */
export async function lookupTigerBeetleTransfer(
  reference: string
): Promise<FinancialProviderTransferState> {
  return lookupTransferState("tigerbeetle", reference);
}

/** Query the approved Mojaloop adapter by immutable transfer reference. */
export async function lookupMojaloopTransfer(
  reference: string
): Promise<FinancialProviderTransferState> {
  return lookupTransferState("mojaloop", reference);
}
