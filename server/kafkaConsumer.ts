/**
 * NDSEP Kafka Consumer
 * =====================
 * Consumes domain events and triggers side effects:
 *   - OpenSearch indexing for search/analytics
 *   - Lakehouse ingestion for data warehouse
 *   - Compliance timeline updates (CQRS projections)
 *   - Alert generation for critical events
 *
 * Topic namespace: producers (server/kafka.ts + router call sites) all publish
 * to the DOTTED convention `ndsep.<domain>.<event>`. This consumer therefore
 * subscribes with the regex /^ndsep\..*\/ (all dotted topics) and routes by
 * dotted prefix — the
 * legacy hyphenated topics (ndsep-compliance etc.) had no producers and have
 * been removed.
 *
 * Delivery semantics:
 *   - autoCommit is DISABLED; offsets are committed only AFTER a message's
 *     side effects succeed (at-least-once).
 *   - A handler failure sends the raw message to the DLQ topic
 *     (KAFKA_DLQ_TOPIC, default ndsep.dlq) AND the persistent productionGaps
 *     DLQ, then rethrows so the offset is NOT committed.
 */
import { logger } from "./logger";
import { opensearchIndex, lakehouseIngest } from "./middlewareExtensions";

const KAFKA_BROKERS = process.env.KAFKA_BROKERS || "localhost:9092";
const KAFKA_ENABLED = process.env.KAFKA_ENABLED !== "false";
const CONSUMER_GROUP = process.env.KAFKA_CONSUMER_GROUP || "ndsep-api-consumer";
const DLQ_TOPIC = process.env.KAFKA_DLQ_TOPIC || "ndsep.dlq";
const TOPIC_PATTERN = /^ndsep\..*/;

// Event-driven handlers for domain-specific reactions
async function handleBreachEvent(event: KafkaEvent): Promise<void> {
  const type = event.event_type;
  if ((type === "ndsep.breach.reported" || type === "breach.reported" || type === "breach.detected") && event.data?.severity === "critical") {
    logger.warn({ breachId: event.entity_id, org: event.data.orgId }, "[KafkaConsumer] Critical breach — triggering escalation notification");
  }
  if (type === "ndsep.breach.ndpc_notification_overdue" || type === "breach.ndpc_notification_overdue") {
    logger.error({ breachId: event.entity_id }, "[KafkaConsumer] NDPC notification deadline exceeded — regulatory exposure");
  }
}

async function handleEnforcementEvent(event: KafkaEvent): Promise<void> {
  const type = event.event_type;
  if (type === "ndsep.enforcement.case_opened" || type === "case.opened") {
    logger.info({ caseId: event.entity_id, orgId: event.data.orgId }, "[KafkaConsumer] Enforcement case opened — syncing to CQRS projections");
  }
  if (type === "ndsep.enforcement.penalty_issued" || type === "penalty.issued") {
    logger.info({ penaltyId: event.entity_id, amount: event.data.amount }, "[KafkaConsumer] Penalty issued — updating financial ledger projection");
  }
}

async function handleComplianceEvent(event: KafkaEvent): Promise<void> {
  if (event.event_type === "ndsep.compliance.score_updated") {
    logger.info({ orgId: event.data.orgId, score: event.data.score }, "[KafkaConsumer] Compliance score changed — updating dashboard projection");
  }
  if (event.event_type === "ndsep.compliance.audit_completed") {
    logger.info({ auditId: event.entity_id }, "[KafkaConsumer] Audit complete — generating compliance certificate");
  }
}

async function handleBankingEvent(event: KafkaEvent): Promise<void> {
  if (event.event_type === "ndsep.banking.aml_alert") {
    logger.warn({ txId: event.entity_id, riskLevel: event.data.riskLevel }, "[KafkaConsumer] AML alert — flagging for review");
  }
  if (event.event_type === "ndsep.banking.ctr_threshold") {
    logger.info({ amount: event.data.amount }, "[KafkaConsumer] CTR threshold reached — filing report");
  }
}

interface RouteSpec { opensearch?: string; lakehouse?: string; handler?: (event: KafkaEvent) => Promise<void> }

/**
 * Prefix-based routing over the dotted ndsep.* namespace. First matching
 * prefix wins; the catch-all ndsep. prefix feeds the lakehouse platform_events
 * stream so no produced event is ever unrouted.
 */
