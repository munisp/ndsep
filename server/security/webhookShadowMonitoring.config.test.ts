import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("webhook shadow monitoring contract", () => {
  const migration = read(
    "drizzle/0045_webhook_delivery_attempts_shadow_queue.sql"
  );
  const journal = read("drizzle/meta/_journal.json");
  const schema = read("drizzle/schema.ts");
  const delivery = read("server/webhookDelivery.ts");
  const core = read("server/_core/index.ts");
  const alerts = read("infra/prometheus/alerts.yml");
  const dashboard = JSON.parse(
    read("infra/grafana/dashboards/ndsep-webhook-shadow.json")
  );
  const provisioning = read(
    "infra/grafana/provisioning/dashboards/ndsep-webhook-shadow.yml"
  );
  const compose = read("docker-compose.production.yml");
  const ci = read(".github/workflows/ci.yml");

  it("owns the shadow queue through one root migration and matching Drizzle declaration", () => {
    expect(journal).toContain('"idx": 45');
    expect(journal).toContain(
      '"tag": "0045_webhook_delivery_attempts_shadow_queue"'
    );
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS webhook_delivery_attempts"
    );
    expect(migration).toContain("idempotency_key varchar(160) NOT NULL UNIQUE");
    expect(migration).toContain(
      "webhook_delivery_attempt_processing_claim_check"
    );
    expect(schema).toContain('pgTable("webhook_delivery_attempts"');
    expect(schema).toContain("idempotencyKey");
  });

  it("keeps shadow delivery durable and makes active admission explicitly asynchronous", () => {
    expect(delivery).toContain(
      'export type WebhookDeliveryQueueMode = "disabled" | "shadow" | "active"'
    );
    expect(delivery).toContain(
      "await enqueueWebhookAttempt(pool, subscription, event, queueMode)"
    );
    expect(delivery).toContain('return "queued";');
    expect(delivery).toMatch(
      /await recordWebhookDeliveryAttempt\(\s*pool,\s*subscription,\s*event,\s*response\.status,\s*success,\s*attempt\s*\)/
    );
    expect(delivery).toContain(
      'await finalizeShadow("delivered", response.status, attempt + 1)'
    );
    expect(delivery).toContain(
      'await finalizeShadow("dead", response.status, attempt + 1)'
    );
  });

  it("exports bounded aggregate metrics and alerts on queue persistence or reconciliation failures", () => {
    for (const metric of [
      "ndsep_webhook_shadow_mode",
      "ndsep_webhook_shadow_enqueued_total",
      "ndsep_webhook_shadow_enqueue_errors_total",
      "ndsep_webhook_shadow_finalizations_total",
      "ndsep_webhook_shadow_finalization_errors_total",
      "ndsep_webhook_shadow_last_enqueued_unixtime",
    ]) {
      expect(core).toContain(metric);
    }
    for (const alertMetric of [
      "ndsep_webhook_shadow_mode",
      "ndsep_webhook_shadow_enqueued_total",
      "ndsep_webhook_shadow_enqueue_errors_total",
      "ndsep_webhook_shadow_finalizations_total",
      "ndsep_webhook_shadow_finalization_errors_total",
    ]) {
      expect(alerts).toContain(alertMetric);
    }
    expect(alerts).toContain("WebhookShadowQueueIntentFailure");
    expect(alerts).toContain("WebhookShadowQueueFinalizationFailure");
    expect(alerts).toContain("WebhookShadowTerminalErrorRateHigh");
    expect(alerts).toContain("WebhookShadowMetricsUnavailable");
    expect(alerts).toContain("max(ndsep_webhook_shadow_mode) == 1");
    expect(alerts).toContain(
      "max_over_time(ndsep_webhook_shadow_mode[2m]) == 1"
    );
    expect(alerts).toContain(
      'sum(increase(ndsep_webhook_shadow_finalizations_total{outcome="dead"}[5m])) >= 5'
    );
  });

  it("provisions the dashboard with only actual shadow metrics and runs its real PostgreSQL integration in CI", () => {
    expect(dashboard.uid).toBe("ndsep-webhook-shadow-v1");
    expect(JSON.stringify(dashboard)).toContain("ndsep_webhook_shadow_mode");
    expect(JSON.stringify(dashboard)).toContain(
      "ndsep_webhook_shadow_finalization_errors_total"
    );
    expect(provisioning).toContain("path: /var/lib/grafana/dashboards");
    expect(compose).toContain(
      "./infra/grafana/dashboards:/var/lib/grafana/dashboards:ro"
    );
    expect(ci).toContain("WEBHOOK_SHADOW_QUEUE_TEST_DATABASE_URL");
    expect(ci).toContain(
      'DATABASE_URL="$WEBHOOK_SHADOW_QUEUE_TEST_DATABASE_URL" pnpm exec drizzle-kit migrate'
    );
  });
});
