/**
 * NDSEP Lakehouse Client (Apache Iceberg REST Catalog)
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides a TypeScript client for the NDSEP Lakehouse layer:
 *   - Apache Iceberg REST catalog for table management
 *   - Lakehouse Python service HTTP API for query execution
 *
 * Configuration (via env vars):
 *   LAKEHOUSE_CATALOG_URL  — Iceberg REST catalog endpoint (default: http://localhost:8181)
 *   LAKEHOUSE_S3_ENDPOINT  — MinIO/S3 endpoint for object storage
 *   LAKEHOUSE_S3_BUCKET    — S3 bucket name for lakehouse data
 *   LAKEHOUSE_ENABLED      — Set to "false" to disable (graceful degradation)
 *   ORCHESTRATION_LAKEHOUSE_URL — Lakehouse Python service URL (default: http://localhost:8140)
 *
 * All functions degrade gracefully when the lakehouse is unavailable.
 */

import { logger } from "./logger";

const CATALOG_URL = process.env.LAKEHOUSE_CATALOG_URL ?? "http://localhost:8181";
const SERVICE_URL = process.env.ORCHESTRATION_LAKEHOUSE_URL ?? "http://localhost:8140";
const ENABLED = process.env.LAKEHOUSE_ENABLED !== "false";
const TIMEOUT_MS = 8000;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LakehouseTable {
  namespace: string;
  name: string;
  fullName: string;
  location?: string;
  format?: string;
  snapshotId?: string;
  recordCount?: number;
}

export interface LakehouseHealthResult {
  healthy: boolean;
  catalogUrl: string;
  tablesLoaded?: number;
  namespaces?: string[];
  error?: string;
}

export interface LakehouseQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  executionMs: number;
  error?: string;
}

export interface LakehouseIngestResult {
  success: boolean;
  rowsIngested?: number;
  snapshotId?: string;
  error?: string;
}

// ── Health check ───────────────────────────────────────────────────────────────

export async function lakehouseHealth(): Promise<LakehouseHealthResult> {
  if (!ENABLED) return { healthy: false, catalogUrl: CATALOG_URL, error: "Lakehouse disabled via LAKEHOUSE_ENABLED=false" };
  try {
    // Try the Python service health endpoint first
    const svcRes = await fetch(`${SERVICE_URL}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (svcRes.ok) {
      const data = await svcRes.json() as any;
      return {
        healthy: true,
        catalogUrl: CATALOG_URL,
        tablesLoaded: data.tablesLoaded ?? data.tables ?? 0,
        namespaces: data.namespaces ?? [],
      };
    }
    // Fall back to Iceberg REST catalog
    const catRes = await fetch(`${CATALOG_URL}/v1/config`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!catRes.ok) return { healthy: false, catalogUrl: CATALOG_URL, error: `HTTP ${catRes.status}` };
    return { healthy: true, catalogUrl: CATALOG_URL };
  } catch (e: unknown) {
    logger.warn(`[Lakehouse] Health check failed: ${(e instanceof Error ? e.message : String(e))}`);
    return { healthy: false, catalogUrl: CATALOG_URL, error: (e instanceof Error ? e.message : String(e)) };
  }
}

// ── Namespace management ───────────────────────────────────────────────────────

export async function lakehouseListNamespaces(): Promise<string[]> {
  if (!ENABLED) return [];
  try {
    const res = await fetch(`${CATALOG_URL}/v1/namespaces`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return Array.isArray(data.namespaces) ? data.namespaces.map((n: any) => Array.isArray(n) ? n.join(".") : String(n)) : [];
  } catch (e: unknown) {
    logger.warn(`[Lakehouse] listNamespaces failed: ${(e instanceof Error ? e.message : String(e))}`);
    return [];
  }
}

export async function lakehouseCreateNamespace(namespace: string, properties?: Record<string, string>): Promise<{ success: boolean; error?: string }> {
  if (!ENABLED) return { success: false, error: "Lakehouse disabled" };
  try {
    const res = await fetch(`${CATALOG_URL}/v1/namespaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ namespace: [namespace], properties: properties ?? {} }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    return { success: true };
  } catch (e: unknown) {
    logger.warn(`[Lakehouse] createNamespace(${namespace}) failed: ${(e instanceof Error ? e.message : String(e))}`);
    return { success: false, error: (e instanceof Error ? e.message : String(e)) };
  }
}