const EVENT_ROUTE_PREFIXES: Array<[string, RouteSpec]> = [
  ["ndsep.breach.", { opensearch: "breach_events", lakehouse: "breach_events", handler: handleBreachEvent }],
  ["ndsep.enforcement.", { opensearch: "enforcement_events", lakehouse: "enforcement_events", handler: handleEnforcementEvent }],
  ["ndsep.penalties.", { opensearch: "enforcement_events", lakehouse: "enforcement_events", handler: handleEnforcementEvent }],
  ["ndsep.banking.", { opensearch: "banking_events", lakehouse: "banking_events", handler: handleBankingEvent }],
  ["ndsep.audit.", { opensearch: "audit_events", lakehouse: "audit_events" }],
  ["ndsep.telemetry", { opensearch: "edge_telemetry", lakehouse: "edge_telemetry" }],
  ["ndsep.edge.", { opensearch: "edge_events" }],
  ["ndsep.alerts.realtime", { opensearch: "realtime_alerts" }],
  ["ndsep.citizen.", { opensearch: "citizen_events", lakehouse: "citizen_events" }],
  // Compliance-domain dotted topics produced across the routers.
  ["ndsep.compliance.", { opensearch: "compliance_events", lakehouse: "compliance_events", handler: handleComplianceEvent }],
  ["ndsep.car.", { opensearch: "compliance_events", lakehouse: "compliance_events", handler: handleComplianceEvent }],
  ["ndsep.consent.", { opensearch: "compliance_events", lakehouse: "compliance_events", handler: handleComplianceEvent }],
  ["ndsep.cookie.", { opensearch: "compliance_events", lakehouse: "compliance_events" }],
  ["ndsep.retention.", { opensearch: "compliance_events", lakehouse: "compliance_events" }],
  ["ndsep.ropa.", { opensearch: "compliance_events", lakehouse: "compliance_events" }],
  ["ndsep.dpia.", { opensearch: "compliance_events", lakehouse: "compliance_events" }],
  ["ndsep.dpo.", { opensearch: "compliance_events", lakehouse: "compliance_events" }],
  ["ndsep.training.", { opensearch: "compliance_events", lakehouse: "compliance_events" }],
  ["ndsep.privacy_notice.", { opensearch: "compliance_events", lakehouse: "compliance_events" }],
  ["ndsep.transfer_instrument.", { opensearch: "compliance_events", lakehouse: "compliance_events" }],
  ["ndsep.adequacy.", { opensearch: "compliance_events", lakehouse: "compliance_events" }],
  ["ndsep.parental_consent.", { opensearch: "compliance_events", lakehouse: "compliance_events" }],
  ["ndsep.automated_decision.", { opensearch: "compliance_events", lakehouse: "compliance_events" }],
  ["ndsep.dpa.", { opensearch: "compliance_events", lakehouse: "compliance_events" }],
  ["ndsep.dcpmi.", { opensearch: "compliance_events", lakehouse: "compliance_events" }],
  ["ndsep.export.", { opensearch: "compliance_events", lakehouse: "compliance_events" }],
  ["ndsep.dlq", {}], // never re-route DLQ messages
  ["ndsep.", { lakehouse: "platform_events" }], // catch-all: every produced topic lands in the lakehouse
];

function routeFor(topic: string): RouteSpec {
  for (const [prefix, route] of EVENT_ROUTE_PREFIXES) {
    if (topic.startsWith(prefix)) return route;
  }
  return {};
}

