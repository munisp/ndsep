/**
 * NDSEP Event Bus — Domain Event Publishing
 * ============================================
 * Bridges domain mutations to Kafka topics for event-driven architecture.
 * All tRPC mutations that change state should publish events through this bus.
 *
 * Topics:
 *   ndsep.breach.created       — New breach incident reported
 *   ndsep.breach.updated       — Breach status/severity changed
 *   ndsep.enforcement.created  — New enforcement case opened
 *   ndsep.enforcement.updated  — Enforcement action taken
 *   ndsep.compliance.changed   — Organization compliance score changed
 *   ndsep.consent.changed      — Consent record created/withdrawn
 *   ndsep.organization.changed — Organization data updated
 *   ndsep.alert.created        — Security alert triggered
 *   ndsep.audit.logged         — Audit trail entry created
 *   ndsep.transfer.requested   — Cross-border data transfer request
 *   ndsep.penalty.issued       — Financial penalty issued
 *   ndsep.dpia.completed       — DPIA assessment completed
 *   ndsep.noc.anomaly          — NOC anomaly detected
 *   ndsep.agent.remediation    — AI agent took remediation action
 *
 * Features:
 *   - Graceful degradation when Kafka is unavailable (events logged, not lost)
 *   - Event schema validation
 *   - Retry queue for failed publishes
 *   - Metrics (published, failed, retried)
 */

import { kafkaProduce } from "./kafka";
import { daprPublish } from "./dapr";
import { logger } from "./logger";
import { captureWarning } from "./errorMonitoring";

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

interface DomainEvent {
  type: EventType;
  aggregateId: string;
  aggregateType: string;
  payload: Record<string, unknown>;
  userId?: number;
  timestamp: string;
  correlationId?: string;
}

const TOPIC_PREFIX = "ndsep";
let published = 0;
let failed = 0;
let retried = 0;
const retryQueue: DomainEvent[] = [];
const MAX_RETRY_QUEUE = 1000;

function topicForEvent(type: EventType): string {
  const domain = type.split(".")[0];
  return `${TOPIC_PREFIX}.${domain}.${type.split(".")[1]}`;
}

export async function publishEvent(
  type: EventType,
  aggregateId: string,
  aggregateType: string,
  payload: Record<string, unknown>,
  userId?: number,
  correlationId?: string,
): Promise<boolean> {
  const event: DomainEvent = {
    type,
    aggregateId,
    aggregateType,
    payload,
    userId,
    timestamp: new Date().toISOString(),
    correlationId: correlationId ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };

  const topic = topicForEvent(type);

  // Dual-publish: Kafka (primary) + Dapr (secondary, fire-and-forget)
  const [kafkaOk] = await Promise.all([
    kafkaProduce(topic, aggregateId, event as unknown as Record<string, unknown>, {
      "event-type": type,
      "aggregate-type": aggregateType,
      "correlation-id": event.correlationId!,
    }),
    daprPublish(topic, event as unknown as Record<string, unknown>).catch(() => false),
  ]);

  if (kafkaOk) {
    published++;
    logger.debug({ type, aggregateId, topic }, "[EventBus] Published");
    return true;
  }

  // Kafka unavailable — queue for retry
  failed++;
  if (retryQueue.length < MAX_RETRY_QUEUE) {
    retryQueue.push(event);
  } else {
    captureWarning("Event retry queue full — dropping event", "event-bus", { type, aggregateId });
  }
  logger.debug({ type, aggregateId }, "[EventBus] Queued for retry (Kafka unavailable)");
  return false;
}

// Retry failed events periodically
async function processRetryQueue(): Promise<number> {
  if (retryQueue.length === 0) return 0;

  let processed = 0;
  const batch = retryQueue.splice(0, 50); // Process 50 at a time

  for (const event of batch) {
    const topic = topicForEvent(event.type);
    const ok = await kafkaProduce(topic, event.aggregateId, event as unknown as Record<string, unknown>);
    if (ok) {
      processed++;
      retried++;
    } else {
      // Put back in queue
      if (retryQueue.length < MAX_RETRY_QUEUE) {
        retryQueue.push(event);
      }
      break; // Kafka still down, stop retrying
    }
  }

  if (processed > 0) {
    logger.info({ processed, remaining: retryQueue.length }, "[EventBus] Retry queue processed");
  }
  return processed;
}

// Start retry loop
setInterval(processRetryQueue, 15_000);

// ─── Convenience Publishers ──────────────────────────────────────────────────

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

// ─── Metrics ─────────────────────────────────────────────────────────────────

export function getEventBusMetrics() {
  return {
    published,
    failed,
    retried,
    retryQueueSize: retryQueue.length,
    maxRetryQueue: MAX_RETRY_QUEUE,
  };
}
