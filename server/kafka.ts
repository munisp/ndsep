import { logger } from "./logger";
/**
 * NDSEP Kafka Integration Module (Node.js)
 * ==========================================
 * Provides a lightweight HTTP client for Kafka REST Proxy and direct
 * Kafka producer/consumer via kafkajs.
 *
 * Features:
 *   - Produce messages to Kafka topics
 *   - Consume messages from Kafka topics (polling)
 *   - Topic management (create, list, describe)
 *   - Graceful degradation when Kafka is unreachable
 *   - Metrics: produced, consumed, errors
 *
 * Environment variables:
 *   KAFKA_REST_URL           - Kafka REST Proxy URL (default: http://localhost:8082)
 *   KAFKA_BOOTSTRAP_SERVERS  - Kafka broker list (default: localhost:9092)
 *   KAFKA_ENABLED            - "true" | "false" (default: "true")
 *   KAFKA_CLIENT_ID          - Kafka client ID (default: ndsep-server)
 */

const KAFKA_REST_URL = process.env.KAFKA_REST_URL ?? "http://localhost:8082";
const KAFKA_BOOTSTRAP = process.env.KAFKA_BOOTSTRAP_SERVERS ?? "localhost:9092";
const KAFKA_ENABLED = (process.env.KAFKA_ENABLED ?? "true") === "true";
const KAFKA_CLIENT_ID = process.env.KAFKA_CLIENT_ID ?? "ndsep-server";

let kafkaConnected = false;
let produced = 0;
let consumed = 0;
let errors = 0;

// ─── Health Check ─────────────────────────────────────────────────────────────

async function checkKafkaHealth(): Promise<boolean> {
  if (!KAFKA_ENABLED) return false;
  try {
    const res = await fetch(`${KAFKA_REST_URL}/brokers`, {
      signal: AbortSignal.timeout(3000),
    });
    const ok = res.ok;
    if (ok && !kafkaConnected) logger.info(`[Kafka] Connected via REST Proxy at ${KAFKA_REST_URL}`);
    if (!ok && kafkaConnected) logger.warn(`[Kafka] REST Proxy unhealthy`);
    kafkaConnected = ok;
    return ok;
  } catch {
    if (kafkaConnected) logger.warn(`[Kafka] REST Proxy unreachable — degrading gracefully`);
    kafkaConnected = false;
    return false;
  }
}

if (KAFKA_ENABLED) {
  checkKafkaHealth().catch(() => {
    logger.warn(`[Kafka] Could not connect — event streaming disabled (graceful degradation)`);
  });
  setInterval(checkKafkaHealth, 30_000);
}

// ─── Produce ──────────────────────────────────────────────────────────────────

export async function kafkaProduce(
  topic: string,
  key: string | null,
  value: Record<string, unknown>,
  headers?: Record<string, string>
): Promise<boolean> {
  if (!KAFKA_ENABLED || !kafkaConnected) return false;
  try {
    const records = {
      records: [{
        key: key ?? undefined,
        value,
        headers: headers ? Object.entries(headers).map(([k, v]) => ({ [k]: v })) : undefined,
      }],
    };
    const res = await fetch(`${KAFKA_REST_URL}/topics/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.kafka.json.v2+json",
        Accept: "application/vnd.kafka.v2+json",
      },
      body: JSON.stringify(records),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) { produced++; return true; }
    errors++;
    return false;
  } catch {
    errors++;
    return false;
  }
}

// ─── Produce Batch ────────────────────────────────────────────────────────────

export async function kafkaProduceBatch(
  topic: string,
  messages: Array<{ key?: string; value: Record<string, unknown> }>
): Promise<boolean> {
  if (!KAFKA_ENABLED || !kafkaConnected) return false;
  try {
    const records = {
      records: messages.map(m => ({
        key: m.key ?? undefined,
        value: m.value,
      })),
    };
    const res = await fetch(`${KAFKA_REST_URL}/topics/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.kafka.json.v2+json",
        Accept: "application/vnd.kafka.v2+json",
      },
      body: JSON.stringify(records),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) { produced += messages.length; return true; }
    errors++;
    return false;
  } catch {
    errors++;
    return false;
  }
}

// ─── Topic Management ─────────────────────────────────────────────────────────

