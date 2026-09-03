/**
 * NDSEP OpenSearch Integration
 * ===============================
 * Full-text search and analytics for audit logs, compliance data,
 * breach incidents, and security alerts.
 *
 * Features:
 *   - Index management (create, delete, refresh)
 *   - Document indexing (single + bulk)
 *   - Full-text search with highlighting
 *   - Aggregations for dashboards
 *   - Health check with cluster info
 *   - Explicit failure when required indexing or search operations are unavailable
 *
 * Environment:
 *   OPENSEARCH_URL      — OpenSearch URL (default: http://localhost:9200)
 *   OPENSEARCH_USERNAME — Basic auth username (optional)
 *   OPENSEARCH_PASSWORD — Basic auth password (optional)
 *   OPENSEARCH_ENABLED  — "true" | "false" (default: "true")
 */

import { logger } from "./logger";
import { captureError } from "./errorMonitoring";
import { assertOpenSearchIndex, getOpenSearchConfig } from "./opensearchConfig";

const openSearchConfig = getOpenSearchConfig();
const OPENSEARCH_URL = openSearchConfig.url;
const OPENSEARCH_USERNAME = openSearchConfig.username;
const OPENSEARCH_PASSWORD = openSearchConfig.password;
const OPENSEARCH_ENABLED = openSearchConfig.enabled;

let connected = false;
let indexed = 0;
let searched = 0;
let errors = 0;

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (OPENSEARCH_USERNAME && OPENSEARCH_PASSWORD) {
    headers["Authorization"] = `Basic ${Buffer.from(`${OPENSEARCH_USERNAME}:${OPENSEARCH_PASSWORD}`).toString("base64")}`;
  }
  return headers;
}

