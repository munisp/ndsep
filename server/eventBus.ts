/**
 * NDSEP durable domain event bus.
 *
 * Every event is first recorded in PostgreSQL. Kafka and Dapr are downstream
 * transports only; a process restart cannot discard a persisted event.
 */
import { randomUUID } from "node:crypto";
import { kafkaProduce } from "./kafka";
import { daprPublish } from "./dapr";
import { logger } from "./logger";
import { getPool } from "./db";

export type EventType =
  | "breach.created" | "breach.updated" | "breach.resolved"
  | "enforcement.created" | "enforcement.updated" | "enforcement.closed"
  | "compliance.changed" | "compliance.audit_completed"
  | "consent.created" | "consent.withdrawn" | "consent.expired"
  | "organization.created" | "organization.updated" | "organization.deleted"
  | "alert.created" | "alert.resolved"
  | "audit.logged"
  | "transfer.requested" | "transfer.approved" | "transfer.rejected"
  | "penalty.issued" | "penalty.paid" | "penalty.appealed"
  | "dpia.created" | "dpia.completed"
  | "noc.anomaly" | "noc.escalation"
  | "agent.diagnosis" | "agent.remediation" | "agent.prediction";

export interface DomainEvent {
  type: EventType;
  aggregateId: string;
  aggregateType: string;
  payload: Record<string, unknown>;
  userId?: number;
  timestamp: string;
  correlationId: string;
}

interface OutboxRow {
  id: string;
  event_type: EventType;
  topic: string;
  aggregate_id: string;
  aggregate_type: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  user_id: number | null;
  correlation_id: string;
  attempts: number;
}

const TOPIC_PREFIX = "ndsep";
const OUTBOX_BATCH_SIZE = 50;
const OUTBOX_LEASE_SECONDS = 60;
const OUTBOX_POLL_MS = 15_000;
let published = 0;
let failed = 0;
let retried = 0;
let retryTimer: ReturnType<typeof setInterval> | undefined;

function topicForEvent(type: EventType): string {
  const [domain, action] = type.split(".");
  return `${TOPIC_PREFIX}.${domain}.${action}`;
}

function assertEventInput(type: EventType, aggregateId: string, aggregateType: string): void {
  if (!type || !aggregateId || !aggregateType) throw new Error("Domain event requires type, aggregateId, and aggregateType");
  if (aggregateId.length > 255 || aggregateType.length > 128) throw new Error("Domain event aggregate identifiers exceed durable outbox limits");
}

function requirePool() {
  const pool = getPool();
  if (!pool) throw new Error("PostgreSQL pool is unavailable; refusing non-durable domain event publication");
  return pool;
}

