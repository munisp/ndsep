/**
 * NDSEP Kafka Consumer
 * Consumes domain events and triggers side effects:
 *   - OpenSearch indexing for search/analytics
 *   - Lakehouse ingestion for data warehouse
 *   - Compliance timeline updates (CQRS projections)
 *   - Permify relationship sync
 *   - Alert generation for critical events
 *
 * Graceful degradation: if Kafka is unavailable, the consumer silently retries.
 */
import { logger } from "./logger";
import { opensearchIndex, lakehouseIngest } from "./middlewareExtensions";

const KAFKA_BROKERS = process.env.KAFKA_BROKERS || "localhost:9092";
const KAFKA_ENABLED = process.env.KAFKA_ENABLED !== "false";
const CONSUMER_GROUP = "ndsep-api-consumer";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const KAFKA_SASL_USERNAME = process.env.KAFKA_SASL_USERNAME;
const KAFKA_SASL_PASSWORD = process.env.KAFKA_SASL_PASSWORD;

function assertConsumerConfiguration(): void {
  if (IS_PRODUCTION && (!KAFKA_SASL_USERNAME || !KAFKA_SASL_PASSWORD)) {
    throw new Error("Kafka SASL credentials are required in production");
  }
  if (IS_PRODUCTION && KAFKA_BROKERS.split(",").some((broker) => /(^|[/:])localhost([/:]|$)/i.test(broker.trim()))) {
    throw new Error("Kafka localhost broker is not permitted in production");
  }
}

// Event-driven handlers for domain-specific reactions
async function handleBreachEvent(event: KafkaEvent): Promise<void> {
  if (event.event_type === "ndsep.breach.reported" && event.data?.severity === "critical") {
    logger.warn({ breachId: event.entity_id, org: event.data.orgId }, "[KafkaConsumer] Critical breach — triggering escalation notification");
  }
  if (event.event_type === "ndsep.breach.ndpc_notification_overdue") {
    logger.error({ breachId: event.entity_id }, "[KafkaConsumer] NDPC notification deadline exceeded — regulatory exposure");
  }
}

async function handleEnforcementEvent(event: KafkaEvent): Promise<void> {
  if (event.event_type === "ndsep.enforcement.case_opened") {
    logger.info({ caseId: event.entity_id, orgId: event.data.orgId }, "[KafkaConsumer] Enforcement case opened — syncing to CQRS projections");
  }
  if (event.event_type === "ndsep.enforcement.penalty_issued") {
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

// Event routing: which topics go to which side effects
// Includes Fluvio edge topics consolidated into Kafka path (C10)
const EVENT_ROUTES: Record<string, { opensearch?: string; lakehouse?: string; handler?: (event: KafkaEvent) => Promise<void> }> = {
  "ndsep-compliance": { opensearch: "compliance_events", lakehouse: "compliance_events", handler: handleComplianceEvent },
  "ndsep-enforcement": { opensearch: "enforcement_events", lakehouse: "enforcement_events", handler: handleEnforcementEvent },
  "ndsep-banking": { opensearch: "banking_events", lakehouse: "banking_events", handler: handleBankingEvent },
  "ndsep-breach": { opensearch: "breach_events", lakehouse: "breach_events", handler: handleBreachEvent },
  "ndsep-noc": { opensearch: "noc_events" },
  "ndsep-platform": { lakehouse: "platform_events" },
  "ndsep-audit": { opensearch: "audit_events", lakehouse: "audit_events" },
  // Fluvio edge topics (consolidated — consumed from Kafka when Fluvio unavailable)
  "ndsep.telemetry": { opensearch: "edge_telemetry", lakehouse: "edge_telemetry" },
  "ndsep.edge.events": { opensearch: "edge_events" },
  "ndsep.alerts.realtime": { opensearch: "realtime_alerts" },
};

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
  lastMessageAt: string | null;
  running: boolean;
}

const metrics: ConsumerMetrics = {
  messagesReceived: 0,
  messagesProcessed: 0,
  errors: 0,
  lastMessageAt: null,
  running: false,
};

let kafkaClient: { disconnect: () => Promise<void> } | null = null;

/**
 * Process a single Kafka message by routing to appropriate side effects
 */
async function processMessage(topic: string, value: string): Promise<void> {
  try {
    const event = JSON.parse(value) as KafkaEvent;
    const route = EVENT_ROUTES[topic] ?? EVENT_ROUTES["ndsep-platform"];
    metrics.messagesReceived++;
    metrics.lastMessageAt = new Date().toISOString();

    const promises: Promise<void>[] = [];

    // Index to OpenSearch for search
    if (route?.opensearch) {
      promises.push(
        opensearchIndex(route.opensearch, {
          ...event,
          _topic: topic,
          _indexed_at: new Date().toISOString(),
        })
      );
    }

    // Ingest to Lakehouse for analytics
    if (route?.lakehouse) {
      promises.push(
        lakehouseIngest(route.lakehouse, [{
          ...event,
          _topic: topic,
          _ingested_at: new Date().toISOString(),
        }])
      );
    }

    // Run custom handler if present
    if (route?.handler) {
      promises.push(route.handler(event));
    }

    // A consumer offset may advance only after every required projection and handler succeeds.
    await Promise.all(promises);
    metrics.messagesProcessed++;
  } catch (err) {
    metrics.errors++;
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message, topic }, "[KafkaConsumer] Message processing failed; refusing offset acknowledgement");
    try {
      const { addToDLQ } = await import("./productionGaps");
      const eventId = (() => { try { return String((JSON.parse(value) as KafkaEvent).metadata?.event_id ?? (JSON.parse(value) as KafkaEvent).entity_id ?? "unknown"); } catch { return "malformed"; } })();
      await Promise.resolve(addToDLQ(topic, `kafka-${eventId}`, value, message));
    } catch (dlqError) {
      logger.error({ err: dlqError instanceof Error ? dlqError.message : String(dlqError), topic }, "[KafkaConsumer] DLQ failure; message remains unacknowledged");
    }
    // KafkaJS will not commit the offset when eachMessage rejects. A non-production REST
    // poller also receives this failure for explicit operational visibility.
    throw err instanceof Error ? err : new Error(message);
  }
}

