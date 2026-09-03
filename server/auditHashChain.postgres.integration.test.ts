import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";

const databaseUrl = process.env.AUDIT_HASH_CHAIN_TEST_DATABASE_URL;

function isDisposableLocalPostgresUrl(value: string): boolean {
  const parsed = new URL(value);
  const databaseName = parsed.pathname.replace(/^\//, "").toLowerCase();
  return (
    parsed.protocol === "postgresql:"
    && ["127.0.0.1", "localhost"].includes(parsed.hostname)
    && /(?:test|ci|synthetic|integration|e2e)/.test(databaseName)
  );
}

const shouldRun = typeof databaseUrl === "string" && isDisposableLocalPostgresUrl(databaseUrl);

if (databaseUrl && !shouldRun) {
  throw new Error("AUDIT_HASH_CHAIN_TEST_DATABASE_URL must identify a localhost disposable test database");
}

function expectedHash(row: {
  action: string;
  resource_type: string | null;
  resource_id: string | number | null;
  user_id: string | number | null;
  details: string;
  created_at: string;
}, previousHash: string): string {
  return crypto.createHash("sha256").update([
    previousHash,
    row.action,
    row.resource_type ?? "",
    row.resource_id == null ? "" : String(row.resource_id),
    row.user_id == null ? "" : String(row.user_id),
    row.details,
    row.created_at,
  ].join("|")).digest("hex");
}

describe.skipIf(!shouldRun)("audit-log hash-chain PostgreSQL integration", () => {
  let client: Client;
  let migration: string;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("AUDIT_HASH_CHAIN_TEST_DATABASE_URL is required");
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await client.query("DROP TABLE IF EXISTS audit_logs CASCADE");
    await client.query(`
      CREATE TABLE audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        organization_id INTEGER,
        action VARCHAR(128) NOT NULL,
        resource_type VARCHAR(64),
        resource_id INTEGER,
        details TEXT,
        ip_address VARCHAR(64),
        user_agent TEXT,
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    migration = await readFile(new URL("../drizzle/0043_audit_log_hash_chain_durable.sql", import.meta.url), "utf8");
    await client.query(migration);
  });

  afterAll(async () => {
    await client?.end();
  });

  it("assigns a deterministic database-owned chain and preserves an ordered predecessor link", async () => {
    await client.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, created_at)
       VALUES ($1, $2, $3, $4, $5, $6), ($7, $8, $9, $10, $11, $12)`,
      [
        7, "rollback_drill_started", "deployment", 1, '{"drill":"staging-rollback-a1b2c3d4"}', "2026-09-02T10:00:00Z",
        7, "rollback_drill_completed", "deployment", 1, '{"drill":"staging-rollback-a1b2c3d4"}', "2026-09-02T10:00:01Z",
      ],
    );

    const rows = await client.query<{
      id: number;
      action: string;
      resource_type: string | null;
      resource_id: number | null;
      user_id: number | null;
      details: string;
      created_at: string;
      previous_hash: string | null;
      hash_chain: string;
    }>(`SELECT id, action, resource_type, resource_id, user_id,
              COALESCE(details::text, '{}') AS details,
              created_at::text AS created_at, previous_hash, hash_chain
         FROM audit_logs
        ORDER BY id`);

    expect(rows.rows).toHaveLength(2);
    const [first, second] = rows.rows;
    const firstExpected = expectedHash(first, "GENESIS");
    const secondExpected = expectedHash(second, firstExpected);
    expect(first.previous_hash).toBeNull();
    expect(first.hash_chain).toBe(firstExpected);
    expect(second.previous_hash).toBe(firstExpected);
    expect(second.hash_chain).toBe(secondExpected);
  });

  it("rejects caller-supplied chain values and reports a tampered persisted chain without repairing it", async () => {
    await expect(client.query(
      `INSERT INTO audit_logs (action, details, created_at, hash_chain)
       VALUES ($1, $2, $3, $4)`,
      ["caller_hash_attempt", "{}", "2026-09-02T10:00:02Z", "a".repeat(64)],
    )).rejects.toThrow("database managed");

    const originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    vi.resetModules();
    try {
      const { verifyAuditLogIntegrity } = await import("./auditVerification");
      await expect(verifyAuditLogIntegrity()).resolves.toMatchObject({ verified: true, totalEntries: 2, verifiedEntries: 2, breaks: [] });

      await client.query("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_assign_hash_chain");
      try {
        await client.query("UPDATE audit_logs SET hash_chain = $1 WHERE id = $2", ["b".repeat(64), 2]);
      } finally {
        await client.query("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_assign_hash_chain");
      }

      await expect(verifyAuditLogIntegrity()).resolves.toMatchObject({ verified: false, firstBreak: 2, verifiedEntries: 2 });
      const tampered = await client.query<{ hash_chain: string }>("SELECT hash_chain FROM audit_logs WHERE id = 2");
      expect(tampered.rows[0]?.hash_chain).toBe("b".repeat(64));
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      vi.resetModules();
    }
  });

  it("keeps the runtime audit verifier read-only and migration-owned", async () => {
    const verifier = await readFile(new URL("./auditVerification.ts", import.meta.url), "utf8");
    expect(verifier).not.toMatch(/ALTER\s+TABLE\s+audit_logs/i);
    expect(verifier).not.toMatch(/UPDATE\s+audit_logs\s+SET\s+hash_chain/i);
    expect(verifier).toContain("audit_logs hash-chain columns are missing");
    expect(verifier).toContain("[MISSING]");
  });
});
