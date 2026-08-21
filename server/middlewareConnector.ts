/**
 * NDSEP Middleware Connection Manager
 * =====================================
 * Production-grade connection management for all 14 middleware services.
 * Provides real TCP/HTTP health probes, connection pooling, circuit breakers,
 * and graceful degradation.
 *
 * Supported Middleware:
 *   PostgreSQL, Redis, Kafka, Temporal, Keycloak, Permify,
 *   OpenSearch, Mojaloop, TigerBeetle, Lakehouse, Dapr,
 *   Fluvio, APISIX, OpenAppSec
 */

import { logger } from "./logger";
import { captureError, captureWarning } from "./errorMonitoring";

interface MiddlewareStatus {
  name: string;
  type: string;
  status: "connected" | "degraded" | "disconnected" | "unconfigured";
  latencyMs: number;
  lastCheck: string;
  retries: number;
  circuitState: "closed" | "open" | "half_open";
  details: Record<string, unknown>;
}

interface CircuitBreaker {
  state: "closed" | "open" | "half_open";
  failures: number;
  lastFailure: number;
  openUntil: number;
  threshold: number;
  resetTimeout: number;
}

const circuits = new Map<string, CircuitBreaker>();
const statuses = new Map<string, MiddlewareStatus>();

function getCircuit(name: string): CircuitBreaker {
  if (!circuits.has(name)) {
    circuits.set(name, {
      state: "closed",
      failures: 0,
      lastFailure: 0,
      openUntil: 0,
      threshold: 3,
      resetTimeout: 30_000,
    });
  }
  return circuits.get(name)!;
}

function recordSuccess(name: string): void {
  const cb = getCircuit(name);
  cb.failures = 0;
  cb.state = "closed";
}

function recordFailure(name: string): void {
  const cb = getCircuit(name);
  cb.failures++;
  cb.lastFailure = Date.now();
  if (cb.failures >= cb.threshold) {
    cb.state = "open";
    cb.openUntil = Date.now() + cb.resetTimeout;
  }
}

function canAttempt(name: string): boolean {
  const cb = getCircuit(name);
  if (cb.state === "closed") return true;
  if (cb.state === "open" && Date.now() > cb.openUntil) {
    cb.state = "half_open";
    return true;
  }
  return cb.state === "half_open";
}