async function osRequest(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  if (!OPENSEARCH_ENABLED) return { ok: false, status: 0, data: { error: "OpenSearch disabled" } };
  try {
    const res = await fetch(`${OPENSEARCH_URL}${path}`, {
      method,
      headers: authHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && !connected) {
      connected = true;
      logger.info(`[OpenSearch] Connected at ${OPENSEARCH_URL}`);
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    if (connected) {
      connected = false;
      logger.warn("[OpenSearch] Connection lost — degrading gracefully");
    }
    errors++;
    return { ok: false, status: 0, data: { error: err instanceof Error ? err.message : String(err) } };
  }
}

// ─── Health ──────────────────────────────────────────────────────────────────

export async function opensearchHealth(): Promise<{
  connected: boolean;
  clusterName?: string;
  status?: string;
  nodeCount?: number;
  indexCount?: number;
  docCount?: number;
  metrics: { indexed: number; searched: number; errors: number };
}> {
  const { ok, data } = await osRequest("GET", "/_cluster/health");
  if (!ok) return { connected: false, metrics: { indexed, searched, errors } };
  const d = data as Record<string, unknown>;
  return {
    connected: true,
    clusterName: String(d.cluster_name ?? ""),
    status: String(d.status ?? ""),
    nodeCount: Number(d.number_of_nodes ?? 0),
    indexCount: Number(d.active_primary_shards ?? 0),
    docCount: 0,
    metrics: { indexed, searched, errors },
  };
}

// ─── Index Management ────────────────────────────────────────────────────────

const NDSEP_INDICES = [
  {
    name: "ndsep-audit-logs",
    mappings: {
      properties: {
        action: { type: "keyword" },
        userId: { type: "integer" },
        orgId: { type: "integer" },
        details: { type: "text" },
        ipAddress: { type: "ip" },
        timestamp: { type: "date" },
      },
    },
  },
  {
    name: "ndsep-breach-incidents",
    mappings: {
      properties: {
        orgId: { type: "integer" },
        severity: { type: "keyword" },
        status: { type: "keyword" },
        description: { type: "text" },
        detectedAt: { type: "date" },
        resolvedAt: { type: "date" },
      },
    },
  },
  {
    name: "ndsep-security-alerts",
    mappings: {
      properties: {
        orgId: { type: "integer" },
        alertType: { type: "keyword" },
        severity: { type: "keyword" },
        source: { type: "keyword" },
        title: { type: "text" },
        description: { type: "text" },
        detectedAt: { type: "date" },
      },
    },
  },
  {
    name: "ndsep-compliance-events",
    mappings: {
      properties: {
        orgId: { type: "integer" },
        sector: { type: "keyword" },
        eventType: { type: "keyword" },
        severity: { type: "keyword" },
        title: { type: "text" },
        timestamp: { type: "date" },
      },
    },
  },
];

const NDSEP_INDEX_NAMES = NDSEP_INDICES.map((index) => index.name);

export async function ensureIndices(): Promise<{ created: string[]; existing: string[] }> {
  const created: string[] = [];
  const existing: string[] = [];

  for (const idx of NDSEP_INDICES) {
    const { ok, status, data } = await osRequest("HEAD", `/${idx.name}`);
    if (ok) {
      existing.push(idx.name);
      continue;
    }
    if (status !== 404) {
      throw new Error(`OpenSearch index check failed for ${idx.name}: ${status || "connection unavailable"} ${JSON.stringify(data)}`);
    }

    const { ok: createOk, status: createStatus, data: createData } = await osRequest("PUT", `/${idx.name}`, { mappings: idx.mappings });
    if (!createOk) {
      throw new Error(`OpenSearch index creation failed for ${idx.name}: ${createStatus || "connection unavailable"} ${JSON.stringify(createData)}`);
    }
    created.push(idx.name);
  }

  return { created, existing };
}

// ─── Document Operations ─────────────────────────────────────────────────────

export async function indexDocument(index: string, id: string, doc: Record<string, unknown>): Promise<boolean> {
  assertOpenSearchIndex(index, NDSEP_INDEX_NAMES);
  const { ok, status, data } = await osRequest("PUT", `/${index}/_doc/${id}`, doc);
  if (!ok) {
    throw new Error(`OpenSearch document index failed for ${index}/${id}: ${status || "connection unavailable"} ${JSON.stringify(data)}`);
  }
  indexed++;
  return true;
}

export async function bulkIndex(index: string, docs: Array<{ id: string; doc: Record<string, unknown> }>): Promise<number> {
  assertOpenSearchIndex(index, NDSEP_INDEX_NAMES);
  if (docs.length === 0) return 0;
  if (!OPENSEARCH_ENABLED) throw new Error("OpenSearch is disabled; bulk indexing cannot be acknowledged");
  const lines: string[] = [];
  for (const { id, doc } of docs) {
    lines.push(JSON.stringify({ index: { _index: index, _id: id } }));
    lines.push(JSON.stringify(doc));
  }
  const body = lines.join("\n") + "\n";
  try {
    const res = await fetch(`${OPENSEARCH_URL}/_bulk`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/x-ndjson" },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({})) as { errors?: boolean; items?: Array<{ index?: { status?: number; error?: unknown } }> };
    const rejected = data.items?.filter((item) => (item.index?.status ?? 500) >= 300 || item.index?.error) ?? [];
    if (!res.ok || data.errors || rejected.length > 0) {
      throw new Error(`OpenSearch bulk index failed for ${index}: HTTP ${res.status}; rejected=${rejected.length}`);
    }
    indexed += docs.length;
    return docs.length;
  } catch (err) {
    errors++;
    throw err instanceof Error ? err : new Error(String(err));
  }
}

// ─── Search ──────────────────────────────────────────────────────────────────

export async function search(
  index: string,
  query: Record<string, unknown>,
  options?: { size?: number; from?: number; sort?: unknown; highlight?: unknown },
): Promise<{ hits: unknown[]; total: number; took: number }> {
  assertOpenSearchIndex(index, NDSEP_INDEX_NAMES);
  const body: Record<string, unknown> = {
    query,
    size: options?.size ?? 20,
    from: options?.from ?? 0,
  };
  if (options?.sort) body.sort = options.sort;
  if (options?.highlight) body.highlight = options.highlight;

  const { ok, status, data } = await osRequest("POST", `/${index}/_search`, body);
  searched++;
  if (!ok) throw new Error(`OpenSearch search failed for ${index}: ${status || "connection unavailable"} ${JSON.stringify(data)}`);

  const d = data as Record<string, unknown>;
  const hits = d.hits as Record<string, unknown> | undefined;
  const hitsArray = (hits?.hits ?? []) as unknown[];
  const total = typeof hits?.total === "object"
    ? (hits.total as Record<string, unknown>).value as number
    : (hits?.total as number) ?? 0;

  return { hits: hitsArray, total, took: (d.took as number) ?? 0 };
}

export async function fullTextSearch(index: string, queryText: string, fields: string[] = ["title", "description", "details"]) {
  return search(index, {
    multi_match: { query: queryText, fields, fuzziness: "AUTO" },
  }, {
    highlight: { fields: Object.fromEntries(fields.map((f) => [f, {}])) },
  });
}

// ─── Aggregations ────────────────────────────────────────────────────────────

export async function aggregate(
  index: string,
  aggs: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { ok, status, data } = await osRequest("POST", `/${index}/_search`, {
    size: 0,
    query: query ?? { match_all: {} },
    aggs,
  });
  if (!ok) throw new Error(`OpenSearch aggregation failed for ${index}: ${status || "connection unavailable"} ${JSON.stringify(data)}`);
  return ((data as Record<string, unknown>).aggregations ?? {}) as Record<string, unknown>;
}

// ─── Smoke Test ──────────────────────────────────────────────────────────────

export async function opensearchSmokeTest() {
  const health = await opensearchHealth();
  if (!health.connected) throw new Error("OpenSearch smoke test failed: cluster is unavailable");
  const indices = await ensureIndices();
  return { health, indices };
}

// Initial connection check + auto-create indices
if (OPENSEARCH_ENABLED) {
  opensearchHealth().then(async (h) => {
    if (h.connected) {
      const result = await ensureIndices();
      if (result.created.length > 0) {
        logger.info({ created: result.created }, "[OpenSearch] Auto-created indices on startup");
      }
    }
  }).catch(() => {
    logger.warn("[OpenSearch] Not available — full-text search degraded");
  });
}
