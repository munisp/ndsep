/**
 * Dapr Sidecar Integration
 * ==========================
 * Integrates with Dapr runtime for service-to-service invocation,
 * state management, pub/sub, and distributed tracing.
 */

import { logger } from "../logger";

const DAPR_HTTP_PORT = process.env.DAPR_HTTP_PORT ?? "3500";
const DAPR_BASE_URL = `http://localhost:${DAPR_HTTP_PORT}/v1.0`;

export interface DaprConfig {
  httpPort: string;
  grpcPort: string;
  appId: string;
  baseUrl: string;
}

export function getDaprConfig(): DaprConfig {
  return {
    httpPort: process.env.DAPR_HTTP_PORT ?? "3500",
    grpcPort: process.env.DAPR_GRPC_PORT ?? "50001",
    appId: process.env.DAPR_APP_ID ?? "ndsep-api",
    baseUrl: DAPR_BASE_URL,
  };
}

// ── Service Invocation ───────────────────────────────────────────────────────

export async function invokeService(appId: string, method: string, data?: unknown): Promise<unknown> {
  try {
    const res = await fetch(`${DAPR_BASE_URL}/invoke/${appId}/method/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (!res.ok) throw new Error(`Dapr invoke failed: ${res.status}`);
    return res.json();
  } catch (err) {
    logger.warn({ err, appId, method }, "[Dapr] Service invocation failed");
    throw err;
  }
}

// ── State Store ──────────────────────────────────────────────────────────────

export async function saveState(storeName: string, key: string, value: unknown): Promise<void> {
  try {
    await fetch(`${DAPR_BASE_URL}/state/${storeName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ key, value }]),
    });
  } catch (err) {
    logger.warn({ err, storeName, key }, "[Dapr] State save failed");
  }
}

export async function getState(storeName: string, key: string): Promise<unknown> {
  try {
    const res = await fetch(`${DAPR_BASE_URL}/state/${storeName}/${key}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ── Pub/Sub ──────────────────────────────────────────────────────────────────

export async function publishEvent(pubsubName: string, topic: string, data: unknown): Promise<void> {
  try {
    await fetch(`${DAPR_BASE_URL}/publish/${pubsubName}/${topic}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch (err) {
    logger.warn({ err, topic }, "[Dapr] Pub/sub publish failed");
  }
}

// ── Health Check ─────────────────────────────────────────────────────────────

export async function checkDaprHealth(): Promise<{ healthy: boolean; metadata?: unknown }> {
  try {
    const res = await fetch(`http://localhost:${DAPR_HTTP_PORT}/v1.0/healthz`);
    return { healthy: res.ok };
  } catch {
    return { healthy: false };
  }
}
