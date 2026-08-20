/**
 * NDSEP OpenAppSec (WAF) Integration
 * =====================================
 * Web Application Firewall integration for protecting NDSEP API
 * endpoints against OWASP Top 10, DDoS, and API abuse.
 *
 * Features:
 *   - WAF policy management (create, update, list)
 *   - Threat event querying
 *   - IP reputation and blocking
 *   - Rate limiting policy sync
 *   - Health check with policy status
 *   - Explicit unavailable state when WAF management is unavailable
 *
 * Environment:
 *   OPENAPPSEC_URL     — OpenAppSec management URL (default: http://localhost:4000)
 *   OPENAPPSEC_TOKEN   — API token for management API (optional)
 *   OPENAPPSEC_ENABLED — "true" | "false" (default: "true")
 */

import { logger } from "./logger";
import { captureError } from "./errorMonitoring";

const OPENAPPSEC_URL = process.env.OPENAPPSEC_URL ?? "http://localhost:4000";
const OPENAPPSEC_TOKEN = process.env.OPENAPPSEC_TOKEN;
const OPENAPPSEC_ENABLED = (process.env.OPENAPPSEC_ENABLED ?? "true") === "true";

let connected = false;
let blockedRequests = 0;
let errors = 0;

function wafHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (OPENAPPSEC_TOKEN) h["Authorization"] = `Bearer ${OPENAPPSEC_TOKEN}`;
  return h;
}

async function wafRequest(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  if (!OPENAPPSEC_ENABLED) return { ok: false, status: 0, data: { error: "OpenAppSec disabled" } };
  try {
    const res = await fetch(`${OPENAPPSEC_URL}${path}`, {
      method,
      headers: wafHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5_000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && !connected) {
      connected = true;
      logger.info(`[OpenAppSec] Connected at ${OPENAPPSEC_URL}`);
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    if (connected) {
      connected = false;
      logger.error("[OpenAppSec] Management connection lost; deployment health must be investigated");
    }
    errors++;
    return { ok: false, status: 0, data: { error: err instanceof Error ? err.message : String(err) } };
  }
}

// ─── Health ──────────────────────────────────────────────────────────────────

export async function openappsecHealth(): Promise<{
  connected: boolean;
  url: string;
  enabled: boolean;
  metrics: { blockedRequests: number; errors: number };
}> {
  const { ok } = await wafRequest("GET", "/api/v1/health");
  return {
    connected: ok,
    url: OPENAPPSEC_URL,
    enabled: OPENAPPSEC_ENABLED,
    metrics: { blockedRequests, errors },
  };
}

// ─── Policy Management ───────────────────────────────────────────────────────

interface WafPolicy {
  name: string;
  mode: "prevent" | "detect" | "inactive";
  practices: string[];
  sourceIdentifiers: string[];
}

const NDSEP_POLICIES: WafPolicy[] = [
  {
    name: "ndsep-api-protection",
    mode: "prevent",
    practices: ["WebApplicationSecurity", "APIProtection", "BotDefense"],
    sourceIdentifiers: ["any"],
  },
  {
    name: "ndsep-admin-strict",
    mode: "prevent",
    practices: ["WebApplicationSecurity", "APIProtection", "BotDefense", "IPReputation"],
    sourceIdentifiers: ["admin-api"],
  },
  {
    name: "ndsep-public-portal",
    mode: "detect",
    practices: ["WebApplicationSecurity", "BotDefense"],
    sourceIdentifiers: ["public-portal"],
  },
];

export async function syncPolicies(): Promise<{ synced: string[]; failed: string[] }> {
  const synced: string[] = [];
  const failed: string[] = [];

  for (const policy of NDSEP_POLICIES) {
    const { ok } = await wafRequest("PUT", `/api/v1/policies/${policy.name}`, policy);
    if (ok) synced.push(policy.name);
    else failed.push(policy.name);
  }

  return { synced, failed };
}

export async function listPolicies(): Promise<WafPolicy[]> {
  const { ok, data } = await wafRequest("GET", "/api/v1/policies");
  if (!ok || !Array.isArray(data)) return [];
  return data as WafPolicy[];
}

// ─── Threat Events ───────────────────────────────────────────────────────────

export async function getRecentThreats(limit = 50): Promise<unknown[]> {
  const { ok, data } = await wafRequest("GET", `/api/v1/events?limit=${limit}&sort=desc`);
  if (!ok) return [];
  return (data as unknown[]) ?? [];
}

export async function getThreatStats(): Promise<Record<string, unknown>> {
  const { ok, data } = await wafRequest("GET", "/api/v1/events/stats");
  if (!ok) return { blocked: blockedRequests, errors };
  return data as Record<string, unknown>;
}

// ─── IP Management ───────────────────────────────────────────────────────────

export async function blockIp(ip: string, reason: string, durationMinutes = 1440): Promise<boolean> {
  const { ok } = await wafRequest("POST", "/api/v1/ip-block", {
    ip,
    reason,
    duration: durationMinutes * 60,
  });
  if (ok) blockedRequests++;
  return ok;
}

export async function unblockIp(ip: string): Promise<boolean> {
  const { ok } = await wafRequest("DELETE", `/api/v1/ip-block/${encodeURIComponent(ip)}`);
  return ok;
}

// ─── Smoke Test ──────────────────────────────────────────────────────────────

export function openappsecMetrics() {
  return {
    connected,
    enabled: OPENAPPSEC_ENABLED,
    url: OPENAPPSEC_URL,
    blockedRequests,
    errors,
  };
}

export async function openappsecSmokeTest() {
  const health = await openappsecHealth();
  const policies = await listPolicies();
  return { health, policyCount: policies.length, policies: policies.map((p) => p.name) };
}

if (OPENAPPSEC_ENABLED) {
  openappsecHealth().then(async (h) => {
    if (h.connected) {
      const result = await syncPolicies();
      if (result.synced.length > 0) {
        logger.info({ synced: result.synced }, "[OpenAppSec] Auto-synced WAF policies on startup");
      }
    }
  }).catch(() => {
    logger.error("[OpenAppSec] Management endpoint unavailable; no fallback WAF state is reported");
  });
}