async function enqueueEvent(event: DomainEvent): Promise<void> {
  const pool = requirePool();
  const topic = topicForEvent(event.type);
  const headers = {
    "event-type": event.type,
    "aggregate-type": event.aggregateType,
    "correlation-id": event.correlationId,
  };
  await pool.query(
    `INSERT INTO domain_event_outbox
       (id, event_type, topic, aggregate_id, aggregate_type, payload, headers, user_id, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
    [randomUUID(), event.type, topic, event.aggregateId, event.aggregateType, JSON.stringify(event), JSON.stringify(headers), event.userId ?? null, event.correlationId]
  );
}

async function claimDueEvents(): Promise<OutboxRow[]> {
  const pool = requirePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = await client.query<OutboxRow>(
      `WITH due AS (
         SELECT id
         FROM domain_event_outbox
         WHERE (status = 'pending' AND next_attempt_at <= NOW())
            OR (status = 'publishing' AND lease_expires_at <= NOW())
         ORDER BY created_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE domain_event_outbox AS outbox
       SET status = 'publishing',
           attempts = outbox.attempts + 1,
           lease_expires_at = NOW() + ($2 * INTERVAL '1 second'),
           updated_at = NOW()
       FROM due
       WHERE outbox.id = due.id
       RETURNING outbox.id, outbox.event_type, outbox.topic, outbox.aggregate_id,
                 outbox.aggregate_type, outbox.payload, outbox.headers, outbox.user_id,
                 outbox.correlation_id, outbox.attempts`,
      [OUTBOX_BATCH_SIZE, OUTBOX_LEASE_SECONDS]
    );
    await client.query("COMMIT");
    return rows.rows;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function retryDelaySeconds(attempts: number): number {
  return Math.min(3600, Math.max(5, 2 ** Math.min(attempts, 10)));
}

async function markPublished(id: string): Promise<void> {
  await requirePool().query(
    `UPDATE domain_event_outbox
       SET status = 'published', published_at = NOW(), lease_expires_at = NULL, last_error = NULL, updated_at = NOW()
     WHERE id = $1`,
    [id]
  );
}

async function reschedule(id: string, attempts: number, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
  await requirePool().query(
    `UPDATE domain_event_outbox
       SET status = 'pending',
           next_attempt_at = NOW() + ($2 * INTERVAL '1 second'),
           lease_expires_at = NULL,
           last_error = $3,
           updated_at = NOW()
     WHERE id = $1`,
    [id, retryDelaySeconds(attempts), message]
  );
}

async function publishOutboxRow(row: OutboxRow): Promise<boolean> {
  const event = row.payload as unknown as DomainEvent;
  try {
    const kafkaOk = await kafkaProduce(row.topic, row.aggregate_id, event as unknown as Record<string, unknown>, row.headers);
    if (!kafkaOk) throw new Error("Kafka publish failed");
    // Dapr is a required downstream delivery. Any rejection keeps the event in
    // PostgreSQL for retry rather than claiming a Kafka-only publication.
    await daprPublish(row.topic, event as unknown as Record<string, unknown>);
    await markPublished(row.id);
    published += 1;
    if (row.attempts > 1) retried += 1;
    return true;
  } catch (error) {
    failed += 1;
    await reschedule(row.id, row.attempts, error);
    logger.warn({ err: error, correlationId: row.correlation_id, attempts: row.attempts }, "[EventBus] durable outbox event rescheduled");
    return false;
  }
}

export async function processDurableOutbox(): Promise<number> {
  const rows = await claimDueEvents();
  let processed = 0;
  for (const row of rows) {
    if (await publishOutboxRow(row)) processed += 1;
  }
  return processed;
}

export async function publishEvent(
  type: EventType,
  aggregateId: string,
  aggregateType: string,
  payload: Record<string, unknown>,
  userId?: number,
  correlationId?: string,
): Promise<boolean> {
  assertEventInput(type, aggregateId, aggregateType);
  const event: DomainEvent = {
    type,
    aggregateId,
    aggregateType,
    payload,
    userId,
    timestamp: new Date().toISOString(),
    correlationId: correlationId ?? randomUUID(),
  };
  await enqueueEvent(event);
  // Make one immediate delivery attempt. Any failure remains in PostgreSQL.
  await processDurableOutbox();
  return true;
}

export function startDurableOutbox(): void {
  if (retryTimer) return;
  retryTimer = setInterval(() => {
    processDurableOutbox().catch((error) => logger.error({ err: error }, "[EventBus] durable outbox poll failed"));
  }, OUTBOX_POLL_MS);
  retryTimer.unref();
}

export function stopDurableOutbox(): void {
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = undefined;
}

export async function getEventBusMetrics() {
  const pool = getPool();
  let pending = 0;
  let publishing = 0;
  if (pool) {
    const result = await pool.query<{ status: "pending" | "publishing" | "published"; count: string }>(
      `SELECT status, COUNT(*)::text AS count FROM domain_event_outbox WHERE status IN ('pending', 'publishing') GROUP BY status`
    );
    for (const row of result.rows) {
      if (row.status === "pending") pending = Number(row.count);
      if (row.status === "publishing") publishing = Number(row.count);
    }
  }
  return { published, failed, retried, pending, publishing, persistence: "postgresql" as const };
}

export async function publishBreachCreated(breachId: number, orgId: number, severity: string, userId?: number) {
  return publishEvent("breach.created", String(breachId), "breach_incident", { orgId, severity }, userId);
}
export async function publishBreachUpdated(breachId: number, status: string, userId?: number) {
  return publishEvent("breach.updated", String(breachId), "breach_incident", { status }, userId);
}
export async function publishEnforcementCreated(caseId: number, orgId: number, userId?: number) {
  return publishEvent("enforcement.created", String(caseId), "enforcement_case", { orgId }, userId);
}
export async function publishComplianceChanged(orgId: number, oldScore: number, newScore: number) {
  return publishEvent("compliance.changed", String(orgId), "organization", { oldScore, newScore });
}
export async function publishConsentChanged(consentId: number, orgId: number, action: "created" | "withdrawn" | "expired") {
  return publishEvent(`consent.${action}`, String(consentId), "consent_record", { orgId });
}
export async function publishAlertCreated(alertId: number, orgId: number, severity: string) {
  return publishEvent("alert.created", String(alertId), "security_alert", { orgId, severity });
}
export async function publishPenaltyIssued(penaltyId: number, orgId: number, amount: number) {
  return publishEvent("penalty.issued", String(penaltyId), "financial_penalty", { orgId, amount });
}
export async function publishNocAnomaly(anomalyId: string, service: string, zScore: number) {
  return publishEvent("noc.anomaly", anomalyId, "noc_anomaly", { service, zScore });
}
export async function publishAgentRemediation(actionId: string, confidence: number, autoExecuted: boolean) {
  return publishEvent("agent.remediation", actionId, "agent_action", { confidence, autoExecuted });
}
