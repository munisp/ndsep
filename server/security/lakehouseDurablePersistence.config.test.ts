import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const read = (relativePath: string) => fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

describe("Lakehouse durable PostgreSQL persistence contract", () => {
  it("registers the Lakehouse ledger and feature-store schema in the active Drizzle journal", () => {
    const journal = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: Array<{ tag: string }> };
    expect(journal.entries.some((entry) => entry.tag === "0039_lakehouse_durable_postgres_storage")).toBe(true);

    const migration = read("drizzle/0039_lakehouse_durable_postgres_storage.sql");
    for (const table of ["lakehouse_ingest_records", "ml_feature_store", "ml_prediction_log", "ml_lineage"]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(migration).toContain("record_hash CHAR(64) NOT NULL UNIQUE");
  });

  it("declares the same durable tables in the Drizzle ORM schema", () => {
    const schema = read("drizzle/schema.ts");
    for (const declaration of [
      'pgTable("lakehouse_ingest_records"',
      'pgTable("ml_feature_store"',
      'pgTable("ml_prediction_log"',
      'pgTable("ml_lineage"',
    ]) {
      expect(schema).toContain(declaration);
    }
  });

  it("uses PostgreSQL as the Lakehouse ingest source of truth with durable leasing and retry", () => {
    const worker = read("workers/rust/lakehouse_ingest/src/main.rs");
    expect(worker).toContain("tokio_postgres::connect");
    expect(worker).toContain("lakehouse_ingest_records");
    expect(worker).toContain("ON CONFLICT (record_hash) DO NOTHING");
    expect(worker).toContain("FOR UPDATE SKIP LOCKED");
    expect(worker).toContain("recover_expired_leases");
    expect(worker).toContain("delivery_status = 'retry'");
    expect(worker).toContain("Lakehouse ingestion has no in-memory fallback");
    expect(worker).not.toContain("VecDeque<LakehouseRecord>");
    expect(worker).not.toContain("Mutex<VecDeque");
  });

  it("uses transaction-coupled Lakehouse delivery and fail-closed PostgreSQL writes", () => {
    const writer = read("workers/rust/lakehouse_writer/src/main.rs");
    expect(writer).toContain("PostgreSQL migration-owned tables are reachable");
    expect(writer).toContain("required_postgres_url");
    expect(writer).toContain("client.transaction()");
    expect(writer).toContain("enqueue_lakehouse_delivery");
    expect(writer).toContain("durable Lakehouse enqueue failed");
    expect(writer).toContain("$1::text::uuid");
    expect(writer).toContain("$4::text::jsonb");
    expect(writer).toContain("POSTGRES_TLS_CA_FILE is required in production");
    expect(writer).not.toContain("CREATE TABLE IF NOT EXISTS ml_feature_store");
    expect(writer).not.toContain("ndsep_secure_2026@localhost");
    expect(writer).not.toContain("forward_to_parquet");
    expect(writer).not.toContain("LAKEHOUSE_ANALYTICS_URL");
  });

  it("requires certificate-validated PostgreSQL TLS for Lakehouse workers in production mode", () => {
    const ingest = read("workers/rust/lakehouse_ingest/src/main.rs");
    const writer = read("workers/rust/lakehouse_writer/src/main.rs");
    for (const worker of [ingest, writer]) {
      expect(worker).toContain("postgres_native_tls::MakeTlsConnector");
      expect(worker).toContain("POSTGRES_TLS_CA_FILE is required in production");
      expect(worker).toContain("Protocol::Tlsv12");
    }
  });

  it("runs against a disposable PostgreSQL database in Rust CI and requires explicit orchestration inputs", () => {
    const workflow = read(".github/workflows/ci.yml");
    expect(workflow).toContain("LAKEHOUSE_INGEST_TEST_DATABASE_URL");
    expect(workflow).toContain("LAKEHOUSE_WRITER_TEST_DATABASE_URL");
    expect(workflow).toContain("ndsep_rust_ci_local_only");
    expect(workflow).toContain("Rust CI (Check + Test)");
    const compose = read("orchestration/docker-compose.yml");
    expect(compose).toContain("lakehouse-ingest:");
    expect(compose).toContain("LAKEHOUSE_INGEST_DATABASE_URL is required");
    expect(compose).toContain("LAKEHOUSE_INGEST_URL is required");

    const productionCompose = read("docker-compose.production.yml");
    expect(productionCompose).toContain("LAKEHOUSE_INGEST_PORT: \"8304\"");
    expect(productionCompose).toContain("LAKEHOUSE_WRITER_PORT: \"8305\"");
    expect(productionCompose).toContain("POSTGRES_TLS_CA_FILE: /etc/ndsep/postgres-ca.crt");
    expect(productionCompose).toContain("LAKEHOUSE_INGEST_URL is required");

    const securityGate = read(".github/workflows/security-gate.yml");
    expect(securityGate).toContain("breakGlassSiemPagerIntegration.test.ts");
    expect(securityGate).toContain("0039_lakehouse_durable_postgres_storage.sql");
  });
});
