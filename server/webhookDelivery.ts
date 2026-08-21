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

let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: getDatabaseUrl(), ssl: getPgSslConfig(), max: 3 });
  }
  return _pool;
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

async function deliverWebhook(
  subscription: WebhookSubscription,
  event: WebhookEvent,
  attempt: number = 0
): Promise<boolean> {
  const payload = JSON.stringify(event);
  const signature = signPayload(payload, subscription.secret);

  try {
    const response = await fetch(subscription.url, {
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

    // Log delivery
    const pool = getPool();
    await pool.query(
      `INSERT INTO webhook_deliveries (subscription_id, event_type, event_id, status_code, success, attempt, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [subscription.id, event.type, event.id, response.status, success, attempt + 1]
    ).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));

    if (success) {
      logger.info({ subscriptionId: subscription.id, eventType: event.type }, "[Webhook] Delivered");
      return true;
    }

    // Retry on server errors
    if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
      const delay = RETRY_DELAYS[attempt] ?? 30000;
      logger.warn({ subscriptionId: subscription.id, status: response.status, attempt }, "[Webhook] Retrying in %dms", delay);
      await new Promise(resolve => setTimeout(resolve, delay));
      return deliverWebhook(subscription, event, attempt + 1);
    }

    logger.error({ subscriptionId: subscription.id, status: response.status }, "[Webhook] Delivery failed");
    return false;
  } catch (err) {
    if (attempt < MAX_RETRIES - 1) {
      const delay = RETRY_DELAYS[attempt] ?? 30000;
      await new Promise(resolve => setTimeout(resolve, delay));
      return deliverWebhook(subscription, event, attempt + 1);
    }
    logger.error({ err, subscriptionId: subscription.id }, "[Webhook] Delivery failed after %d attempts", MAX_RETRIES);
    return false;
  }
}

export async function dispatchEvent(
  eventType: string,
  data: Record<string, unknown>,
  orgId?: number
): Promise<{ delivered: number; failed: number }> {
  const pool = getPool();
  const event: WebhookEvent = {
    id: crypto.randomUUID(),
    type: eventType,
    data,
    timestamp: new Date().toISOString(),
  };

  // Find matching subscriptions
  const { rows: subscriptions } = await pool.query(
    `SELECT id, url, secret, events, active, organization_id
     FROM webhook_subscriptions
     WHERE active = true
       AND ($1::int IS NULL OR organization_id = $1)
       AND events @> $2::jsonb`,
    [orgId ?? null, JSON.stringify([eventType])]
  );

  let delivered = 0;
  let failed = 0;

  for (const sub of subscriptions) {
    const success = await deliverWebhook(sub as WebhookSubscription, event);
    if (success) delivered++;
    else failed++;
  }

  return { delivered, failed };
}
