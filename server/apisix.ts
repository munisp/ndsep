/**
 * APISIX API Gateway Client
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides a TypeScript client for the APISIX Admin API.
 * Used to dynamically manage routes, upstreams, plugins, and consumers.
 *
 * Configuration (via env vars):
 *   APISIX_ADMIN_URL   — APISIX admin API base URL (default: http://localhost:9180)
 *   APISIX_ADMIN_KEY   — APISIX admin API key (X-API-KEY header)
 *   APISIX_GATEWAY_URL — APISIX proxy base URL (default: http://localhost:9080)
 *   APISIX_ENABLED     — Set to "false" only when gateway management is intentionally disabled
 *
 * Management operations fail explicitly when APISIX is unavailable or unconfigured.
 */

import { logger } from "./logger";

const ADMIN_URL = process.env.APISIX_ADMIN_URL ?? "http://localhost:9180";
const ADMIN_KEY = process.env.APISIX_ADMIN_KEY;
const GATEWAY_URL = process.env.APISIX_GATEWAY_URL ?? "http://localhost:9080";
const ENABLED = process.env.APISIX_ENABLED !== "false";
const TIMEOUT_MS = 5000;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ApisixRoute {
  id?: string;
  name: string;
  uri: string;
  methods?: string[];
  upstream_id?: string;
  plugins?: Record<string, unknown>;
  status?: 0 | 1;
}

export interface ApisixUpstream {
  id?: string;
  name: string;
  type: "roundrobin" | "chash" | "ewma" | "least_conn";
  nodes: Record<string, number>;
  scheme?: "http" | "https" | "grpc" | "grpcs";
  pass_host?: "pass" | "node" | "rewrite";
  keepalive_pool?: { size: number; idle_timeout: number; requests: number };
}

export interface ApisixHealthResult {
  healthy: boolean;
  version?: string;
  routes?: number;
  upstreams?: number;
  error?: string;
}

// ── Internal helper ────────────────────────────────────────────────────────────

