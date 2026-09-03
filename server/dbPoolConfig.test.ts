import { describe, expect, it } from "vitest";
import { getPrimaryDatabasePoolOptions } from "./dbPoolConfig";

describe("primary database pool configuration", () => {
  it("applies bounded defaults, server-side timeouts, connection recycling, and test-only idle exit", () => {
    expect(
      getPrimaryDatabasePoolOptions("postgresql://user:password@localhost:5432/ndsep_test", false, {
        NODE_ENV: "test",
      })
    ).toMatchObject({
      connectionString: "postgresql://user:password@localhost:5432/ndsep_test",
      ssl: false,
      application_name: "ndsep-api",
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 30000,
      query_timeout: 35000,
      lock_timeout: 5000,
      idle_in_transaction_session_timeout: 15000,
      maxUses: 10000,
      keepAlive: true,
      allowExitOnIdle: true,
    });
  });

  it("accepts bounded operational overrides without changing the database credential boundary", () => {
    const options = getPrimaryDatabasePoolOptions("postgresql://user:password@db.example:5432/ndsep", {
      rejectUnauthorized: true,
    }, {
      NODE_ENV: "production",
      DB_APPLICATION_NAME: "ndsep-api-blue",
      DB_POOL_MAX: "32",
      DB_IDLE_TIMEOUT_MS: "45000",
      DB_CONNECTION_TIMEOUT_MS: "7500",
      DB_STATEMENT_TIMEOUT_MS: "60000",
      DB_QUERY_TIMEOUT_MS: "65000",
      DB_LOCK_TIMEOUT_MS: "8000",
      DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: "20000",
      DB_POOL_MAX_USES: "20000",
    });

    expect(options).toMatchObject({
      connectionString: "postgresql://user:password@db.example:5432/ndsep",
      ssl: { rejectUnauthorized: true },
      application_name: "ndsep-api-blue",
      max: 32,
      idleTimeoutMillis: 45000,
      connectionTimeoutMillis: 7500,
      statement_timeout: 60000,
      query_timeout: 65000,
      lock_timeout: 8000,
      idle_in_transaction_session_timeout: 20000,
      maxUses: 20000,
      allowExitOnIdle: false,
    });
  });

  it("fails fast for invalid, zero, or unbounded operational settings", () => {
    expect(() =>
      getPrimaryDatabasePoolOptions("postgresql://user:password@localhost:5432/ndsep_test", false, {
        DB_POOL_MAX: "0",
      })
    ).toThrow("DB_POOL_MAX must be between 1 and 100");
    expect(() =>
      getPrimaryDatabasePoolOptions("postgresql://user:password@localhost:5432/ndsep_test", false, {
        DB_STATEMENT_TIMEOUT_MS: "forever",
      })
    ).toThrow("DB_STATEMENT_TIMEOUT_MS must be an integer between 1000 and 300000");
    expect(() =>
      getPrimaryDatabasePoolOptions("postgresql://user:password@localhost:5432/ndsep_test", false, {
        DB_POOL_MAX_USES: "1000001",
      })
    ).toThrow("DB_POOL_MAX_USES must be between 100 and 1000000");
  });
});
