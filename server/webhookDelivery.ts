/**
 * NDSEP Webhook Delivery System
 * ===============================
 * Reliable webhook delivery with:
 *   - HMAC-SHA256 signature verification
 *   - Exponential backoff retries (3 attempts)
 *   - Delivery logging and status tracking
 *   - Event filtering per subscription
 *
 * Events:
 *   org.registered, org.updated, audit.completed, audit.failed,
 *   breach.reported, breach.resolved, dsar.submitted, dsar.completed,
 *   certificate.issued, certificate.revoked, enforcement.initiated
 */

import crypto from "crypto";
import { Pool } from "pg";
import { getDatabaseUrl } from "./config";
import { getPgSslConfig } from "./dbSslConfig";
import { logger } from "./logger";

export interface WebhookEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface WebhookSubscription {
  id: number;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  organizationId: number;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 30000]; // 1s, 5s, 30s

type WebhookShadowMetrics = {
  enqueued: number;
  activeEnqueued: number;
  enqueueErrors: number;
  finalizedDelivered: number;
  finalizedDead: number;
  finalizationErrors: number;
  lastEnqueuedAtSeconds: number;
};

const webhookShadowMetrics: WebhookShadowMetrics = {
  enqueued: 0,
  activeEnqueued: 0,
  enqueueErrors: 0,
  finalizedDelivered: 0,
  finalizedDead: 0,
  finalizationErrors: 0,
  lastEnqueuedAtSeconds: 0,
};

export function getWebhookShadowMetrics(): Readonly<WebhookShadowMetrics> {
  return { ...webhookShadowMetrics };
}

let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: getDatabaseUrl(),
      ssl: getPgSslConfig(),
      max: 3,
    });
  }
  return _pool;
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Persist a delivery attempt in the canonical PostgreSQL webhook ledger.  The
 * receiver is given a stable event identifier so retries are intentionally
 * at-least-once and can be deduplicated downstream.  Response bodies are not
 * persisted because they may contain untrusted or sensitive remote content.
 */
export async function recordWebhookDeliveryAttempt(
  pool: Pick<Pool, "query">,
  subscription: Pick<WebhookSubscription, "id">,
  event: WebhookEvent,
  statusCode: number | null,
  success: boolean,
  attempt: number
): Promise<void> {
  await pool.query(
    `INSERT INTO webhook_deliveries
       (subscription_id, event, payload, response_status, response_body, attempt, delivered_at, success)
     VALUES ($1, $2, $3::jsonb, $4, NULL, $5, NOW(), $6)`,
    [
      subscription.id,
      event.type,
      JSON.stringify(event),
      statusCode,
      attempt + 1,
      success,
    ]
  );
}

export type WebhookDeliveryQueueMode = "disabled" | "shadow" | "active";
export type WebhookDeliveryOutcome = "delivered" | "queued" | "failed";

type WebhookQueryable = Pick<Pool, "query">;

type WebhookDeliveryDependencies = {
  pool?: WebhookQueryable;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  queueMode?: WebhookDeliveryQueueMode;
};

type WebhookDispatchDependencies = Pick<
  WebhookDeliveryDependencies,
  "pool" | "queueMode"
> & {
  eventId?: string;
  now?: () => Date;
};

export function getWebhookDeliveryQueueMode(
  value = process.env.WEBHOOK_DELIVERY_QUEUE_MODE
): WebhookDeliveryQueueMode {
  const mode = value ?? "disabled";
  if (mode === "disabled" || mode === "shadow" || mode === "active")
    return mode;
  throw new Error(
    "WEBHOOK_DELIVERY_QUEUE_MODE must be disabled, shadow, or active"
  );
}

export function webhookDeliveryAttemptKey(
  subscriptionId: number,
  eventId: string
): string {
  return crypto
    .createHash("sha256")
    .update(`${subscriptionId}:${eventId}`)
    .digest("hex");
}

