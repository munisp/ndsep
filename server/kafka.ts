import { randomUUID } from "node:crypto";
import { logger } from "./logger";

/**
 * Kafka REST producer integration.
 *
 * Regulatory and financial callers must use `kafkaProduceRequired`: it throws
 * when delivery cannot be acknowledged. Boolean helpers remain for explicitly
 * non-critical telemetry only. Production uses an HTTPS REST proxy with a
 * dedicated bearer credential; local HTTP defaults are confined to non-prod.
 */
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const KAFKA_REST_URL = process.env.KAFKA_REST_URL ?? "http://localhost:8082";
const KAFKA_BOOTSTRAP = process.env.KAFKA_BOOTSTRAP_SERVERS ?? "localhost:9092";
const KAFKA_ENABLED = (process.env.KAFKA_ENABLED ?? (IS_PRODUCTION ? "false" : "true")) === "true";
const KAFKA_CLIENT_ID = process.env.KAFKA_CLIENT_ID ?? "ndsep-server";
const KAFKA_REST_TOKEN = process.env.KAFKA_REST_TOKEN;

let kafkaConnected = false;
let produced = 0;
let consumed = 0;
let errors = 0;

export class KafkaDeliveryError extends Error {
  constructor(message: string) { super(message); this.name = "KafkaDeliveryError"; }
}

function assertKafkaConfiguration(): void {
  if (!KAFKA_ENABLED) throw new KafkaDeliveryError("Kafka is disabled");
  if (IS_PRODUCTION && !KAFKA_REST_URL.startsWith("https://")) throw new KafkaDeliveryError("Kafka REST endpoint must use HTTPS in production");
  if (IS_PRODUCTION && (!KAFKA_REST_TOKEN || KAFKA_REST_TOKEN.length < 32)) throw new KafkaDeliveryError("Kafka REST credential is not configured securely");
}

function assertTopic(topic: string): void {
  if (!/^[a-z0-9._-]{3,249}$/i.test(topic) || topic.includes("..")) throw new KafkaDeliveryError("Invalid Kafka topic");
}

function kafkaHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/vnd.kafka.json.v2+json",
    Accept: "application/vnd.kafka.v2+json",
    "X-NDSEP-Client-Id": KAFKA_CLIENT_ID,
    ...(KAFKA_REST_TOKEN ? { Authorization: `Bearer ${KAFKA_REST_TOKEN}` } : {}),
  };
}

async function checkKafkaHealth(): Promise<boolean> {
  if (!KAFKA_ENABLED) return false;
  try {
    assertKafkaConfiguration();
    const res = await fetch(`${KAFKA_REST_URL}/brokers`, { headers: kafkaHeaders(), signal: AbortSignal.timeout(3_000) });
    const ok = res.ok;
    if (ok && !kafkaConnected) logger.info({ endpoint: KAFKA_REST_URL }, "[Kafka] Connected via REST proxy");
    if (!ok && kafkaConnected) logger.error({ status: res.status }, "[Kafka] REST proxy unhealthy");
    kafkaConnected = ok;
    return ok;
  } catch (error) {
    errors++;
    if (kafkaConnected) logger.error({ err: error instanceof Error ? error.message : String(error) }, "[Kafka] REST proxy unavailable or untrusted");
    kafkaConnected = false;
    return false;
  }
}

if (KAFKA_ENABLED) {
  checkKafkaHealth().catch(() => undefined);
  setInterval(() => { checkKafkaHealth().catch(() => undefined); }, 30_000).unref();
}

