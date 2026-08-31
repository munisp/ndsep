/**
 * OpenSearch Full-Text Search Integration
 * =========================================
 * Provides full-text search across organizations, violations, and breaches.
 * Supports Nigerian-context search (organization names, locations, sectors).
 */

import { logger } from "../logger";
import { assertOpenSearchIndex, getOpenSearchConfig } from "../opensearchConfig";

const openSearchConfig = getOpenSearchConfig();
const OS_URL = openSearchConfig.url;
const OS_USER = openSearchConfig.username;
const OS_PASS = openSearchConfig.password;
const OS_ENABLED = openSearchConfig.enabled;

// Index definitions
export const INDICES = {
  ORGANIZATIONS: "ndsep-organizations",
  VIOLATIONS: "ndsep-violations",
  BREACHES: "ndsep-breaches",
  AUDIT_LOGS: "ndsep-audit-logs",
  ASSETS: "ndsep-assets",
} as const;

const MIDDLEWARE_INDEX_NAMES = Object.values(INDICES);

function authHeaders(): Record<string, string> {
  if (!OS_USER || !OS_PASS) return {};
  return { Authorization: "Basic " + Buffer.from(`${OS_USER}:${OS_PASS}`).toString("base64") };
}

// ── Search Operations ────────────────────────────────────────────────────────

export interface SearchResult<T = unknown> {
  hits: Array<{ id: string; score: number; source: T }>;
  total: number;
  took: number;
}

export async function search(index: string, query: string, options?: { from?: number; size?: number; filters?: Record<string, unknown> }): Promise<SearchResult> {
  assertOpenSearchIndex(index, MIDDLEWARE_INDEX_NAMES);
  if (!OS_ENABLED) return { hits: [], total: 0, took: 0 };
  try {
    const body: Record<string, unknown> = {
      query: {
        bool: {
          must: [
            { multi_match: { query, fields: ["name^3", "title^2", "description", "sector", "city", "contact_email"], fuzziness: "AUTO" } },
          ],
          filter: options?.filters ? Object.entries(options.filters).map(([field, value]) => ({ term: { [field]: value } })) : [],
        },
      },
      from: options?.from ?? 0,
      size: options?.size ?? 20,
      highlight: {
        fields: { name: {}, title: {}, description: {} },
        pre_tags: ["<mark>"],
        post_tags: ["</mark>"],
      },
    };

    const res = await fetch(`${OS_URL}/${index}/_search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`OpenSearch error: ${res.status}`);
    const data = await res.json();

    return {
      hits: (data.hits?.hits ?? []).map((hit: any) => ({
        id: hit._id,
        score: hit._score,
        source: hit._source,
      })),
      total: data.hits?.total?.value ?? 0,
      took: data.took ?? 0,
    };
  } catch (err) {
    logger.warn({ err, index, queryLength: query.length }, "[OpenSearch] Search failed");
    return { hits: [], total: 0, took: 0 };
  }
}

// ── Indexing Operations ──────────────────────────────────────────────────────

export async function indexDocument(index: string, id: string, document: unknown): Promise<boolean> {
  assertOpenSearchIndex(index, MIDDLEWARE_INDEX_NAMES);
  if (!OS_ENABLED) return false;
  try {
    const res = await fetch(`${OS_URL}/${index}/_doc/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(document),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch (err) {
    logger.warn({ err, index, id }, "[OpenSearch] Indexing failed");
    return false;
  }
}

export async function bulkIndex(index: string, documents: Array<{ id: string; doc: unknown }>): Promise<number> {
  assertOpenSearchIndex(index, MIDDLEWARE_INDEX_NAMES);
  if (!OS_ENABLED) return 0;
  try {
    const bulkBody = documents.flatMap(d => [
      JSON.stringify({ index: { _index: index, _id: d.id } }),
      JSON.stringify(d.doc),
    ]).join("\n") + "\n";

    const res = await fetch(`${OS_URL}/_bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/x-ndjson", ...authHeaders() },
      body: bulkBody,
      signal: AbortSignal.timeout(30_000),
    });

    const data = await res.json() as { errors?: boolean; items?: Array<{ index?: { error?: unknown } }> };
    if (!res.ok || data.errors) {
      throw new Error(`OpenSearch bulk index failed with HTTP ${res.status}`);
    }
    return documents.length;
  } catch (err) {
    logger.warn({ err, index }, "[OpenSearch] Bulk index failed");
    return 0;
  }
}

// ── Health Check ─────────────────────────────────────────────────────────────

export async function checkOpenSearchHealth(): Promise<{ healthy: boolean; url: string; clusterStatus?: string }> {
  if (!OS_ENABLED) return { healthy: false, url: OS_URL };
  try {
    const res = await fetch(`${OS_URL}/_cluster/health`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { healthy: false, url: OS_URL };
    const data = await res.json();
    return { healthy: data.status !== "red", url: OS_URL, clusterStatus: data.status };
  } catch {
    return { healthy: false, url: OS_URL };
  }
}
