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
import { dispatchEvent } from "./webhookDelivery";

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

export async function initWebhookSystem(pool: Pool): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [["webhook_subscriptions", "webhook_deliveries"]]
  );
  const found = new Set(result.rows.map((row) => row.table_name));
  const missing = ["webhook_subscriptions", "webhook_deliveries"].filter((table) => !found.has(table));
  if (missing.length) throw new Error(`Webhook migration 0029 is incomplete; missing tables: ${missing.join(", ")}`);
  logger.info("[Webhooks] Migration-owned schema verified");
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

/**
 * Compatibility facade for older internal emitters. Delivery is delegated to the
 * single durable dispatcher; this module must never create an alternate direct
 * receiver path that can bypass queue admission, canonical ledger semantics, or
 * the active worker's egress controls.
 */
export async function deliverWebhookEvent(
  pool: Pool,
  event: WebhookEvent,
  data: Record<string, unknown>,
  orgId?: number
): Promise<{ delivered: number; failed: number; queued: number }> {
  return dispatchEvent(event, data, orgId, { pool });
}
