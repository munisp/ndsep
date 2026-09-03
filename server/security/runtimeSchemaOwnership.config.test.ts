import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("runtime schema ownership and RLS source contract", () => {
  it("registers DDL-only migration 0044 for feature flag columns and RLS policy state", () => {
    const migration = read("drizzle/0044_runtime_schema_ownership_and_rls.sql");
    const journal = JSON.parse(read("drizzle/meta/_journal.json")) as {
      entries: Array<{ idx: number; tag: string }>;
    };

    expect(journal.entries).toContainEqual({
      idx: 44,
      version: "7",
      when: 1788389839397,
      tag: "0044_runtime_schema_ownership_and_rls",
      breakpoints: true,
    });
    expect(migration).toContain("ALTER TABLE public.feature_flags");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS strategy");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS parameters");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("CREATE POLICY");
    expect(migration).not.toMatch(/INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/i);
  });

  it("removes active startup runtime DDL and requires migration readiness", () => {
    const webhook = read("server/webhookSystem.ts");
    const featureFlags = read("server/featureFlags/index.ts");
    const marketplace = read("server/marketplace/index.ts");
    const startup = read("server/_core/index.ts");
    const ci = read(".github/workflows/ci.yml");
    const extendedE2E = read(".github/workflows/extended-e2e-matrix.yml");

    expect(webhook).not.toMatch(/CREATE TABLE|CREATE INDEX|ALTER TABLE/);
    expect(featureFlags).not.toMatch(/CREATE TABLE|CREATE INDEX|ALTER TABLE/);
    expect(marketplace).not.toMatch(/CREATE TABLE|CREATE INDEX|ALTER TABLE/);
    expect(webhook).toContain("Webhook migration 0029 is incomplete");
    expect(featureFlags).toContain("Feature flag migration 0044 is incomplete");
    expect(marketplace).toContain("Marketplace migration 0029 is incomplete");
    expect(startup).toContain("await initWebhookSystem(webhookPool)");
    expect(startup).toContain("await enableRowLevelSecurity()");
    expect(startup).toContain("await initMarketplace()");
    expect(startup).toContain("await initFeatureFlags()");
    expect(startup).not.toContain(
      "Webhook system init failed — webhooks disabled"
    );
    expect(startup).not.toContain("Multi-tenancy init skipped");
    expect(ci).toContain("name: Apply root Drizzle migrations");
    expect(ci).toContain("run: pnpm exec drizzle-kit migrate");
    expect(extendedE2E).toContain(
      "name: Apply root Drizzle migrations to this disposable PostgreSQL database"
    );
    expect(extendedE2E).toContain(
      "pnpm exec drizzle-kit migrate > migration.log"
    );
    expect(extendedE2E).not.toContain("drizzle-kit push --force");
  });

  it("uses migration verification and parameterized tenant configuration", () => {
    const multiTenancy = read("server/multiTenancy.ts");
    const featureFlags = read("server/featureFlags/index.ts");
    const marketplace = read("server/marketplace/index.ts");

    expect(multiTenancy).not.toMatch(/ALTER TABLE\s+\$?\{?table|CREATE POLICY/);
    expect(multiTenancy).toContain("RLS migration state is incomplete");
    expect(multiTenancy).toContain("$1::text");
    expect(multiTenancy).toContain("$2::text");
    expect(multiTenancy).toContain(
      "SELECT set_config('app.current_org_id', $1, true)"
    );
    expect(multiTenancy).toContain(
      "SELECT set_config('app.is_admin', $1, true)"
    );
    expect(featureFlags).toContain("stableRolloutBucket");
    expect(featureFlags).not.toContain("Math.random() * 100");
    expect(marketplace).toContain("active = true");
    expect(marketplace).toContain("last_delivery_at = NOW()");
    expect(marketplace).not.toContain("WHERE id = ${row.id}::uuid");
  });
});
