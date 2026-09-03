import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

import {
  deliverWebhook,
  dispatchEvent,
  getWebhookShadowMetrics,
  webhookDeliveryAttemptKey,
} from "./webhookDelivery";

const databaseUrl = process.env.WEBHOOK_SHADOW_QUEUE_TEST_DATABASE_URL;

function isDisposableLocalPostgresUrl(value: string): boolean {
  const parsed = new URL(value);
  const databaseName = parsed.pathname.replace(/^\//, "").toLowerCase();
  return (
    parsed.protocol === "postgresql:" &&
    ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
    /(?:test|ci|synthetic|integration)/.test(databaseName)
  );
}

const shouldRun =
  typeof databaseUrl === "string" && isDisposableLocalPostgresUrl(databaseUrl);

if (databaseUrl && !shouldRun) {
  throw new Error(
    "WEBHOOK_SHADOW_QUEUE_TEST_DATABASE_URL must identify a localhost disposable test database"
  );
}

const subscription = {
  id: 1,
  url: "https://receiver.invalid/ndsep",
  secret: "synthetic-webhook-secret",
  events: ["audit.completed"],
  active: true,
  organizationId: 1,
};

function event(id: string) {
  return {
    id,
    type: "audit.completed",
    data: { auditId: `audit-${id}`, outcome: "completed" },
    timestamp: "2026-09-03T00:00:00.000Z",
  };
}

describe.skipIf(!shouldRun)(
  "webhook shadow queue PostgreSQL integration",
  () => {
    let pool: Pool;

    beforeAll(async () => {
      pool = new Pool({ connectionString: databaseUrl, max: 1 });
      await pool.query(
        "TRUNCATE TABLE webhook_delivery_attempts, webhook_deliveries, webhook_subscriptions RESTART IDENTITY CASCADE"
      );
      await pool.query(
        `INSERT INTO webhook_subscriptions (org_id, url, events, secret, active)
       VALUES ($1, $2, $3::text[], $4, true)`,
        [1, subscription.url, subscription.events, subscription.secret]
      );
    });

    afterAll(async () => {
      await pool.end();
    });

    it("durably writes a shadow intent and canonical delivery outcome before reporting successful delivery", async () => {
      const metricsBefore = getWebhookShadowMetrics();
      const payload = event("11111111-1111-4111-8111-111111111111");

      const delivered = await deliverWebhook(subscription, payload, 0, {
        pool,
        queueMode: "shadow",
        fetchImpl: vi
          .fn()
          .mockResolvedValue(new Response(null, { status: 202 })),
        sleep: async () => undefined,
      });

      expect(delivered).toBe("delivered");
      const queue = await pool.query(
        `SELECT status, attempt_count, last_response_code, delivered_at, idempotency_key
       FROM webhook_delivery_attempts
       WHERE subscription_id = $1 AND event_id = $2::uuid`,
        [subscription.id, payload.id]
      );
      expect(queue.rows).toHaveLength(1);
      expect(queue.rows[0]).toMatchObject({
        status: "delivered",
        attempt_count: 1,
        last_response_code: 202,
        idempotency_key: webhookDeliveryAttemptKey(subscription.id, payload.id),
      });
      expect(queue.rows[0].delivered_at).not.toBeNull();

      const ledger = await pool.query(
        "SELECT response_status, success, attempt FROM webhook_deliveries WHERE subscription_id = $1 AND payload->>'id' = $2",
        [subscription.id, payload.id]
      );
      expect(ledger.rows).toEqual([
        { response_status: 202, success: true, attempt: 1 },
      ]);
      expect(getWebhookShadowMetrics()).toMatchObject({
        enqueued: metricsBefore.enqueued + 1,
        finalizedDelivered: metricsBefore.finalizedDelivered + 1,
        finalizedDead: metricsBefore.finalizedDead,
        enqueueErrors: metricsBefore.enqueueErrors,
        finalizationErrors: metricsBefore.finalizationErrors,
      });
    });

    it("accepts active queue mode only after durable pending intent and does not synchronously deliver", async () => {
      const metricsBefore = getWebhookShadowMetrics();
      const payload = event("44444444-4444-4444-8444-444444444444");
      const receiver = vi.fn();

      const accepted = await deliverWebhook(subscription, payload, 0, {
        pool,
        queueMode: "active",
        fetchImpl: receiver as unknown as typeof fetch,
        sleep: async () => undefined,
      });

      expect(accepted).toBe("queued");
      expect(receiver).not.toHaveBeenCalled();
      const queue = await pool.query(
        "SELECT status, attempt_count, claim_token, claim_owner, claim_expires_at FROM webhook_delivery_attempts WHERE event_id = $1::uuid",
        [payload.id]
      );
      expect(queue.rows).toEqual([
        {
          status: "pending",
          attempt_count: 0,
          claim_token: null,
          claim_owner: null,
          claim_expires_at: null,
        },
      ]);
      const ledger = await pool.query(
        "SELECT count(*)::int AS count FROM webhook_deliveries WHERE payload->>'id' = $1",
        [payload.id]
      );
      expect(ledger.rows).toEqual([{ count: 0 }]);
      expect(getWebhookShadowMetrics().activeEnqueued).toBe(
        metricsBefore.activeEnqueued + 1
      );

      const duplicateOutcome = await deliverWebhook(subscription, payload, 0, {
        pool,
        queueMode: "active",
        fetchImpl: receiver as unknown as typeof fetch,
        sleep: async () => undefined,
      });
      expect(duplicateOutcome).toBe("queued");
      expect(receiver).not.toHaveBeenCalled();
      const duplicateQueue = await pool.query(
        "SELECT count(*)::int AS count FROM webhook_delivery_attempts WHERE event_id = $1::uuid",
        [payload.id]
      );
      expect(duplicateQueue.rows).toEqual([{ count: 1 }]);
      expect(getWebhookShadowMetrics().activeEnqueued).toBe(
        metricsBefore.activeEnqueued + 1
      );
    });

    it("uses migration-owned org_id filtering for active dispatch and reports queue acceptance", async () => {
      await pool.query(
        `INSERT INTO webhook_subscriptions (org_id, url, events, secret, active)
         VALUES ($1, $2, $3::text[], $4, true)`,
        [
          2,
          "https://other-org.invalid/ndsep",
          ["audit.completed"],
          "other-org-secret",
        ]
      );
      const eventId = "66666666-6666-4666-8666-666666666666";

      const result = await dispatchEvent(
        "audit.completed",
        { auditId: "org-scoped-dispatch" },
        1,
        {
          pool,
          queueMode: "active",
          eventId,
          now: () => new Date("2026-09-03T00:00:00.000Z"),
        }
      );

      expect(result).toEqual({ delivered: 0, failed: 0, queued: 1 });
      const queue = await pool.query(
        `SELECT s.org_id, a.status, a.event_id
         FROM webhook_delivery_attempts a
         JOIN webhook_subscriptions s ON s.id = a.subscription_id
         WHERE a.event_id = $1::uuid`,
        [eventId]
      );
      expect(queue.rows).toEqual([
        { org_id: 1, status: "pending", event_id: eventId },
      ]);
    });

    it("refuses an inactive subscription before enqueue or synchronous receiver activity", async () => {
      const payload = event("55555555-5555-4555-8555-555555555555");
      const receiver = vi.fn();
      const inactiveOutcome = await deliverWebhook(
        { ...subscription, active: false },
        payload,
        0,
        {
          pool,
          queueMode: "active",
          fetchImpl: receiver as unknown as typeof fetch,
          sleep: async () => undefined,
        }
      );
      expect(inactiveOutcome).toBe("failed");
      expect(receiver).not.toHaveBeenCalled();
      const queue = await pool.query(
        "SELECT count(*)::int AS count FROM webhook_delivery_attempts WHERE event_id = $1::uuid",
        [payload.id]
      );
      expect(queue.rows).toEqual([{ count: 0 }]);
    });

    it("records terminal transport-partition failure as a dead shadow row without retry masking", async () => {
      const metricsBefore = getWebhookShadowMetrics();
      const payload = event("22222222-2222-4222-8222-222222222222");
      const fetchPartition = vi
        .fn()
        .mockRejectedValue(new TypeError("simulated network partition"));
      const noWait = vi.fn().mockResolvedValue(undefined);

      const delivered = await deliverWebhook(subscription, payload, 0, {
        pool,
        queueMode: "shadow",
        fetchImpl: fetchPartition,
        sleep: noWait,
      });

      expect(delivered).toBe("failed");
      expect(fetchPartition).toHaveBeenCalledTimes(3);
      expect(noWait).toHaveBeenCalledTimes(2);

      const queue = await pool.query(
        "SELECT status, attempt_count, last_response_code, delivered_at FROM webhook_delivery_attempts WHERE event_id = $1::uuid",
        [payload.id]
      );
      expect(queue.rows).toEqual([
        {
          status: "dead",
          attempt_count: 3,
          last_response_code: null,
          delivered_at: null,
        },
      ]);

      const ledger = await pool.query(
        "SELECT response_status, success, attempt FROM webhook_deliveries WHERE payload->>'id' = $1",
        [payload.id]
      );
      expect(ledger.rows).toEqual([
        { response_status: null, success: false, attempt: 3 },
      ]);
      expect(getWebhookShadowMetrics()).toMatchObject({
        enqueued: metricsBefore.enqueued + 1,
        finalizedDelivered: metricsBefore.finalizedDelivered,
        finalizedDead: metricsBefore.finalizedDead + 1,
        enqueueErrors: metricsBefore.enqueueErrors,
        finalizationErrors: metricsBefore.finalizationErrors,
      });
    });

    it("returns failure and leaves a reconciliation-visible shadow intent when canonical ledger persistence fails", async () => {
      const payload = event("33333333-3333-4333-8333-333333333333");
      let queryCount = 0;
      const failoverAfterShadowIntent = {
        query: async (...arguments_: Parameters<Pool["query"]>) => {
          queryCount += 1;
          if (queryCount === 2)
            throw new Error(
              "simulated PostgreSQL failover during canonical ledger write"
            );
          return pool.query(...arguments_);
        },
      };

      const delivered = await deliverWebhook(subscription, payload, 0, {
        pool: failoverAfterShadowIntent,
        queueMode: "shadow",
        fetchImpl: vi
          .fn()
          .mockResolvedValue(new Response(null, { status: 202 })),
        sleep: async () => undefined,
      });

      expect(delivered).toBe("failed");
      const orphanedShadowIntent = await pool.query(
        `SELECT a.status, count(d.id)::int AS canonical_rows
       FROM webhook_delivery_attempts a
       LEFT JOIN webhook_deliveries d
         ON d.subscription_id = a.subscription_id
        AND d.payload->>'id' = a.event_id::text
       WHERE a.event_id = $1::uuid
       GROUP BY a.status`,
        [payload.id]
      );
      expect(orphanedShadowIntent.rows).toEqual([
        { status: "shadow", canonical_rows: 0 },
      ]);
    });
  }
);
