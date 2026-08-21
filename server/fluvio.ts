/**
 * Fluvio Edge Streaming Client
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides a TypeScript HTTP client for the Fluvio streaming platform.
 * Fluvio is used for edge telemetry ingestion and real-time stream analytics.
 *
 * Configuration (via env.ts):
 *   FLUVIO_HTTP_URL  — Fluvio HTTP proxy endpoint (default: http://localhost:9003)
 *   FLUVIO_ENABLED   — Set to "false" to disable (graceful degradation)
 *
 * All functions degrade gracefully when Fluvio is unavailable.
 */

import { logger } from "./logger";

const BASE = process.env.FLUVIO_HTTP_URL ?? "http://localhost:9003";
const ENABLED = process.env.FLUVIO_ENABLED !== "false";
const TIMEOUT_MS = 5000;

let fluvioConnected = false;
let produceCount = 0;
let consumeCount = 0;
let fluvioErrors = 0;

const NDSEP_EDGE_TOPICS = [
  "ndsep.telemetry",
  "ndsep.edge.events",
  "ndsep.canary",
  "ndsep.ixp.packets",
  "ndsep.alerts.realtime",
];

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FluvioRecord {
  key?: string;
  value: string | Record<string, unknown>;
}

export interface FluvioTopicInfo {
  name: string;
  partitions: number;
  replicationFactor: number;
  retentionMs?: number;
}

export interface FluvioHealthResult {
  healthy: boolean;
  version?: string;
  topics?: number;
  error?: string;
}

export interface FluvioProduceResult {
  success: boolean;
  offset?: number;
  error?: string;
}

export interface FluvioConsumeResult {
  records: Array<{ key: string | null; value: string; offset: number; timestamp: number }>;
  error?: string;
}

// ── Health check ───────────────────────────────────────────────────────────────

export async function fluvioHealth(): Promise<FluvioHealthResult> {
  if (!ENABLED) return { healthy: false, error: "Fluvio disabled via FLUVIO_ENABLED=false" };
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { healthy: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    fluvioConnected = true;
    return { healthy: true, version: data.version, topics: data.topics ?? 0 };
  } catch (e: unknown) {
    fluvioConnected = false;
    logger.warn(`[Fluvio] Health check failed: ${(e instanceof Error ? e.message : String(e))}`);
    return { healthy: false, error: (e instanceof Error ? e.message : String(e)) };
  }
}

// ── Topic management ───────────────────────────────────────────────────────────

export async function fluvioListTopics(): Promise<FluvioTopicInfo[]> {
  if (!ENABLED) return [];
  try {
    const res = await fetch(`${BASE}/topics`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.topics) ? data.topics : [];
  } catch (e: unknown) {
    logger.warn(`[Fluvio] listTopics failed: ${(e instanceof Error ? e.message : String(e))}`);
    return [];
  }
}

export async function fluvioCreateTopic(
  name: string,
  partitions = 1,
  replicationFactor = 1,
  retentionMs = 86_400_000 // 24h
): Promise<{ success: boolean; error?: string }> {
  if (!ENABLED) return { success: false, error: "Fluvio disabled" };
  try {
    const res = await fetch(`${BASE}/topics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, partitions, replicationFactor, retentionMs }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    return { success: true };
  } catch (e: unknown) {
    logger.warn(`[Fluvio] createTopic(${name}) failed: ${(e instanceof Error ? e.message : String(e))}`);
    return { success: false, error: (e instanceof Error ? e.message : String(e)) };
  }
}

// ── Produce ────────────────────────────────────────────────────────────────────

export async function fluvioProduce(
  topic: string,
  records: FluvioRecord[]
): Promise<FluvioProduceResult> {
  if (!ENABLED) return { success: false, error: "Fluvio disabled" };
  try {
    const payload = records.map(r => ({
      key: r.key ?? null,
      value: typeof r.value === "string" ? r.value : JSON.stringify(r.value),
    }));
    const res = await fetch(`${BASE}/produce/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: payload }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) { fluvioErrors++; return { success: false, error: `HTTP ${res.status}` }; }
    const data = await res.json();
    produceCount += records.length;
    return { success: true, offset: data.offset };
  } catch (e: unknown) {
    fluvioErrors++;
    logger.warn(`[Fluvio] produce(${topic}) failed: ${(e instanceof Error ? e.message : String(e))}`);
    return { success: false, error: (e instanceof Error ? e.message : String(e)) };
  }
}

// ── Consume (tail) ─────────────────────────────────────────────────────────────

export async function fluvioConsume(
  topic: string,
  limit = 50,
  fromOffset?: number
): Promise<FluvioConsumeResult> {
  if (!ENABLED) return { records: [], error: "Fluvio disabled" };
  try {
    const params = new URLSearchParams({ limit: String(limit) });
    if (fromOffset !== undefined) params.set("from", String(fromOffset));
    const res = await fetch(`${BASE}/consume/${encodeURIComponent(topic)}?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) { fluvioErrors++; return { records: [], error: `HTTP ${res.status}` }; }
    const data = await res.json();
    const recs = Array.isArray(data.records) ? data.records : [];
    consumeCount += recs.length;
    return { records: recs };
  } catch (e: unknown) {
    fluvioErrors++;
    logger.warn(`[Fluvio] consume(${topic}) failed: ${(e instanceof Error ? e.message : String(e))}`);
    return { records: [], error: (e instanceof Error ? e.message : String(e)) };
  }
}

// ── Telemetry ingestion (used by fluvio-telemetry worker) ─────────────────────

export async function fluvioIngestTelemetry(
  orgId: number,
  eventType: string,
  payload: Record<string, unknown>
): Promise<FluvioProduceResult> {
  return fluvioProduce("ndsep.telemetry", [{
    key: `org-${orgId}`,
    value: { orgId, eventType, payload, ts: Date.now() },
  }]);
}

// ── Metrics ────────────────────────────────────────────────────────────────────

export function fluvioMetrics() {
  return {
    connected: fluvioConnected,
    enabled: ENABLED,
    url: BASE,
    produced: produceCount,
    consumed: consumeCount,
    errors: fluvioErrors,
  };
}

export { fluvioConnected };

// ── Auto-create NDSEP edge topics on startup ──────────────────────────────────

async function ensureEdgeTopics(): Promise<void> {
  for (const topic of NDSEP_EDGE_TOPICS) {
    const result = await fluvioCreateTopic(topic, 1, 1, 86_400_000);
    if (result.success) {
      logger.info(`[Fluvio] Auto-created edge topic: ${topic}`);
    }
  }
}

if (ENABLED) {
  fluvioHealth().then(async (h) => {
    if (h.healthy) {
      await ensureEdgeTopics();
    }
  }).catch(() => {
    logger.warn("[Fluvio] Not available — edge streaming disabled (graceful degradation)");
  });
}

// ── Smoke test ─────────────────────────────────────────────────────────────────

export async function fluvioSmokeTest(): Promise<{ success: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  if (!ENABLED) return { success: false, latencyMs: 0, error: "Fluvio disabled" };
  try {
    const produceResult = await fluvioProduce("ndsep.canary", [{
      key: "smoke-test",
      value: { source: "ndsep-server", ts: Date.now() },
    }]);
    const latencyMs = Date.now() - start;
    if (!produceResult.success) return { success: false, latencyMs, error: produceResult.error };
    return { success: true, latencyMs };
  } catch (e: unknown) {
    return { success: false, latencyMs: Date.now() - start, error: (e instanceof Error ? e.message : String(e)) };
  }
}