export async function kafkaProduce(
  topic: string,
  key: string | null,
  value: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<boolean> {
  try {
    assertKafkaConfiguration();
    assertTopic(topic);
    if (!kafkaConnected) return false;
    const correlationId = typeof value.event_id === "string" ? value.event_id : randomUUID();
    const records = {
      records: [{
        key: key ?? correlationId,
        value: { ...value, event_id: correlationId, emitted_at: new Date().toISOString() },
        headers: {
          "ndsep-correlation-id": correlationId,
          ...(headers ?? {}),
        },
      }],
    };
    const res = await fetch(`${KAFKA_REST_URL}/topics/${encodeURIComponent(topic)}`, {
      method: "POST", headers: kafkaHeaders(), body: JSON.stringify(records), signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      errors++;
      logger.error({ topic, status: res.status, correlationId }, "[Kafka] Produce request rejected");
      return false;
    }
    produced++;
    return true;
  } catch (error) {
    errors++;
    logger.error({ topic, err: error instanceof Error ? error.message : String(error) }, "[Kafka] Produce failed");
    return false;
  }
}

export async function kafkaProduceRequired(
  topic: string,
  key: string | null,
  value: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<void> {
  const delivered = await kafkaProduce(topic, key, value, headers);
  if (!delivered) throw new KafkaDeliveryError(`Kafka delivery was not acknowledged for topic ${topic}`);
}

export async function kafkaProduceBatch(topic: string, messages: Array<{ key?: string; value: Record<string, unknown> }>): Promise<boolean> {
  try {
    assertKafkaConfiguration();
    assertTopic(topic);
    if (!kafkaConnected || messages.length === 0 || messages.length > 500) return false;
    const records = messages.map((message) => {
      const correlationId = typeof message.value.event_id === "string" ? message.value.event_id : randomUUID();
      return { key: message.key ?? correlationId, value: { ...message.value, event_id: correlationId, emitted_at: new Date().toISOString() }, headers: { "ndsep-correlation-id": correlationId } };
    });
    const res = await fetch(`${KAFKA_REST_URL}/topics/${encodeURIComponent(topic)}`, {
      method: "POST", headers: kafkaHeaders(), body: JSON.stringify({ records }), signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) { errors++; return false; }
    produced += messages.length;
    return true;
  } catch (error) {
    errors++;
    logger.error({ topic, err: error instanceof Error ? error.message : String(error) }, "[Kafka] Batch produce failed");
    return false;
  }
}

export async function kafkaListTopics(): Promise<string[]> {
  if (!await checkKafkaHealth()) return [];
  try {
    const res = await fetch(`${KAFKA_REST_URL}/topics`, { headers: kafkaHeaders(), signal: AbortSignal.timeout(5_000) });
    return res.ok ? await res.json() as string[] : [];
  } catch { errors++; return []; }
}

export async function kafkaDescribeTopic(topic: string): Promise<Record<string, unknown> | null> {
  if (!await checkKafkaHealth()) return null;
  try {
    assertTopic(topic);
    const res = await fetch(`${KAFKA_REST_URL}/topics/${encodeURIComponent(topic)}`, { headers: kafkaHeaders(), signal: AbortSignal.timeout(5_000) });
    return res.ok ? await res.json() as Record<string, unknown> : null;
  } catch { errors++; return null; }
}

export function kafkaMetrics() {
  return { connected: kafkaConnected, enabled: KAFKA_ENABLED, restUrl: KAFKA_REST_URL, bootstrap: KAFKA_BOOTSTRAP, clientId: KAFKA_CLIENT_ID, ssl: KAFKA_REST_URL.startsWith("https://"), saslEnabled: Boolean(KAFKA_REST_TOKEN), produced, consumed, errors };
}

export { kafkaConnected, checkKafkaHealth };

// Backward-compatible event helpers retain non-blocking semantics for UI activity.
// Compliance-critical paths must use kafkaProduceRequired together with a DB outbox.
export async function publishPenaltyIssued(data: { penaltyId: string | number; orgId: string | number; amount: number; currency: string; reason: string; issuedBy: string }): Promise<void> {
  await kafkaProduce("ndsep.penalties.issued", String(data.penaltyId), { event: "penalty.issued", ...data });
}
export async function publishEnforcementCaseOpened(data: { caseId: string | number; orgId: string | number; caseType: string; severity: string; openedBy: string }): Promise<void> {
  await kafkaProduce("ndsep.enforcement.cases", String(data.caseId), { event: "case.opened", ...data });
}
export async function publishCitizenRightsRequest(data: { requestId: string | number; citizenId: string; requestType: string; status: string; orgId: string | number }): Promise<void> {
  await kafkaProduce("ndsep.citizen.rights", String(data.requestId), { event: "rights.request.updated", ...data });
}
export async function publishComplianceViolation(data: { violationId: string | number; orgId: string | number; violationType: string; severity: string }): Promise<void> {
  await kafkaProduce("ndsep.compliance.violations", String(data.violationId), { event: "violation.detected", ...data });
}
export async function publishAuditEvent(data: { userId: string; action: string; resource: string; resourceId: string | number; orgId?: string | number }): Promise<void> {
  await kafkaProduce("ndsep.audit.events", String(data.resourceId), { event: "audit.action", ...data });
}
export function isKafkaConnected(): boolean { return kafkaConnected; }
export function getKafkaProducerStatus() { return kafkaMetrics(); }
export async function kafkaSmokeTest(): Promise<{ ok: boolean; topic: string; message: string; latencyMs: number }> {
  const start = Date.now();
  const ok = await kafkaProduce("ndsep.smoke.test", `smoke-${Date.now()}`, { event: "smoke.test" });
  return { ok, topic: "ndsep.smoke.test", message: ok ? "Smoke test message produced" : "Kafka delivery not acknowledged", latencyMs: Date.now() - start };
}
export async function disconnectKafka(): Promise<void> { kafkaConnected = false; }
