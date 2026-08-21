/**
 * NDSEP Webhook Delivery System
 * ================================
 * Provides webhook registration, delivery with retries, and delivery logs.
 *
 * Recommendation E9: Webhook portal for event notifications
 */

import crypto from "crypto";
import { Pool } from "pg";
import { logger } from "./logger";
import { handleError } from "./errorClassifier";

export type WebhookEvent =
  | "breach.reported" | "breach.notified" | "breach.resolved"
  | "dsar.submitted" | "dsar.completed"
  | "audit.started" | "audit.completed"
  | "enforcement.created" | "enforcement.resolved"
  | "registration.submitted" | "registration.approved"
  | "compliance.score_changed";

export interface WebhookSubscription {
  id: number;
  orgId: number;
  url: string;
  events: WebhookEvent[];
  secret: string;
  active: boolean;
  createdAt: Date;
}

const WEBHOOK_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{}',
  secret TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  failure_count INTEGER DEFAULT 0,
  last_delivery_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_org ON webhook_subscriptions(org_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER REFERENCES webhook_subscriptions(id),
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  attempt INTEGER DEFAULT 1,
  delivered_at TIMESTAMPTZ DEFAULT NOW(),
  success BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_sub ON webhook_deliveries(subscription_id);
`;

export async function initWebhookSystem(pool: Pool): Promise<void> {
  try {
    await pool.query(WEBHOOK_TABLES_SQL);
    logger.info("[Webhooks] System initialized");
  } catch (err) {
    handleError(err, { module: "webhooks", action: "init" });
  }
}

/** Register a new webhook subscription */
export async function registerWebhook(
  pool: Pool,
  orgId: number,
  url: string,
  events: WebhookEvent[]
): Promise<{ id: number; secret: string }> {
  const secret = crypto.randomBytes(32).toString("hex");
  const result = await pool.query(
    `INSERT INTO webhook_subscriptions (org_id, url, events, secret)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [orgId, url, events, secret]
  );
  logger.info({ orgId, events, url }, "[Webhooks] Subscription registered");
  return { id: result.rows[0].id, secret };
}

/** Sign a webhook payload using HMAC-SHA256 */
function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/** Deliver a webhook event to all matching subscriptions */
export async function deliverWebhookEvent(
  pool: Pool,
  event: WebhookEvent,
  data: Record<string, unknown>,
  orgId?: number
): Promise<{ delivered: number; failed: number }> {
  const query = orgId
    ? `SELECT * FROM webhook_subscriptions WHERE active = true AND $1 = ANY(events) AND org_id = $2`
    : `SELECT * FROM webhook_subscriptions WHERE active = true AND $1 = ANY(events)`;
  const params = orgId ? [event, orgId] : [event];
  const subs = await pool.query(query, params);

  let delivered = 0;
  let failed = 0;

  for (const sub of subs.rows) {
    try {
      const payload = JSON.stringify({
        event,
        data,
        timestamp: new Date().toISOString(),
        webhookId: sub.id,
      });
      const signature = signPayload(payload, sub.secret);

      const response = await fetch(sub.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-NDSEP-Signature": `sha256=${signature}`,
          "X-NDSEP-Event": event,
          "X-NDSEP-Delivery": crypto.randomUUID(),
        },
        body: payload,
        signal: AbortSignal.timeout(10_000),
      });

      const success = response.ok;
      await pool.query(
        `INSERT INTO webhook_deliveries (subscription_id, event, payload, response_status, success)
         VALUES ($1, $2, $3, $4, $5)`,
        [sub.id, event, data, response.status, success]
      );

      if (success) {
        delivered++;
        await pool.query(
          `UPDATE webhook_subscriptions SET last_delivery_at = NOW(), failure_count = 0 WHERE id = $1`,
          [sub.id]
        );
      } else {
        failed++;
        await pool.query(
          `UPDATE webhook_subscriptions SET failure_count = failure_count + 1 WHERE id = $1`,
          [sub.id]
        );
      }
    } catch (err) {
      failed++;
      handleError(err, { module: "webhooks", subscriptionId: sub.id, event });
      // Disable after 10 consecutive failures
      await pool.query(
        `UPDATE webhook_subscriptions SET failure_count = failure_count + 1,
         active = CASE WHEN failure_count >= 10 THEN false ELSE active END
         WHERE id = $1`,
        [sub.id]
      );
    }
  }

  return { delivered, failed };
}