async function adminRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; data?: T; error?: string }> {
  if (!ENABLED) return { ok: false, error: "APISIX disabled via APISIX_ENABLED=false" };
  if (!ADMIN_KEY) return { ok: false, error: "APISIX_ADMIN_KEY is required for gateway administration" };
  try {
    const res = await fetch(`${ADMIN_URL}/apisix/admin${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": ADMIN_KEY,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json() as T;
    return { ok: true, data };
  } catch (e: unknown) {
    logger.warn(`[APISIX] ${method} ${path} failed: ${(e instanceof Error ? e.message : String(e))}`);
    return { ok: false, error: (e instanceof Error ? e.message : String(e)) };
  }
}

// ── Health check ───────────────────────────────────────────────────────────────

export async function apisixHealth(): Promise<ApisixHealthResult> {
  if (!ENABLED) return { healthy: false, error: "APISIX disabled" };
  if (!ADMIN_KEY) return { healthy: false, error: "APISIX_ADMIN_KEY is required for gateway administration" };
  try {
    const res = await fetch(`${ADMIN_URL}/apisix/admin/routes`, {
      headers: { "X-API-KEY": ADMIN_KEY },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { healthy: false, error: `HTTP ${res.status}` };
    const data = await res.json() as any;
    const routeCount = data?.list?.length ?? data?.total ?? 0;
    return { healthy: true, routes: routeCount };
  } catch (e: unknown) {
    logger.warn(`[APISIX] Health check failed: ${(e instanceof Error ? e.message : String(e))}`);
    return { healthy: false, error: (e instanceof Error ? e.message : String(e)) };
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────────

export async function apisixListRoutes(): Promise<ApisixRoute[]> {
  const result = await adminRequest<any>("GET", "/routes");
  if (!result.ok) throw new Error(`APISIX route listing failed: ${result.error}`);
  return result.data?.list ?? [];
}

export async function apisixCreateRoute(route: ApisixRoute): Promise<{ success: boolean; id?: string; error?: string }> {
  const id = route.id ?? `ndsep-${Date.now()}`;
  const result = await adminRequest("PUT", `/routes/${id}`, { ...route, id });
  if (!result.ok) return { success: false, error: result.error };
  return { success: true, id };
}

export async function apisixDeleteRoute(id: string): Promise<{ success: boolean; error?: string }> {
  const result = await adminRequest("DELETE", `/routes/${id}`);
  return { success: result.ok, error: result.error };
}

// ── Upstreams ──────────────────────────────────────────────────────────────────

export async function apisixListUpstreams(): Promise<ApisixUpstream[]> {
  const result = await adminRequest<any>("GET", "/upstreams");
  if (!result.ok) throw new Error(`APISIX upstream listing failed: ${result.error}`);
  return result.data?.list ?? [];
}

export async function apisixCreateUpstream(upstream: ApisixUpstream): Promise<{ success: boolean; id?: string; error?: string }> {
  const id = upstream.id ?? `ndsep-upstream-${Date.now()}`;
  const result = await adminRequest("PUT", `/upstreams/${id}`, { ...upstream, id });
  if (!result.ok) return { success: false, error: result.error };
  return { success: true, id };
}

// ── NDSEP default route sync ───────────────────────────────────────────────────

/**
 * Sync the standard NDSEP API routes into APISIX.
 * Called on startup and from the orchestration.apisixSyncRoutes tRPC procedure.
 */
export async function apisixSyncNdsepRoutes(): Promise<{ success: boolean; synced: number; errors: string[] }> {
  if (!ENABLED) return { success: false, synced: 0, errors: ["APISIX disabled"] };

  const NDSEP_ROUTES: ApisixRoute[] = [
    { id: "ndsep-trpc", name: "NDSEP tRPC API", uri: "/api/trpc/*", methods: ["GET", "POST"], plugins: { "proxy-rewrite": { uri: "/api/trpc/$1" } } },
    { id: "ndsep-oauth", name: "NDSEP OAuth Callback", uri: "/api/oauth/*", methods: ["GET", "POST"] },
    { id: "ndsep-ws", name: "NDSEP WebSocket", uri: "/ws", methods: ["GET"] },
    { id: "ndsep-health", name: "NDSEP Health", uri: "/health", methods: ["GET"] },
    // ── DPCO Microservices ────────────────────────────────────────────────────
    {
      id: "dpco-audit-service",
      name: "DPCO Audit Service (Go/Temporal)",
      uri: "/api/dpco/audit/*",
      methods: ["GET", "POST", "PUT", "DELETE"],
      plugins: {
        "proxy-rewrite": { regex_uri: ["/api/dpco/audit/(.*)", "/api/dpco/audit/$1"] },
        "limit-req": { rate: 100, burst: 50, key: "remote_addr" },
      },
    },
    {
      id: "dpco-registry-service",
      name: "DPCO Registry Service (Go/Dapr/TigerBeetle)",
      uri: "/api/dpco/registry/*",
      methods: ["GET", "POST", "PUT", "DELETE"],
      plugins: {
        "proxy-rewrite": { regex_uri: ["/api/dpco/registry/(.*)", "/api/dpco/registry/$1"] },
        "limit-req": { rate: 200, burst: 100, key: "remote_addr" },
        "response-rewrite": { headers: { "X-NDSEP-Service": "dpco-registry" } },
      },
    },
    {
      id: "dpco-verification-service",
      name: "DPCO Verification Service (Go/PKCS7/Temporal)",
      uri: "/api/dpco/verification/*",
      methods: ["GET", "POST"],
      plugins: {
        "proxy-rewrite": { regex_uri: ["/api/dpco/verification/(.*)", "/api/dpco/verification/$1"] },
        "limit-req": { rate: 50, burst: 20, key: "remote_addr" },
      },
    },
    {
      id: "dpco-analytics-service",
      name: "DPCO Analytics Service (Python/Lakehouse/Fluvio)",
      uri: "/api/dpco/analytics/*",
      methods: ["GET", "POST"],
      plugins: {
        "proxy-rewrite": { regex_uri: ["/api/dpco/analytics/(.*)", "/api/dpco/analytics/$1"] },
        "limit-req": { rate: 300, burst: 150, key: "remote_addr" },
      },
    },
    {
      id: "dpco-notification-service",
      name: "DPCO Notification Service (Python/Dapr/Kafka)",
      uri: "/api/dpco/notifications/*",
      methods: ["GET", "POST"],
      plugins: {
        "proxy-rewrite": { regex_uri: ["/api/dpco/notifications/(.*)", "/api/dpco/notifications/$1"] },
        "limit-req": { rate: 100, burst: 50, key: "remote_addr" },
      },
    },
  ];

  const errors: string[] = [];
  let synced = 0;

  for (const route of NDSEP_ROUTES) {
    const result = await apisixCreateRoute(route);
    if (result.success) {
      synced++;
    } else {
      errors.push(`${route.name}: ${result.error}`);
    }
  }

  return { success: errors.length === 0, synced, errors };
}

// ── Smoke test ─────────────────────────────────────────────────────────────────

export async function apisixSmokeTest(): Promise<{ success: boolean; latencyMs: number; gatewayUrl: string; error?: string }> {
  const start = Date.now();
  if (!ENABLED) return { success: false, latencyMs: 0, gatewayUrl: GATEWAY_URL, error: "APISIX disabled" };
  try {
    const health = await apisixHealth();
    const latencyMs = Date.now() - start;
    return { success: health.healthy, latencyMs, gatewayUrl: GATEWAY_URL, error: health.error };
  } catch (e: unknown) {
    return { success: false, latencyMs: Date.now() - start, gatewayUrl: GATEWAY_URL, error: (e instanceof Error ? e.message : String(e)) };
  }
}
