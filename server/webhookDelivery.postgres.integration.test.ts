import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { recordWebhookDeliveryAttempt } from "./webhookDelivery";

const databaseUrl = process.env.WEBHOOK_LEDGER_TEST_DATABASE_URL;

function isDisposableLocalPostgresUrl(value: string): boolean {
  const parsed = new URL(value);
  const databaseName = parsed.pathname.replace(/^\//, "").toLowerCase();
  return (
    parsed.protocol === "postgresql:"
    && ["127.0.0.1", "localhost"].includes(parsed.hostname)
    && /(?:test|ci|synthetic|integration)/.test(databaseName)
  );
}

const shouldRun = typeof databaseUrl === "string" && isDisposableLocalPostgresUrl(databaseUrl);

// The test never chooses a database itself. A supplied non-disposable target
// fails the suite rather than risking a write to a shared environment.
if (databaseUrl && !shouldRun) {
  throw new Error("WEBHOOK_LEDGER_TEST_DATABASE_URL must identify a localhost disposable test database");
}

describe.skipIf(!shouldRun)("webhook delivery PostgreSQL integration", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query("TRUNCATE TABLE webhook_deliveries, webhook_subscriptions RESTART IDENTITY CASCADE");
    await pool.query(
      `INSERT INTO webhook_subscriptions (org_id, url, events, secret, active)
       VALUES ($1, $2, $3::text[], $4, true)`,
      [1, "https://receiver.invalid/ndsep", ["audit.completed"], "synthetic-webhook-secret"]
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("persists a complete, canonical, successful delivery attempt in PostgreSQL", async () => {
    const event = {
      id: "47e36de4-8c2f-4d54-9ff8-9a845e4a4377",
      type: "audit.completed",
      data: { auditId: "audit-synthetic-001", outcome: "completed" },
      timestamp: "2026-09-01T00:00:00.000Z",
    };

    await recordWebhookDeliveryAttempt(pool, { id: 1 }, event, 202, true, 0);

    const { rows } = await pool.query(
      `SELECT subscription_id, event, payload, response_status, response_body, attempt, success
       FROM webhook_deliveries`
    );

    expect(rows).toEqual([
      {
        subscription_id: 1,
        event: "audit.completed",
        payload: event,
        response_status: 202,
        response_body: null,
        attempt: 1,
        success: true,
      },
    ]);
  });
});
