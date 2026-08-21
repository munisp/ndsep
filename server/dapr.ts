import { logger } from "./logger";
/**
 * NDSEP Dapr Sidecar Client (Node.js)
 * =====================================
 * Connects to the Dapr sidecar HTTP API for:
 *   - Pub/Sub: publish events to Dapr pub/sub components (Kafka, Redis Streams)
 *   - State Store: get/set/delete state via Dapr state API
 *   - Service Invocation: invoke other NDSEP microservices via Dapr
 *
 * Environment variables:
 *   DAPR_HTTP_PORT  — Dapr sidecar HTTP port (default: 3500)
 *   DAPR_APP_ID     — This app's Dapr app ID (default: ndsep-server)
 *   DAPR_ENABLED    — "true" | "false" (default: "true")
 *
 * Dapr pub/sub component: ndsep-pubsub (backed by Kafka or Redis Streams)
 * Dapr state store:       ndsep-state  (backed by Redis)
 */

const DAPR_PORT = process.env.DAPR_HTTP_PORT ?? "3500";
const DAPR_APP_ID = process.env.DAPR_APP_ID ?? "ndsep-server";
const DAPR_ENABLED = (process.env.DAPR_ENABLED ?? "true") === "true";
const DAPR_BASE = `http://localhost:${DAPR_PORT}`;

const PUBSUB_NAME = "ndsep-pubsub";
const STATE_STORE = "ndsep-state";

let daprConnected = false;
let pubCount = 0;
let pubErrors = 0;
let stateOps = 0;
let stateErrors = 0;

// ─── Health Check ─────────────────────────────────────────────────────────────

async function checkDaprHealth(): Promise<boolean> {
  if (!DAPR_ENABLED) return false;
  try {
    const res = await fetch(`${DAPR_BASE}/v1.0/healthz`, {
      signal: AbortSignal.timeout(3000),
    });
    const ok = res.ok;
    if (ok && !daprConnected) logger.info(`[Dapr] Connected to sidecar on port ${DAPR_PORT}`);
    if (!ok && daprConnected) logger.warn(`[Dapr] Sidecar unhealthy`);
    daprConnected = ok;
    return ok;
  } catch {
    daprConnected = false;
    return false;
  }
}

if (DAPR_ENABLED) {
  checkDaprHealth();
  setInterval(checkDaprHealth, 30_000);
}

// ─── Pub/Sub ──────────────────────────────────────────────────────────────────

export async function daprPublish(
  topic: string,
  data: Record<string, unknown>,
  metadata?: Record<string, string>
): Promise<boolean> {
  if (!DAPR_ENABLED || !daprConnected) return false;
  try {
    const url = `${DAPR_BASE}/v1.0/publish/${PUBSUB_NAME}/${encodeURIComponent(topic)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(metadata?.ttlInSeconds ? { "metadata.ttlInSeconds": metadata.ttlInSeconds } : {}),
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) { pubCount++; return true; }
    pubErrors++;
    return false;
  } catch {
    pubErrors++;
    return false;
  }
}

// ─── State Store ──────────────────────────────────────────────────────────────

export async function daprStateSet(
  key: string,
  value: unknown,
  ttlSeconds?: number
): Promise<boolean> {
  if (!DAPR_ENABLED || !daprConnected) return false;
  try {
    const body = [{
      key,
      value,
      metadata: ttlSeconds ? { ttlInSeconds: String(ttlSeconds) } : undefined,
    }];
    const res = await fetch(`${DAPR_BASE}/v1.0/state/${STATE_STORE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) { stateOps++; return true; }
    stateErrors++;
    return false;
  } catch {
    stateErrors++;
    return false;
  }
}

export async function daprStateGet<T = unknown>(key: string): Promise<T | null> {
  if (!DAPR_ENABLED || !daprConnected) return null;
  try {
    const res = await fetch(`${DAPR_BASE}/v1.0/state/${STATE_STORE}/${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) { stateErrors++; return null; }
    stateOps++;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    stateErrors++;
    return null;
  }
}

export async function daprStateDel(key: string): Promise<boolean> {
  if (!DAPR_ENABLED || !daprConnected) return false;
  try {
    const res = await fetch(`${DAPR_BASE}/v1.0/state/${STATE_STORE}/${encodeURIComponent(key)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) { stateOps++; return true; }
    stateErrors++;
    return false;
  } catch {
    stateErrors++;
    return false;
  }
}

// ─── Service Invocation ───────────────────────────────────────────────────────

export async function daprInvoke(
  appId: string,
  method: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  if (!DAPR_ENABLED || !daprConnected) return null;
  try {
    const res = await fetch(`${DAPR_BASE}/v1.0/invoke/${appId}/method/${method}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

export function daprMetrics() {
  return {
    connected: daprConnected,
    enabled: DAPR_ENABLED,
    sidecarUrl: DAPR_BASE,
    appId: DAPR_APP_ID,
    pubsubName: PUBSUB_NAME,
    stateStore: STATE_STORE,
    pubCount,
    pubErrors,
    stateOps,
    stateErrors,
  };
}

export { daprConnected, checkDaprHealth };