export async function kafkaListTopics(): Promise<string[]> {
  if (!KAFKA_ENABLED || !kafkaConnected) return [];
  try {
    const res = await fetch(`${KAFKA_REST_URL}/topics`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    return await res.json() as string[];
  } catch {
    errors++;
    return [];
  }
}

export async function kafkaDescribeTopic(topic: string): Promise<Record<string, unknown> | null> {
  if (!KAFKA_ENABLED || !kafkaConnected) return null;
  try {
    const res = await fetch(`${KAFKA_REST_URL}/topics/${encodeURIComponent(topic)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch {
    errors++;
    return null;
  }
}

// ─── Consumer Group ───────────────────────────────────────────────────────────

export async function kafkaCreateConsumer(
  groupId: string,
  instanceId: string,
  autoOffsetReset: "earliest" | "latest" = "latest"
): Promise<string | null> {
  if (!KAFKA_ENABLED || !kafkaConnected) return null;
  try {
    const body = {
      name: instanceId,
      format: "json",
      "auto.offset.reset": autoOffsetReset,
      "auto.commit.enable": "true",
    };
    const res = await fetch(
      `${KAFKA_REST_URL}/consumers/${encodeURIComponent(groupId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/vnd.kafka.v2+json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json() as { base_uri: string };
    return data.base_uri;
  } catch {
    errors++;
    return null;
  }
}

export async function kafkaSubscribe(
  consumerBaseUri: string,
  topics: string[]
): Promise<boolean> {
  if (!KAFKA_ENABLED || !kafkaConnected) return false;
  try {
    const res = await fetch(`${consumerBaseUri}/subscription`, {
      method: "POST",
      headers: { "Content-Type": "application/vnd.kafka.v2+json" },
      body: JSON.stringify({ topics }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    errors++;
    return false;
  }
}

export async function kafkaPoll(
  consumerBaseUri: string,
  maxBytes = 300000
): Promise<Array<{ topic: string; key: string; value: unknown; partition: number; offset: number }>> {
  if (!KAFKA_ENABLED || !kafkaConnected) return [];
  try {
    const res = await fetch(`${consumerBaseUri}/records?max_bytes=${maxBytes}`, {
      headers: { Accept: "application/vnd.kafka.json.v2+json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const records = await res.json() as Array<{ topic: string; key: string; value: unknown; partition: number; offset: number }>;
    consumed += records.length;
    return records;
  } catch {
    errors++;
    return [];
  }
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

export function kafkaMetrics() {
  return {
    connected: kafkaConnected,
    enabled: KAFKA_ENABLED,
    restUrl: KAFKA_REST_URL,
    bootstrap: KAFKA_BOOTSTRAP,
    clientId: KAFKA_CLIENT_ID,
    produced,
    consumed,
    errors,
  };
}

export { kafkaConnected, checkKafkaHealth };

// ── Backward-compatible publish helpers (used by routers.ts) ──────────────────

export async function publishPenaltyIssued(data: { penaltyId: string | number; orgId: string | number; amount: number; currency: string; reason: string; issuedBy: string }): Promise<void> {
  await kafkaProduce("ndsep.penalties.issued", String(data.penaltyId), { event: "penalty.issued", ...data }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}
export async function publishEnforcementCaseOpened(data: { caseId: string | number; orgId: string | number; caseType: string; severity: string; openedBy: string }): Promise<void> {
  await kafkaProduce("ndsep.enforcement.cases", String(data.caseId), { event: "case.opened", ...data }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}
export async function publishCitizenRightsRequest(data: { requestId: string | number; citizenId: string; requestType: string; status: string; orgId: string | number }): Promise<void> {
  await kafkaProduce("ndsep.citizen.rights", String(data.requestId), { event: "rights.request.updated", ...data }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}
export async function publishComplianceViolation(data: { violationId: string | number; orgId: string | number; violationType: string; severity: string }): Promise<void> {
  await kafkaProduce("ndsep.compliance.violations", String(data.violationId), { event: "violation.detected", ...data }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}
export async function publishAuditEvent(data: { userId: string; action: string; resource: string; resourceId: string | number; orgId?: string | number }): Promise<void> {
  await kafkaProduce("ndsep.audit.events", String(data.resourceId), { event: "audit.action", ...data }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}
export function isKafkaConnected(): boolean {
  return kafkaConnected;
}
export function getKafkaProducerStatus(): { connected: boolean; enabled: boolean; brokers: string[]; clientId: string; ssl: boolean; saslEnabled: boolean; produced: number; errors: number } {
  return { connected: kafkaConnected, enabled: KAFKA_ENABLED, brokers: [KAFKA_BOOTSTRAP], clientId: KAFKA_CLIENT_ID, ssl: false, saslEnabled: false, produced, errors };
}
export async function kafkaSmokeTest(): Promise<{ ok: boolean; topic: string; message: string; latencyMs: number }> {
  const t0 = Date.now();
  try {
    const ok = await kafkaProduce("ndsep.smoke.test", `smoke-${Date.now()}`, { event: "smoke.test", ts: new Date().toISOString() });
    return { ok, topic: "ndsep.smoke.test", message: ok ? "Smoke test message produced" : "Kafka not connected (graceful degradation)", latencyMs: Date.now() - t0 };
  } catch (e: unknown) {
    return { ok: false, topic: "ndsep.smoke.test", message: e instanceof Error ? e.message : "Unknown error", latencyMs: Date.now() - t0 };
  }
}

export async function disconnectKafka(): Promise<void> {
  // No-op for REST Proxy based implementation — connections are stateless HTTP
  kafkaConnected = false;
}

