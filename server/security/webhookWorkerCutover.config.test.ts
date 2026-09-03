import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(resolve(root, relativePath), "utf8");

describe("webhook worker cutover contract", () => {
  const migration = read(
    "drizzle/0046_webhook_delivery_attempt_claim_leases.sql"
  );
  const journal = read("drizzle/meta/_journal.json");
  const nodeDispatcher = read("server/webhookDelivery.ts");
  const worker = read("workers/go/cmd/webhook_delivery/main.go");
  const workerTests = read(
    "workers/go/cmd/webhook_delivery/main_integration_test.go"
  );
  const workerSecurityTests = read(
    "workers/go/cmd/webhook_delivery/main_test.go"
  );
  const metrics = read("server/_core/index.ts");
  const template = read("infra/k8s/webhook-delivery-worker.yaml.tmpl");
  const renderer = read(
    "scripts/ci/render-webhook-delivery-worker-manifest.sh"
  );
  const scaledObject = read("infra/k8s/keda-scaledobjects.yaml");
  const alerts = read("infra/prometheus/alerts.yml");
  const dashboard = JSON.parse(
    read("infra/grafana/dashboards/ndsep-webhook-delivery-worker.json")
  );

  it("owns queue claim, lease, and canonical outcome linkage through journaled root migration 0046", () => {
    expect(journal).toContain('"idx": 46');
    expect(journal).toContain(
      '"tag": "0046_webhook_delivery_attempt_claim_leases"'
    );
    for (const required of [
      "claim_token uuid",
      "claim_owner varchar(128)",
      "claim_expires_at timestamptz",
      "last_error text",
      "queue_attempt_id bigint",
      "webhook_deliveries_queue_attempt_id_fk",
      "uq_webhook_deliveries_queue_attempt",
      "webhook_delivery_attempt_processing_claim_check",
    ]) {
      expect(migration).toContain(required);
    }
  });

  it("uses a transaction-scoped SKIP LOCKED claim and token-guarded finalization without runtime DDL", () => {
    expect(worker).toContain(
      "db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})"
    );
    expect(worker).toContain("FOR UPDATE OF a SKIP LOCKED");
    expect(worker).toContain("claim_token = $2::uuid");
    expect(worker).toContain("claim_expires_at = now() + $4::interval");
    expect(worker).toContain("AND claim_token = $2::uuid");
    expect(worker).toContain(
      "ON CONFLICT (queue_attempt_id) WHERE queue_attempt_id IS NOT NULL DO NOTHING"
    );
    expect(worker).toContain("if terminal {");
    expect(worker).toContain("func validateWebhookTarget");
    expect(worker).toContain("net.DefaultResolver.LookupNetIP");
    expect(worker).toContain(
      "webhook destination resolved to a blocked network address"
    );
    expect(workerSecurityTests).toContain("TestValidateWebhookTarget");
    expect(worker).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+INDEX/i);
    expect(workerTests).toContain(
      "TestWorkerClaimsAndFinalizesExactlyOneCanonicalOutcomePostgres"
    );
    expect(workerTests).toContain(
      "TestWorkerClaimSkipsAlreadyLeasedAttemptPostgres"
    );
    expect(workerTests).toContain(
      "TestWorkerRecoversExpiredLeaseAndReclaimsPostgres"
    );
    expect(workerTests).toContain(
      "TestWorkerConcurrentClaimsAreMutuallyExclusivePostgres"
    );
    expect(workerTests).toContain(
      "TestWorkerRecordsCanonicalOutcomeOnlyAfterTerminalStatePostgres"
    );
    expect(workerTests).toContain(
      "TestWorkerCanonicalLedgerFailureRollsBackQueueFinalizationPostgres"
    );
    expect(workerTests).toContain(
      "TestWorkerFinalizesInactiveSubscriptionWithoutDeliveryPostgres"
    );
  });

  it("keeps active admission asynchronous and instruments it without receiver identifiers", () => {
    expect(nodeDispatcher).toContain('"disabled" | "shadow" | "active"');
    expect(nodeDispatcher).toContain(
      "await enqueueWebhookAttempt(pool, subscription, event, queueMode)"
    );
    expect(nodeDispatcher).toContain('if (queueMode === "active") {');
    expect(nodeDispatcher).toContain(
      "const queueMode = getWebhookDeliveryQueueMode()"
    );
    expect(metrics).toContain("ndsep_webhook_queue_active_mode");
    expect(metrics).toContain("ndsep_webhook_queue_active_enqueued_total");
  });

  it("requires a rendered immutable GHCR image and scales only on a one-value claimable queue query", () => {
    expect(template).toContain("image: ${NDSEP_WEBHOOK_DELIVERY_IMAGE}");
    expect(template).toContain('value: "active"');
    expect(template).toContain("webhook-delivery-worker-db");
    expect(template).toContain('prometheus.io/scrape: "true"');
    expect(template).not.toMatch(/image:\s+.*:latest/);
    expect(renderer).toContain("ghcr.io/munisp/ndsep@sha256:");
    expect(renderer).toContain("must be an approved immutable");
    expect(scaledObject).toContain("name: webhook-delivery-worker-keda");
    expect(scaledObject).toContain("type: postgresql");
    expect(scaledObject).toContain("connectionFromEnv: NDSEP_PG_SCALER_URL");
    expect(scaledObject).toContain("SELECT COALESCE(count(*), 0)::numeric");
    expect(scaledObject).toContain('targetQueryValue: "50"');
    for (const metric of [
      "ndsep_webhook_queue_worker_claimed_total",
      "ndsep_webhook_queue_worker_delivered_total",
      "ndsep_webhook_queue_worker_retried_total",
      "ndsep_webhook_queue_worker_dead_total",
      "ndsep_webhook_queue_worker_finalization_errors_total",
    ]) {
      expect(worker).toContain(metric);
      expect(JSON.stringify(dashboard)).toContain(metric);
    }
    expect(alerts).toContain("WebhookActiveQueueAdmissionFailure");
    expect(alerts).toContain("WebhookActiveWorkerFinalizationFailure");
    expect(alerts).toContain("WebhookActiveWorkerMetricsUnavailable");
    expect(dashboard.uid).toBe("ndsep-webhook-delivery-worker-v1");
  });
});