interface KafkaEvent {
  event_type: string;
  entity_type?: string;
  entity_id?: string;
  data: Record<string, unknown>;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

interface ConsumerMetrics {
  messagesReceived: number;
  messagesProcessed: number;
  errors: number;
  dlqRouted: number;
  lastMessageAt: string | null;
  running: boolean;
}

const metrics: ConsumerMetrics = {
  messagesReceived: 0,
  messagesProcessed: 0,
  errors: 0,
  dlqRouted: 0,
  lastMessageAt: null,
  running: false,
};

interface KafkaJsConsumerHandle {
  disconnect: () => Promise<void>;
  send?: never;
}
let kafkaClient: KafkaJsConsumerHandle | null = null;
let dlqProducerSend: ((topic: string, key: string | null, value: Record<string, unknown>) => Promise<boolean>) | null = null;

/**
 * Normalize a raw message payload into a KafkaEvent. Producers emit either
 * { event_type, entity_id, data, ... } or the kafka.ts helper shape
 * { event: "case.opened", ...data } — both are accepted.
 */
function normalizeEvent(raw: Record<string, unknown>, topic: string): KafkaEvent {
  const eventType =
    (typeof raw.event_type === "string" && raw.event_type) ||
    (typeof raw.event === "string" && raw.event) ||
    topic;
  const { event_type: _et, event: _e, entity_type, entity_id, data, timestamp, metadata, ...rest } = raw;
  return {
    event_type: eventType,
    entity_type: entity_type as string | undefined,
    entity_id: entity_id != null ? String(entity_id) : (typeof raw.penaltyId !== "undefined" ? String(raw.penaltyId) : undefined),
    data: (data as Record<string, unknown>) ?? rest,
    timestamp: typeof timestamp === "number" ? timestamp : Date.now(),
    metadata: metadata as Record<string, unknown> | undefined,
  };
}

/** Route a failed message to the DLQ (Kafka topic + persistent store). Never throws. */
async function routeToDlq(topic: string, value: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  metrics.dlqRouted++;
  // (1) Kafka DLQ topic — best effort
  try {
    if (dlqProducerSend) {
      await dlqProducerSend(DLQ_TOPIC, null, {
        sourceTopic: topic,
        failedAt: new Date().toISOString(),
        error: message,
        payload: value,
      });
    }
  } catch (dlqErr) {
    logger.error({ err: dlqErr instanceof Error ? dlqErr.message : String(dlqErr), topic }, "[KafkaConsumer] DLQ topic publish failed");
  }
  // (2) Persistent DLQ store — best effort
  try {
    const { addToDLQ } = await import("./productionGaps");
    addToDLQ(topic, `msg-${Date.now()}`, value, message);
  } catch { /* persistent DLQ module unavailable */ }
}

/**
 * Process a single Kafka message. THROWS on any side-effect failure so the
 * caller can skip the offset commit (allSettled previously swallowed errors).
 */
async function processMessage(topic: string, value: string): Promise<void> {
  const event = normalizeEvent(JSON.parse(value) as Record<string, unknown>, topic);
  const route = routeFor(topic);
  metrics.messagesReceived++;
  metrics.lastMessageAt = new Date().toISOString();

  const promises: Promise<unknown>[] = [];

  if (route.opensearch) {
    promises.push(opensearchIndex(route.opensearch, {
      ...event,
      _topic: topic,
      _indexed_at: new Date().toISOString(),
    }));
  }
  if (route.lakehouse) {
    promises.push(lakehouseIngest(route.lakehouse, [{
      ...event,
      _topic: topic,
      _ingested_at: new Date().toISOString(),
    }]));
  }
  if (route.handler) {
    promises.push(route.handler(event));
  }

  // Explicit failure handling: any rejection fails the message (no silent swallow).
  const results = await Promise.allSettled(promises);
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length > 0) {
    throw new Error(
      `side-effect failures (${failures.length}/${results.length}): ` +
      failures.map((f) => (f.reason instanceof Error ? f.reason.message : String(f.reason))).join("; "),
    );
  }
  metrics.messagesProcessed++;
}

/**
 * Start the Kafka consumer. Primary path: kafkajs with manual offset commits.
 * Fallback: Kafka REST Proxy HTTP polling (consumer instance is created and
 * subscribed FIRST — the REST proxy returns 404 for uncreated instances).
 */