// ── Table management ───────────────────────────────────────────────────────────

export async function lakehouseListTables(namespace = "ndsep"): Promise<LakehouseTable[]> {
  if (!ENABLED) return [];
  try {
    const res = await fetch(`${CATALOG_URL}/v1/namespaces/${encodeURIComponent(namespace)}/tables`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (Array.isArray(data.identifiers) ? data.identifiers : []).map((t: any) => ({
      namespace: t.namespace?.join(".") ?? namespace,
      name: t.name,
      fullName: `${namespace}.${t.name}`,
    }));
  } catch (e: unknown) {
    logger.warn(`[Lakehouse] listTables(${namespace}) failed: ${(e instanceof Error ? e.message : String(e))}`);
    return [];
  }
}

// ── Query execution (via Python lakehouse service) ─────────────────────────────

export async function lakehouseQuery(
  sql: string,
  params?: unknown[]
): Promise<LakehouseQueryResult> {
  if (!ENABLED) return { rows: [], rowCount: 0, executionMs: 0, error: "Lakehouse disabled" };
  const start = Date.now();
  try {
    const res = await fetch(`${SERVICE_URL}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params: params ?? [] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const executionMs = Date.now() - start;
    if (!res.ok) return { rows: [], rowCount: 0, executionMs, error: `HTTP ${res.status}` };
    const data = await res.json() as any;
    return {
      rows: data.rows ?? [],
      rowCount: data.rowCount ?? data.rows?.length ?? 0,
      executionMs,
    };
  } catch (e: unknown) {
    logger.warn(`[Lakehouse] query failed: ${(e instanceof Error ? e.message : String(e))}`);
    return { rows: [], rowCount: 0, executionMs: Date.now() - start, error: (e instanceof Error ? e.message : String(e)) };
  }
}

// ── Data ingestion ─────────────────────────────────────────────────────────────

export async function lakehouseIngest(
  table: string,
  records: Record<string, unknown>[],
  namespace = "ndsep"
): Promise<LakehouseIngestResult> {
  if (!ENABLED) return { success: false, error: "Lakehouse disabled" };
  try {
    const res = await fetch(`${SERVICE_URL}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ namespace, table, records }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const data = await res.json() as any;
    return { success: true, rowsIngested: data.rowsIngested ?? records.length, snapshotId: data.snapshotId };
  } catch (e: unknown) {
    logger.warn(`[Lakehouse] ingest(${namespace}.${table}) failed: ${(e instanceof Error ? e.message : String(e))}`);
    return { success: false, error: (e instanceof Error ? e.message : String(e)) };
  }
}

// ── Compaction ─────────────────────────────────────────────────────────────────

export async function lakehouseCompact(table: string, namespace = "ndsep"): Promise<{ success: boolean; filesCompacted?: number; error?: string }> {
  if (!ENABLED) return { success: false, error: "Lakehouse disabled" };
  try {
    const res = await fetch(`${SERVICE_URL}/compact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ namespace, table }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const data = await res.json() as any;
    return { success: true, filesCompacted: data.filesCompacted };
  } catch (e: unknown) {
    logger.warn(`[Lakehouse] compact(${namespace}.${table}) failed: ${(e instanceof Error ? e.message : String(e))}`);
    return { success: false, error: (e instanceof Error ? e.message : String(e)) };
  }
}

// ── Smoke test ─────────────────────────────────────────────────────────────────

export async function lakehouseSmokeTest(): Promise<{ success: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  const health = await lakehouseHealth();
  return { success: health.healthy, latencyMs: Date.now() - start, error: health.error };
}
