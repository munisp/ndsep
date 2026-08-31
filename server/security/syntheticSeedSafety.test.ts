import { describe, expect, it } from "vitest";
import {
  SYNTHETIC_SEED_CONFIRMATION,
  SYNTHETIC_SEED_APPLICATION_NAME,
  getSyntheticSeedPoolOptions,
  inspectPublicTableCoverage,
  requireCompleteSyntheticSeed,
  summarizePublicTableCoverage,
} from "../../scripts/lib/synthetic-seed-safety.mjs";

const confirmedLocalEnvironment = {
  NODE_ENV: "test",
  SYNTHETIC_SEED_CONFIRMATION,
  DATABASE_URL: "postgresql://seed_user:seed_password@localhost:5432/ndsep_synthetic",
};

describe("synthetic seed safety", () => {
  it("requires explicit synthetic-data confirmation and never supplies a default database URL", () => {
    expect(() => getSyntheticSeedPoolOptions({ NODE_ENV: "test" })).toThrow(
      `Synthetic seed requires SYNTHETIC_SEED_CONFIRMATION=${SYNTHETIC_SEED_CONFIRMATION}`
    );
    expect(() =>
      getSyntheticSeedPoolOptions({
        NODE_ENV: "test",
        SYNTHETIC_SEED_CONFIRMATION,
      })
    ).toThrow("Synthetic seed requires DATABASE_URL or POSTGRES_URL; no default database is permitted");
  });

  it("rejects production-like, unlabelled, and remote targets by default", () => {
    expect(() =>
      getSyntheticSeedPoolOptions({
        ...confirmedLocalEnvironment,
        NODE_ENV: "production",
      })
    ).toThrow("Synthetic seed is prohibited when NODE_ENV=production");
    expect(() =>
      getSyntheticSeedPoolOptions({
        ...confirmedLocalEnvironment,
        DATABASE_URL: "postgresql://seed_user:seed_password@localhost:5432/ndsep_production",
      })
    ).toThrow("Synthetic seed refuses a production- or live-labelled database name");
    expect(() =>
      getSyntheticSeedPoolOptions({
        ...confirmedLocalEnvironment,
        DATABASE_URL: "postgresql://seed_user:seed_password@localhost:5432/ndsep",
      })
    ).toThrow("Synthetic seed database name must identify a synthetic, demo, test, sandbox, or staging database");
    expect(() =>
      getSyntheticSeedPoolOptions({
        ...confirmedLocalEnvironment,
        DATABASE_URL: "postgresql://seed_user:seed_password@db.internal:5432/ndsep_staging",
      })
    ).toThrow("Synthetic seed refuses non-loopback host 'db.internal'");
    expect(() =>
      getSyntheticSeedPoolOptions({
        ...confirmedLocalEnvironment,
        DATABASE_URL: "postgresql://seed_user:seed_password@db.internal:5432/ndsep_staging",
        SYNTHETIC_SEED_ALLOW_REMOTE: SYNTHETIC_SEED_CONFIRMATION,
      })
    ).toThrow("Synthetic seed requires sslmode=require, verify-ca, or verify-full for a remote target");
  });

  it("returns bounded, explicitly labeled PostgreSQL pool options for an accepted target", () => {
    expect(getSyntheticSeedPoolOptions(confirmedLocalEnvironment)).toMatchObject({
      connectionString: confirmedLocalEnvironment.DATABASE_URL,
      application_name: SYNTHETIC_SEED_APPLICATION_NAME,
      max: 2,
      connectionTimeoutMillis: 5000,
      statement_timeout: 30000,
      query_timeout: 30000,
      lock_timeout: 5000,
      idle_in_transaction_session_timeout: 15000,
      maxUses: 10000,
      allowExitOnIdle: true,
    });
    expect(
      getSyntheticSeedPoolOptions({
        ...confirmedLocalEnvironment,
        DATABASE_URL: "postgresql://seed_user:seed_password@staging-db.internal:5432/ndsep_staging?sslmode=verify-full",
        SYNTHETIC_SEED_ALLOW_REMOTE: SYNTHETIC_SEED_CONFIRMATION,
        SYNTHETIC_SEED_POOL_MAX: "3",
        SYNTHETIC_SEED_STATEMENT_TIMEOUT_MS: "45000",
      })
    ).toMatchObject({ max: 3, statement_timeout: 45000 });
  });

  it("counts every public table and fails when even one remains empty", async () => {
    const queried: string[] = [];
    const client = {
      query: async (statement: string) => {
        queried.push(statement);
        if (statement.includes("FROM pg_tables")) {
          return { rows: [{ tablename: "assets" }, { tablename: "organizations" }, { tablename: "users" }] };
        }
        if (statement.includes('"assets"')) return { rows: [{ count: "4" }] };
        if (statement.includes('"organizations"')) return { rows: [{ count: "2" }] };
        if (statement.includes('"users"')) return { rows: [{ count: "0" }] };
        throw new Error(`Unexpected statement: ${statement}`);
      },
    };

    const coverage = await inspectPublicTableCoverage(client);
    expect(coverage).toEqual([
      { table: "assets", rows: 4 },
      { table: "organizations", rows: 2 },
      { table: "users", rows: 0 },
    ]);
    const summary = summarizePublicTableCoverage(coverage);
    expect(summary).toEqual({
      totalTables: 3,
      populatedTables: 2,
      totalRows: 6,
      emptyTables: ["users"],
      complete: false,
    });
    expect(() => requireCompleteSyntheticSeed(summary)).toThrow(
      "Synthetic seed coverage is incomplete; empty public tables: users"
    );
    expect(queried).toHaveLength(4);
  });

  it("accepts a complete authoritative table-coverage report", () => {
    const summary = summarizePublicTableCoverage([
      { table: "organizations", rows: 10 },
      { table: "users", rows: 3 },
    ]);
    expect(requireCompleteSyntheticSeed(summary)).toMatchObject({ complete: true, totalTables: 2, totalRows: 13 });
  });
});
