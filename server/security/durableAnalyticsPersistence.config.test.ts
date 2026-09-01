import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");
const read = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

describe("durable DPCO analytics and outbox source contracts", () => {
  it("registers PostgreSQL analytics and outbox tables in the active Drizzle journal", () => {
    const journal = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries).toContainEqual(expect.objectContaining({ idx: 36, tag: "0036_dpco_analytics_durable_events" }));
    const migration = read("drizzle/0036_dpco_analytics_durable_events.sql");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS dpco_analytics_events");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS dpco_analytics_dpco_stats");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS domain_event_outbox");
    expect(migration).toContain("uq_dpco_analytics_events_source_payload");
    expect(migration).toContain("idx_domain_event_outbox_due");
  });

  it("uses PostgreSQL as the Python analytics source of truth without demo generation", () => {
    const service = read("orchestration/python/dpco_analytics/service.py");
    expect(service).toContain("class DurableAnalyticsStore");
    expect(service).toContain("ConnectionPool(");
    expect(service).toContain("INSERT INTO dpco_analytics_events");
    expect(service).toContain("INSERT INTO dpco_analytics_dpco_stats");
    expect(service).toContain("ON CONFLICT (source, payload_sha256) DO NOTHING");
    expect(service).toContain("auto_offset_reset=\"earliest\"");
    expect(service).toContain("enable_auto_commit=False");
    expect(service).toContain("consumer.commit()");
    expect(service).not.toContain("_events:");
    expect(service).not.toContain("_dpco_stats:");
    expect(service).not.toContain("seed_demo");
    expect(service).toContain("no in-memory fallback");
  });

  it("installs the analytics PostgreSQL client and requires deliberate runtime wiring", () => {
    const dockerfile = read("orchestration/python/dpco_analytics/Dockerfile");
    const compose = read("orchestration/docker-compose.yml");
    expect(dockerfile).toContain('"psycopg[binary,pool]"');
    expect(compose).toContain("DPCO_ANALYTICS_DATABASE_URL: ${DPCO_ANALYTICS_DATABASE_URL:?DPCO_ANALYTICS_DATABASE_URL is required}");
    expect(compose).toContain("DPCO_ANALYTICS_SERVICE_TOKEN: ${DPCO_ANALYTICS_SERVICE_TOKEN:?DPCO_ANALYTICS_SERVICE_TOKEN is required}");
  });

  it("keeps gateway analytics responses on the authenticated durable service path", () => {
    const router = read("server/routers/dpco.ts");
    expect(router).toContain("DPCO_ANALYTICS_URL");
    expect(router).toContain("DPCO_ANALYTICS_SERVICE_TOKEN");
    expect(router).toContain('requestAnalyticsService("/api/dpco/analytics/trends")');
    expect(router).toContain('requestAnalyticsService("/api/dpco/analytics/portfolio")');
    expect(router).toContain('requestAnalyticsService("/api/dpco/analytics/heatmap")');
    expect(router).not.toContain('source: "db-fallback"');
    expect(router).toContain("DPCO analytics persistence service is unavailable");
  });

  it("reconciles DPCO client-policy schema, workflow states, and PostgreSQL upserts", () => {
    const journal = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: Array<{ idx: number; tag: string }> };
    const migration = read("drizzle/0037_dpco_client_policy_postgres_reconciliation.sql");
    const router = read("server/routers/dpco.ts");
    const schema = read("drizzle/schema.ts");
    expect(journal.entries).toContainEqual(expect.objectContaining({ idx: 37, tag: "0037_dpco_client_policy_postgres_reconciliation" }));
    expect(migration).toContain("uq_dpco_client_policies_natural_key");
    expect(migration).toContain("duplicate (dpco_org_id, client_id, template_id)");
    expect(migration).toContain("ADD VALUE IF NOT EXISTS 'customised'");
    expect(migration).toContain("ADD VALUE IF NOT EXISTS 'delivered'");
    expect(router).toContain("ON CONFLICT (dpco_org_id, client_id, template_id)");
    expect(router).toContain("template_name");
    expect(router).toContain("A persisted authenticated user is required");
    expect(router).not.toContain("ON DUPLICATE KEY");
    expect(router).not.toContain("assigned_at DESC");
    expect(schema).toContain('pgEnum("dpco_client_policy_status", ["draft", "customised", "reviewed", "signed", "delivered", "expired"])');
  });

  it("reconciles audit-control rating metadata and PostgreSQL upsert semantics", () => {
    const journal = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: Array<{ idx: number; tag: string }> };
    const migration = read("drizzle/0038_dpco_audit_control_rating_postgres_reconciliation.sql");
    const router = read("server/routers/dpco.ts");
    const schema = read("drizzle/schema.ts");
    expect(
      journal.entries.some(
        entry => entry.idx === 38 && entry.tag === "0038_dpco_audit_control_rating_postgres_reconciliation",
      ),
    ).toBe(true);
    expect(migration).toContain("uq_dpco_audit_control_ratings_natural_key");
    expect(migration).toContain("duplicate (engagement_id, control_id)");
    expect(router).toContain("ON CONFLICT (engagement_id, control_id)");
    expect(router).not.toContain("ON DUPLICATE KEY");
    expect(schema).toContain('dpcoOrgId: integer("dpco_org_id")');
    expect(schema).toContain('controlRef: varchar("control_ref", { length: 255 })');
    expect(schema).toContain('controlTitle: varchar("control_title", { length: 255 })');
  });

  it("uses a PostgreSQL outbox rather than a process-local Kafka retry queue", () => {
    const eventBus = read("server/eventBus.ts");
    const server = read("server/_core/index.ts");
    expect(eventBus).toContain("domain_event_outbox");
    expect(eventBus).toContain("FOR UPDATE SKIP LOCKED");
    expect(eventBus).toContain("startDurableOutbox");
    expect(eventBus).not.toContain("retryQueue");
    expect(server).toContain("startDurableOutbox();");
    expect(server).toContain("stopDurableOutbox();");
  });

  it("requires production Keycloak and persisted user identity mapping", () => {
    const validation = read("server/envValidation.ts");
    const middleware = read("server/authMiddleware.ts");
    expect(validation).toContain("production requires real Keycloak IAM");
    expect(middleware).toContain("Keycloak identity is not provisioned in NDSEP");
    expect(middleware).toContain("A valid Keycloak bearer token is required");
    expect(middleware).not.toContain("still set basic info");
  });
});