export async function enqueueWebhookAttempt(
  pool: WebhookQueryable,
  subscription: Pick<WebhookSubscription, "id" | "url">,
  event: WebhookEvent,
  queueMode: Extract<WebhookDeliveryQueueMode, "shadow" | "active">
): Promise<void> {
  const status = queueMode === "active" ? "pending" : "shadow";
  const result = await pool.query(
    `INSERT INTO webhook_delivery_attempts
       (subscription_id, event_id, event_type, payload, destination_url, status, idempotency_key)
     VALUES ($1, $2::uuid, $3, $4::jsonb, $5, $6::varchar, $7)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      subscription.id,
      event.id,
      event.type,
      JSON.stringify(event),
      subscription.url,
      status,
      webhookDeliveryAttemptKey(subscription.id, event.id),
    ]
  );
  if (result.rowCount === 1) {
    webhookShadowMetrics.enqueued += 1;
    if (queueMode === "active") webhookShadowMetrics.activeEnqueued += 1;
    webhookShadowMetrics.lastEnqueuedAtSeconds = Math.floor(Date.now() / 1000);
  }
}

// Compatibility alias for the committed shadow-only caller and tests.
export const enqueueWebhookShadowAttempt = (
  pool: WebhookQueryable,
  subscription: Pick<WebhookSubscription, "id" | "url">,
  event: WebhookEvent
) => enqueueWebhookAttempt(pool, subscription, event, "shadow");

export async function finalizeWebhookShadowAttempt(
  pool: WebhookQueryable,
  subscriptionId: number,
  eventId: string,
  status: "delivered" | "dead",
  responseCode: number | null,
  attemptCount: number
): Promise<void> {
  const result = await pool.query(
    `UPDATE webhook_delivery_attempts
     SET status = $1::varchar,
         attempt_count = GREATEST(attempt_count, $2),
         last_response_code = $3,
         delivered_at = CASE WHEN $1::varchar = 'delivered' THEN now() ELSE delivered_at END,
         updated_at = now()
     WHERE idempotency_key = $4
       AND status = 'shadow'
     RETURNING id`,
    [
      status,
      attemptCount,
      responseCode,
      webhookDeliveryAttemptKey(subscriptionId, eventId),
    ]
  );
  if (result.rowCount !== 1) {
    throw new Error(
      `Webhook shadow attempt is missing or already finalized for event ${eventId}`
    );
  }
  if (status === "delivered") webhookShadowMetrics.finalizedDelivered += 1;
  else webhookShadowMetrics.finalizedDead += 1;
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>(resolve => setTimeout(resolve, milliseconds));

export async function deliverWebhook(
  subscription: WebhookSubscription,
  event: WebhookEvent,
  attempt = 0,
  dependencies: WebhookDeliveryDependencies = {}
): Promise<WebhookDeliveryOutcome> {
  if (!subscription.active) {
    logger.warn(
      { subscriptionId: subscription.id, eventId: event.id },
      "[Webhook] Refusing inactive subscription"
    );
    return "failed";
  }
  const payload = JSON.stringify(event);
  const signature = signPayload(payload, subscription.secret);
  const pool = dependencies.pool ?? getPool();
  const queueMode = dependencies.queueMode ?? getWebhookDeliveryQueueMode();
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const sleep = dependencies.sleep ?? defaultSleep;

  if ((queueMode === "shadow" || queueMode === "active") && attempt === 0) {
    try {
      await enqueueWebhookAttempt(pool, subscription, event, queueMode);
    } catch (queueError) {
      webhookShadowMetrics.enqueueErrors += 1;
      logger.error(
        {
          err:
            queueError instanceof Error
              ? queueError.message
              : String(queueError),
          subscriptionId: subscription.id,
          eventId: event.id,
        },
        "[Webhook] Shadow queue intent could not be persisted"
      );
      return "failed";
    }
  }

  if (queueMode === "active") {
    // Queue acceptance is distinct from delivery. The active worker owns dispatch and terminal state.
    return "queued";
  }

  const finalizeShadow = async (
    status: "delivered" | "dead",
    responseCode: number | null,
    attempts: number
  ) => {
    if (queueMode !== "shadow") return;
    try {
      await finalizeWebhookShadowAttempt(
        pool,
        subscription.id,
        event.id,
        status,
        responseCode,
        attempts
      );
    } catch (error) {
      webhookShadowMetrics.finalizationErrors += 1;
      throw error;
    }
  };

  try {
    const response = await fetchImpl(subscription.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-NDSEP-Signature": `sha256=${signature}`,
        "X-NDSEP-Event": event.type,
        "X-NDSEP-Delivery": event.id,
        "User-Agent": "NDSEP-Webhook/1.0",
      },
      body: payload,
      signal: AbortSignal.timeout(10000),
    });

    const success = response.status >= 200 && response.status < 300;
    try {
      await recordWebhookDeliveryAttempt(
        pool,
        subscription,
        event,
        response.status,
        success,
        attempt
      );
    } catch (ledgerError) {
      logger.error(
        {
          err:
            ledgerError instanceof Error
              ? ledgerError.message
              : String(ledgerError),
          subscriptionId: subscription.id,
          eventId: event.id,
        },
        "[Webhook] Delivery response was received but durable audit logging failed"
      );
      return "failed";
    }

    if (success) {
      try {
        await finalizeShadow("delivered", response.status, attempt + 1);
      } catch (queueError) {
        logger.error(
          {
            err:
              queueError instanceof Error
                ? queueError.message
                : String(queueError),
            subscriptionId: subscription.id,
            eventId: event.id,
          },
          "[Webhook] Canonical delivery was recorded but shadow finalization failed"
        );
        return "failed";
      }
      logger.info(
        { subscriptionId: subscription.id, eventType: event.type },
        "[Webhook] Delivered"
      );
      return "delivered";
    }

    if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
      const delay = RETRY_DELAYS[attempt] ?? 30000;
      logger.warn(
        { subscriptionId: subscription.id, status: response.status, attempt },
        "[Webhook] Retrying in %dms",
        delay
      );
      await sleep(delay);
      return deliverWebhook(subscription, event, attempt + 1, dependencies);
    }

    try {
      await finalizeShadow("dead", response.status, attempt + 1);
    } catch (queueError) {
      logger.error(
        {
          err:
            queueError instanceof Error
              ? queueError.message
              : String(queueError),
          subscriptionId: subscription.id,
          eventId: event.id,
        },
        "[Webhook] Canonical failure was recorded but shadow finalization failed"
      );
      return "failed";
    }
    logger.error(
      { subscriptionId: subscription.id, status: response.status },
      "[Webhook] Delivery failed"
    );
    return "failed";
  } catch (err) {
    if (attempt >= MAX_RETRIES - 1) {
      try {
        await recordWebhookDeliveryAttempt(
          pool,
          subscription,
          event,
          null,
          false,
          attempt
        );
        await finalizeShadow("dead", null, attempt + 1);
      } catch (ledgerError) {
        logger.error(
          {
            err:
              ledgerError instanceof Error
                ? ledgerError.message
                : String(ledgerError),
            subscriptionId: subscription.id,
            eventId: event.id,
          },
          "[Webhook] Durable audit logging failed for terminal transport error"
        );
      }
      logger.error(
        { err, subscriptionId: subscription.id },
        "[Webhook] Delivery failed after %d attempts",
        MAX_RETRIES
      );
      return "failed";
    }
    const delay = RETRY_DELAYS[attempt] ?? 30000;
    await sleep(delay);
    return deliverWebhook(subscription, event, attempt + 1, dependencies);
  }
}

export async function dispatchEvent(
  eventType: string,
  data: Record<string, unknown>,
  orgId?: number,
  dependencies: WebhookDispatchDependencies = {}
): Promise<{ delivered: number; failed: number; queued: number }> {
  const pool = dependencies.pool ?? getPool();
  const now = dependencies.now ?? (() => new Date());
  const event: WebhookEvent = {
    id: dependencies.eventId ?? crypto.randomUUID(),
    type: eventType,
    data,
    timestamp: now().toISOString(),
  };

  // Find matching subscriptions
  const { rows: subscriptions } = await pool.query(
    `SELECT id, url, secret, events, active, org_id AS "organizationId"
     FROM webhook_subscriptions
     WHERE active = true
       AND ($1::int IS NULL OR org_id = $1)
       AND events @> ARRAY[$2::text]`,
    [orgId ?? null, eventType]
  );

  const queueMode = dependencies.queueMode ?? getWebhookDeliveryQueueMode();
  let delivered = 0;
  let failed = 0;
  let queued = 0;

  for (const sub of subscriptions) {
    const outcome = await deliverWebhook(sub as WebhookSubscription, event, 0, {
      pool,
      queueMode,
    });
    if (outcome === "delivered") delivered++;
    else if (outcome === "queued") queued++;
    else failed++;
  }

  return { delivered, failed, queued };
}
