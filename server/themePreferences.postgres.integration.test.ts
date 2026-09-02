import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import type { appRouter as AppRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const databaseUrl = process.env.THEME_PREFERENCES_TEST_DATABASE_URL;

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

// This test writes only to a caller-supplied disposable localhost database.
// Refuse rather than silently skip if a non-local target is supplied.
if (databaseUrl && !shouldRun) {
  throw new Error("THEME_PREFERENCES_TEST_DATABASE_URL must identify a localhost disposable test database");
}

let appRouter: typeof AppRouter;
let originalDatabaseUrl: string | undefined;
let migration: string;

function callerFor(openId: string) {
  return appRouter.createCaller({
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    user: { id: 1, openId, name: "Theme integration test user", role: "user" } as TrpcContext["user"],
  });
}

describe.skipIf(!shouldRun)("theme preference PostgreSQL router integration", () => {
  let client: Client;
  const firstUser = "theme-postgres-integration-user-001";
  const secondUser = "theme-postgres-integration-user-002";

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("THEME_PREFERENCES_TEST_DATABASE_URL is required");
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query('DROP TABLE IF EXISTS "theme_preferences" CASCADE');
    await client.query("DROP TABLE IF EXISTS compliance_score_history CASCADE");
    migration = await readFile(new URL("../drizzle/0042_theme_preferences_durable_storage.sql", import.meta.url), "utf8");
    await client.query(migration);
    await client.query(`
      CREATE TABLE compliance_score_history (
        org_id VARCHAR(255) NOT NULL,
        sector VARCHAR(100) NOT NULL,
        score NUMERIC(5,2) NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL
      )
    `);
    await client.query(
      `INSERT INTO compliance_score_history (org_id, sector, score, recorded_at)
       VALUES ($1, $2, $3, NOW()), ($4, $5, $6, NOW())`,
      ["org-quoted-'--", "banking", 92.5, "other-org", "banking", 15],
    );

    // Load the real router only after the test-specific local database URL is
    // active. This prevents the integration test from sharing the main Node CI
    // schema and keeps the database module's process-level pool isolated.
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    vi.resetModules();
    ({ appRouter } = await import("./routers"));
  });

  afterAll(async () => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    await client?.end();
  });

  it("persists user-scoped theme and changelog cursor through the real protected procedures", async () => {
    const caller = callerFor(firstUser);

    await expect(caller.themePrefs.get()).resolves.toEqual({
      theme: "light",
      lastSeenChangelogVersion: null,
    });
    await expect(caller.themePrefs.set({ theme: "dark" })).resolves.toEqual({ ok: true });
    await expect(caller.changelog.markSeen({ version: "2026.09.02" })).resolves.toEqual({ ok: true });
    await expect(caller.themePrefs.get()).resolves.toEqual({
      theme: "dark",
      lastSeenChangelogVersion: "2026.09.02",
    });

    const stored = await client.query(
      `SELECT user_id, theme, last_seen_changelog_version
       FROM theme_preferences
       WHERE user_id = $1`,
      [firstUser],
    );
    expect(stored.rows).toEqual([{
      user_id: firstUser,
      theme: "dark",
      last_seen_changelog_version: "2026.09.02",
    }]);
  });

  it("enforces per-user uniqueness and the allowed durable theme values", async () => {
    const caller = callerFor(secondUser);
    await caller.themePrefs.set({ theme: "light" });

    await expect(client.query(
      `INSERT INTO theme_preferences (user_id, theme)
       VALUES ($1, $2)`,
      [secondUser, "dark"],
    )).rejects.toThrow();
    await expect(client.query(
      `INSERT INTO theme_preferences (user_id, theme)
       VALUES ($1, $2)`,
      ["theme-postgres-invalid-theme", "system"],
    )).rejects.toThrow();
  });

  it("binds sparkline identifiers and bounded day intervals as PostgreSQL parameters", async () => {
    const caller = callerFor(firstUser);

    await expect(caller.sparkline.getHistory({ orgId: "org-quoted-'--", days: 30 })).resolves.toEqual([
      expect.objectContaining({ score: "92.50", sector: "banking" }),
    ]);
    await expect(caller.sparkline.getHistory({ orgId: "org-quoted-'--", days: 7.5 })).rejects.toThrow();
  });

  it("propagates a durable-write failure instead of returning a false saved result", async () => {
    await client.query('DROP TABLE "theme_preferences"');
    const caller = callerFor("theme-postgres-write-failure");

    try {
      await expect(caller.themePrefs.set({ theme: "dark" })).rejects.toThrow();
      await expect(caller.changelog.markSeen({ version: "2026.09.02" })).rejects.toThrow();
    } finally {
      await client.query(migration);
    }
  });
});
