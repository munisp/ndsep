/**
 * OpenSearch Full-Text Search Integration
 * =========================================
 * Provides full-text search across organizations, violations, and breaches.
 * Supports Nigerian-context search (organization names, locations, sectors).
 */

import { logger } from "../logger";

const OS_URL = process.env.OPENSEARCH_URL ?? "http://localhost:9200";
const OS_USER = process.env.OPENSEARCH_USER ?? "admin";
const OS_PASS = process.env.OPENSEARCH_PASS ?? "admin";

// Index definitions
export const INDICES = {
  ORGANIZATIONS: "ndsep-organizations",
  VIOLATIONS: "ndsep-violations",
  BREACHES: "ndsep-breaches",
  AUDIT_LOGS: "ndsep-audit-logs",
  ASSETS: "ndsep-assets",
} as const;

function authHeader(): string {
  return "Basic " + Buffer.from(`${OS_USER}:${OS_PASS}`).toString("base64");
}

// ── Search Operations ────────────────────────────────────────────────────────

export interface SearchResult<T = unknown> {
  hits: Array<{ id: string; score: number; source: T }>;
  total: number;
  took: number;
}

export async function search(index: string, query: string, options?: { from?: number; size?: number; filters?: Record<string, unknown> }): Promise<SearchResult> {
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
      headers: { "Content-Type": "application/json", Authorization: authHeader() },
      body: JSON.stringify(body),
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
    logger.warn({ err, index, query }, "[OpenSearch] Search failed");
    return { hits: [], total: 0, took: 0 };
  }
}

// ── Indexing Operations ──────────────────────────────────────────────────────

export async function indexDocument(index: string, id: string, document: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${OS_URL}/${index}/_doc/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: authHeader() },
      body: JSON.stringify(document),
    });
    return res.ok;
  } catch (err) {
    logger.warn({ err, index, id }, "[OpenSearch] Indexing failed");
    return false;
  }
}

export async function bulkIndex(index: string, documents: Array<{ id: string; doc: unknown }>): Promise<number> {
  try {
    const bulkBody = documents.flatMap(d => [
      JSON.stringify({ index: { _index: index, _id: d.id } }),
      JSON.stringify(d.doc),
    ]).join("\n") + "\n";

    const res = await fetch(`${OS_URL}/_bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/x-ndjson", Authorization: authHeader() },
      body: bulkBody,
    });

    const data = await res.json();
    return documents.length - (data.errors ? data.items.filter((i: any) => i.index?.error).length : 0);
  } catch (err) {
    logger.warn({ err, index }, "[OpenSearch] Bulk index failed");
    return 0;
  }
}

// ── Health Check ─────────────────────────────────────────────────────────────

export async function checkOpenSearchHealth(): Promise<{ healthy: boolean; url: string; clusterStatus?: string }> {
  try {
    const res = await fetch(`${OS_URL}/_cluster/health`, {
      headers: { Authorization: authHeader() },
    });
    if (!res.ok) return { healthy: false, url: OS_URL };
    const data = await res.json();
    return { healthy: data.status !== "red", url: OS_URL, clusterStatus: data.status };
  } catch {
    return { healthy: false, url: OS_URL };
  }
}