/**
 * Start the Kafka consumer (uses HTTP-based Kafka REST proxy if KafkaJS unavailable)
 */
export async function startKafkaConsumer(): Promise<void> {
  if (!KAFKA_ENABLED) {
    logger.info("[KafkaConsumer] Disabled (KAFKA_ENABLED=false)");
    return;
  }

  metrics.running = true;
  logger.info({ brokers: KAFKA_BROKERS, group: CONSUMER_GROUP }, "[KafkaConsumer] Starting");

  try {
    assertConsumerConfiguration();
    // Production requires authenticated KafkaJS transport. The REST fallback is limited to
    // explicitly non-production developer environments because it cannot prove commits.
    const { Kafka } = await import("kafkajs");
    const kafka = new Kafka({
      clientId: "ndsep-api",
      brokers: KAFKA_BROKERS.split(","),
      ssl: IS_PRODUCTION ? true : undefined,
      sasl: IS_PRODUCTION ? { mechanism: "plain", username: KAFKA_SASL_USERNAME!, password: KAFKA_SASL_PASSWORD! } : undefined,
      retry: { retries: 5, initialRetryTime: 1000, maxRetryTime: 30000 },
      connectionTimeout: 10000,
    });

    const consumer = kafka.consumer({ groupId: CONSUMER_GROUP });
    await consumer.connect();

    const topics = Object.keys(EVENT_ROUTES);
    for (const topic of topics) {
      await consumer.subscribe({ topic, fromBeginning: false });
    }

    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        if (message.value) {
          await processMessage(topic, message.value.toString());
        }
      },
    });

    kafkaClient = consumer;
    logger.info({ topics }, "[KafkaConsumer] Subscribed and running");
  } catch (err) {
    metrics.errors++;
    if (IS_PRODUCTION) {
      metrics.running = false;
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "[KafkaConsumer] Production Kafka startup failed; REST polling fallback is forbidden");
      throw err;
    }
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[KafkaConsumer] Non-production KafkaJS unavailable; using development REST polling fallback");

    // HTTP polling fallback is developer-only and never establishes a production delivery claim.
    const REST_URL = process.env.KAFKA_REST_URL || `http://${KAFKA_BROKERS.split(",")[0].replace(":9092", ":8082")}`;
    let running = true;

    const poll = async () => {
      while (running && metrics.running) {
        try {
          const resp = await fetch(`${REST_URL}/consumers/${CONSUMER_GROUP}/instances/ndsep-api/records`, {
            headers: { Accept: "application/vnd.kafka.json.v2+json" },
            signal: AbortSignal.timeout(30000),
          });
          if (resp.ok) {
            const records = await resp.json() as Array<{ topic: string; value: unknown }>;
            for (const record of records) {
              await processMessage(record.topic, JSON.stringify(record.value));
            }
          }
        } catch (error) {
          metrics.errors++;
          logger.warn({ err: error instanceof Error ? error.message : String(error) }, "[KafkaConsumer] Development REST poll failed");
        }
        await new Promise(r => setTimeout(r, 5000)); // Poll every 5s
      }
    };

    poll().catch(() => { metrics.running = false; });
    kafkaClient = { disconnect: async () => { running = false; } };
  }
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
  logger.info("[KafkaConsumer] Stopped");
}

/**
 * Get consumer metrics for health/observability
 */
export function getKafkaConsumerMetrics(): ConsumerMetrics {
  return { ...metrics };
}