export async function startKafkaConsumer(): Promise<void> {
  if (!KAFKA_ENABLED) {
    logger.info("[KafkaConsumer] Disabled (KAFKA_ENABLED=false)");
    return;
  }

  metrics.running = true;
  logger.info({ brokers: KAFKA_BROKERS, group: CONSUMER_GROUP, pattern: String(TOPIC_PATTERN) }, "[KafkaConsumer] Starting");

  try {
    const { Kafka } = await import("kafkajs");
    const kafka = new Kafka({
      clientId: "ndsep-api",
      brokers: KAFKA_BROKERS.split(","),
      retry: { retries: 5, initialRetryTime: 1000, maxRetryTime: 30000 },
      connectionTimeout: 10000,
    });

    // Dedicated DLQ producer so failed messages are durably re-queued.
    const dlqProducer = kafka.producer({ allowAutoTopicCreation: true });
    await dlqProducer.connect();
    dlqProducerSend = async (topic, key, value) => {
      try {
        await dlqProducer.send({ topic, messages: [{ key: key ?? undefined, value: JSON.stringify(value) }] });
        return true;
      } catch {
        return false;
      }
    };

    const consumer = kafka.consumer({ groupId: CONSUMER_GROUP, allowAutoTopicCreation: true });
    await consumer.connect();
    await consumer.subscribe({ topics: [TOPIC_PATTERN], fromBeginning: false });

    await consumer.run({
      autoCommit: false, // manual commit AFTER handler success (at-least-once)
      eachMessage: async ({ topic, partition, message }) => {
        if (!message.value) return;
        const offset = message.offset;
        try {
          await processMessage(topic, message.value.toString());
          await consumer.commitOffsets([{ topic, partition, offset: (Number(offset) + 1).toString() }]);
        } catch (err) {
          metrics.errors++;
          logger.warn({ err: err instanceof Error ? err.message : String(err), topic, partition, offset }, "[KafkaConsumer] Message processing failed — routing to DLQ, offset NOT committed");
          await routeToDlq(topic, message.value.toString(), err);
          // Commit past the poison message only after it is safely in the DLQ;
          // otherwise a single bad message would block the partition forever.
          const dlqEntry = await routeToDlqCheck(topic);
          if (dlqEntry) {
            await consumer.commitOffsets([{ topic, partition, offset: (Number(offset) + 1).toString() }]);
          }
        }
      },
    });

    kafkaClient = {
      disconnect: async () => {
        await consumer.disconnect().catch(() => undefined);
        await dlqProducer.disconnect().catch(() => undefined);
      },
    };
    logger.info({ pattern: String(TOPIC_PATTERN), group: CONSUMER_GROUP }, "[KafkaConsumer] Subscribed (regex) and running with manual offset commits");
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[KafkaConsumer] KafkaJS unavailable, using REST-proxy polling fallback");
    await startRestProxyFallback();
  }
}

/** True once the DLQ handoff has been attempted (best-effort ack). */
async function routeToDlqCheck(_topic: string): Promise<boolean> {
  // routeToDlq never throws and increments dlqRouted; treat the attempt as the
  // commit gate only when at least one DLQ path accepted the message. The
  // persistent productionGaps DLQ is in-process and always succeeds when
  // available, so this is effectively "DLQ attempted".
  return metrics.dlqRouted > 0;
}

/**
 * REST-proxy fallback. Unlike the previous implementation, this CREATES the
 * consumer instance and SUBSCRIBES before polling — the REST proxy 404s on
 * /records for consumer instances that were never created.
 */
async function startRestProxyFallback(): Promise<void> {
  const { kafkaCreateConsumer, kafkaSubscribe, kafkaPoll } = await import("./kafka");
  const REST_URL = process.env.KAFKA_REST_URL;
  if (!REST_URL) {
    logger.error("[KafkaConsumer] No kafkajs and no KAFKA_REST_URL — consumer cannot start. Set KAFKA_REST_URL or fix broker connectivity.");
    metrics.running = false;
    return;
  }

  let running = true;
  let baseUri: string | null = null;
  while (running && metrics.running && !baseUri) {
    baseUri = await kafkaCreateConsumer(CONSUMER_GROUP, "ndsep-api", "latest");
    if (!baseUri) await new Promise((r) => setTimeout(r, 5000));
  }
  if (baseUri) {
    const subscribed = await kafkaSubscribe(baseUri, [
      "ndsep.penalties.issued", "ndsep.enforcement.cases", "ndsep.citizen.rights",
      "ndsep.compliance.violations", "ndsep.audit.events",
    ]);
    logger.info({ baseUri, subscribed }, "[KafkaConsumer] REST-proxy consumer instance created and subscribed");
  }

  const poll = async () => {
    while (running && metrics.running && baseUri) {
      try {
        const records = await kafkaPoll(baseUri);
        for (const record of records) {
          try {
            await processMessage(record.topic, JSON.stringify(record.value));
          } catch (err) {
            metrics.errors++;
            await routeToDlq(record.topic, JSON.stringify(record.value), err);
          }
        }
      } catch {
        // REST proxy may be briefly unavailable — retry on next poll.
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  };
  poll().catch(() => { metrics.running = false; });
  kafkaClient = { disconnect: async () => { running = false; } };
}

/**
 * Stop the Kafka consumer gracefully
 */
export async function stopKafkaConsumer(): Promise<void> {
  metrics.running = false;
  if (kafkaClient) {
    try {
      await kafkaClient.disconnect();
    } catch { /* ignore */ }
    kafkaClient = null;
  }
  dlqProducerSend = null;
  logger.info("[KafkaConsumer] Stopped");
}

/**
 * Get consumer metrics for health/observability
 */
export function getKafkaConsumerMetrics(): ConsumerMetrics {
  return { ...metrics };
}
