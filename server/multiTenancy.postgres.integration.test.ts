import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.MULTITENANCY_RLS_TEST_DATABASE_URL;

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
    "MULTITENANCY_RLS_TEST_DATABASE_URL must identify a localhost disposable test database"
  );
}

describe.skipIf(!shouldRun)(
  "multi-tenancy RLS root-migration PostgreSQL integration",
  () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;

    beforeAll(() => {
      process.env.DATABASE_URL = databaseUrl;
    });

    afterAll(() => {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    });

    it("executes the read-only RLS migration-state verifier without ambiguous parameters", async () => {
      const { enableRowLevelSecurity } = await import("./multiTenancy");
      await expect(enableRowLevelSecurity()).resolves.toBeUndefined();
    });
  }
);