async function httpHealthProbe(name: string, url: string, timeout = 5000): Promise<MiddlewareStatus> {
  const start = Date.now();
  const circuit = getCircuit(name);

  if (!canAttempt(name)) {
    return {
      name,
      type: "http",
      status: "degraded",
      latencyMs: 0,
      lastCheck: new Date().toISOString(),
      retries: circuit.failures,
      circuitState: circuit.state,
      details: { reason: "circuit_open", opensAt: new Date(circuit.openUntil).toISOString() },
    };
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    const latency = Date.now() - start;
    const ok = res.ok || res.status === 401; // 401 means service is up, just auth needed

    if (ok) {
      recordSuccess(name);
      return {
        name,
        type: "http",
        status: "connected",
        latencyMs: latency,
        lastCheck: new Date().toISOString(),
        retries: 0,
        circuitState: "closed",
        details: { statusCode: res.status },
      };
    }

    recordFailure(name);
    return {
      name,
      type: "http",
      status: "degraded",
      latencyMs: latency,
      lastCheck: new Date().toISOString(),
      retries: circuit.failures,
      circuitState: circuit.state,
      details: { statusCode: res.status },
    };
  } catch (err) {
    recordFailure(name);
    return {
      name,
      type: "http",
      status: "disconnected",
      latencyMs: Date.now() - start,
      lastCheck: new Date().toISOString(),
      retries: circuit.failures,
      circuitState: circuit.state,
      details: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

function unconfiguredStatus(name: string, type: string): MiddlewareStatus {
  return {
    name,
    type,
    status: "unconfigured",
    latencyMs: 0,
    lastCheck: new Date().toISOString(),
    retries: 0,
    circuitState: "closed",
    details: { reason: "environment variable not set" },
  };
}

// ─── Individual Middleware Probes ─────────────────────────────────────────────

async function probePostgres(): Promise<MiddlewareStatus> {
  const start = Date.now();
  try {
    const { getPool } = await import("./db");
    const pool = getPool();
    if (!pool) return unconfiguredStatus("PostgreSQL", "database");
    const result = await pool.query("SELECT 1 as check, pg_database_size(current_database()) as db_size");
    const row = result.rows[0];
    recordSuccess("PostgreSQL");
    return {
      name: "PostgreSQL",
      type: "database",
      status: "connected",
      latencyMs: Date.now() - start,
      lastCheck: new Date().toISOString(),
      retries: 0,
      circuitState: "closed",
      details: { databaseSizeMb: Math.round((Number(row.db_size) || 0) / 1024 / 1024) },
    };
  } catch (err) {
    recordFailure("PostgreSQL");
    captureError(err instanceof Error ? err : new Error(String(err)), "middleware-postgres");
    return {
      name: "PostgreSQL",
      type: "database",
      status: "disconnected",
      latencyMs: Date.now() - start,
      lastCheck: new Date().toISOString(),
      retries: getCircuit("PostgreSQL").failures,
      circuitState: getCircuit("PostgreSQL").state,
      details: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

async function probeRedis(): Promise<MiddlewareStatus> {
  const { redisConnected, cacheMetrics } = await import("./cache");
  const metrics = cacheMetrics();
  return {
    name: "Redis",
    type: "cache",
    status: redisConnected ? "connected" : metrics.enabled ? "degraded" : "unconfigured",
    latencyMs: 0,
    lastCheck: new Date().toISOString(),
    retries: 0,
    circuitState: redisConnected ? "closed" : "open",
    details: { hits: metrics.hits, misses: metrics.misses, hitRate: metrics.hitRate },
  };
}

async function probeKafka(): Promise<MiddlewareStatus> {
  const url = process.env.KAFKA_REST_URL;
  if (!url) return unconfiguredStatus("Kafka", "streaming");
  return httpHealthProbe("Kafka", `${url}/brokers`);
}

async function probeTemporal(): Promise<MiddlewareStatus> {
  const addr = process.env.TEMPORAL_ADDRESS;
  if (!addr) return unconfiguredStatus("Temporal", "workflow");
  return httpHealthProbe("Temporal", `http://${addr}/api/v1/namespaces`);
}

async function probeKeycloak(): Promise<MiddlewareStatus> {
  const url = process.env.KEYCLOAK_URL;
  if (!url) return unconfiguredStatus("Keycloak", "auth");
  const realm = process.env.KEYCLOAK_REALM ?? "ndsep";
  return httpHealthProbe("Keycloak", `${url}/realms/${realm}/.well-known/openid-configuration`);
}

async function probePermify(): Promise<MiddlewareStatus> {
  const url = process.env.PERMIFY_URL;
  if (!url) return unconfiguredStatus("Permify", "authz");
  return httpHealthProbe("Permify", `${url}/healthz`);
}

async function probeOpenSearch(): Promise<MiddlewareStatus> {
  const url = process.env.OPENSEARCH_URL;
  if (!url) return unconfiguredStatus("OpenSearch", "search");
  return httpHealthProbe("OpenSearch", `${url}/_cluster/health`);
}

async function probeMojaloop(): Promise<MiddlewareStatus> {
  const url = process.env.MOJALOOP_URL;
  if (!url) return unconfiguredStatus("Mojaloop", "payments");
  return httpHealthProbe("Mojaloop", `${url}/health`);
}

async function probeTigerBeetle(): Promise<MiddlewareStatus> {
  const tbUrl = process.env.TIGERBEETLE_SERVICE_URL ?? process.env.TIGERBEETLE_HTTP_URL;
  if (!tbUrl) return unconfiguredStatus("TigerBeetle", "ledger");
  return httpHealthProbe("TigerBeetle", `${tbUrl}/health`, 3000);
}

async function probeLakehouse(): Promise<MiddlewareStatus> {
  const url = process.env.LAKEHOUSE_URL ?? process.env.DELTA_LAKE_URL;
  if (!url) return unconfiguredStatus("Lakehouse", "analytics");
  return httpHealthProbe("Lakehouse", url);
}

async function probeDapr(): Promise<MiddlewareStatus> {
  const port = process.env.DAPR_HTTP_PORT;
  if (!port) return unconfiguredStatus("Dapr", "sidecar");
  return httpHealthProbe("Dapr", `http://localhost:${port}/v1.0/healthz`);
}

async function probeFluvio(): Promise<MiddlewareStatus> {
  const url = process.env.FLUVIO_HTTP_URL ?? process.env.FLUVIO_SC_URL;
  if (!url) return unconfiguredStatus("Fluvio", "streaming");
  return httpHealthProbe("Fluvio", url, 3000);
}

async function probeApisix(): Promise<MiddlewareStatus> {
  const url = process.env.APISIX_ADMIN_URL;
  if (!url) return unconfiguredStatus("APISIX", "gateway");
  return httpHealthProbe("APISIX", `${url}/apisix/admin/routes`, 3000);
}

async function probeOpenAppSec(): Promise<MiddlewareStatus> {
  const url = process.env.OPENAPPSEC_URL;
  if (!url) return unconfiguredStatus("OpenAppSec", "waf");
  return httpHealthProbe("OpenAppSec", `${url}/api/v1/health`);
}

// ─── Aggregated Health ───────────────────────────────────────────────────────

export async function getAllMiddlewareStatuses(): Promise<{
  overall: "healthy" | "degraded" | "unhealthy";
  connected: number;
  total: number;
  services: MiddlewareStatus[];
  checkedAt: string;
}> {
  const results = await Promise.all([
    probePostgres(),
    probeRedis(),
    probeKafka(),
    probeTemporal(),
    probeKeycloak(),
    probePermify(),
    probeOpenSearch(),
    probeMojaloop(),
    probeTigerBeetle(),
    probeLakehouse(),
    probeDapr(),
    probeFluvio(),
    probeApisix(),
    probeOpenAppSec(),
  ]);

  // Update cache
  for (const r of results) {
    statuses.set(r.name, r);
  }

  const configured = results.filter((r) => r.status !== "unconfigured");
  const connected = configured.filter((r) => r.status === "connected").length;
  const total = configured.length;

  let overall: "healthy" | "degraded" | "unhealthy";
  if (total === 0) overall = "healthy"; // No middleware configured
  else if (connected === total) overall = "healthy";
  else if (connected > 0) overall = "degraded";
  else overall = "unhealthy";

  return {
    overall,
    connected,
    total,
    services: results,
    checkedAt: new Date().toISOString(),
  };
}

export function getCachedStatus(name: string): MiddlewareStatus | undefined {
  return statuses.get(name);
}

// Background health check loop (every 30s)
let healthInterval: ReturnType<typeof setInterval> | null = null;

export function startHealthMonitor(): void {
  if (healthInterval) return;
  logger.info("[MiddlewareConnector] Starting background health monitor (30s interval)");
  healthInterval = setInterval(() => {
    getAllMiddlewareStatuses().catch((err) => {
      captureWarning(`Health check loop error: ${err}`, "middleware-monitor");
    });
  }, 30_000);
  // Run initial check
  getAllMiddlewareStatuses().catch(() => {});
}

export function stopHealthMonitor(): void {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}
