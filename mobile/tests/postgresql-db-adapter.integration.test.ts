import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { closeDbForTests, getUserByOpenId, upsertUser } from "../server/db";

const testDatabaseUrl = process.env.MOBILE_POSTGRES_TEST_DATABASE_URL;
const isDedicatedLocalTestUrl = (url: string | undefined) => {
  if (!url) return false;
  const authority = url.split("@").at(-1)?.split("/")[0] ?? "";
  return /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(authority) && /\/idlr_payment_test(?:\?|$)/.test(url);
};

if (!isDedicatedLocalTestUrl(testDatabaseUrl)) {
  throw new Error("MOBILE_POSTGRES_TEST_DATABASE_URL must target the dedicated local idlr_payment_test database");
}

describe("mobile PostgreSQL Drizzle adapter", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString: testDatabaseUrl });

  beforeEach(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await closeDbForTests();
    await pool.query('DELETE FROM "users" WHERE "openId" = $1', ["mobile-postgres-integration-user"]);
  });

  afterAll(async () => {
    await closeDbForTests();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    await pool.end();
  });

  it("persists and updates a user through PostgreSQL with a database-maintained timestamp", async () => {
    await upsertUser({
      openId: "mobile-postgres-integration-user",
      name: "First Name",
      email: "first@example.test",
      loginMethod: "oidc",
      role: "user",
      lastSignedIn: new Date("2026-09-02T00:00:00.000Z"),
    });

    const first = await pool.query<{ updatedAt: Date }>('SELECT "updatedAt" FROM "users" WHERE "openId" = $1', ["mobile-postgres-integration-user"]);
    expect(first.rowCount).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await upsertUser({
      openId: "mobile-postgres-integration-user",
      name: "Second Name",
      email: "second@example.test",
      loginMethod: "oidc",
      role: "admin",
      lastSignedIn: new Date("2026-09-02T00:01:00.000Z"),
    });

    const user = await getUserByOpenId("mobile-postgres-integration-user");
    const second = await pool.query<{ updatedAt: Date }>('SELECT "updatedAt" FROM "users" WHERE "openId" = $1', ["mobile-postgres-integration-user"]);
    expect(user).toMatchObject({
      openId: "mobile-postgres-integration-user",
      name: "Second Name",
      email: "second@example.test",
      role: "admin",
    });
    expect(second.rows[0].updatedAt.getTime()).toBeGreaterThanOrEqual(first.rows[0].updatedAt.getTime());
  });

  it("rejects a non-PostgreSQL database URL before creating a persistence adapter", async () => {
    await closeDbForTests();
    process.env.DATABASE_URL = "mysql://invalid:invalid@127.0.0.1:3306/retired";
    await expect(getUserByOpenId("mobile-postgres-integration-user")).rejects.toThrow(
      "mobile persistence requires a PostgreSQL DATABASE_URL",
    );
  });
});
