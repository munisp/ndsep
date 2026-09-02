import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("mobile PostgreSQL persistence source contract", () => {
  it("uses PostgreSQL Drizzle schema, adapter, and migration configuration", () => {
    const schema = read("mobile/drizzle/schema.ts");
    const adapter = read("mobile/server/db.ts");
    const config = read("mobile/drizzle.config.ts");
    const baseline = read("mobile/drizzle/0000_postgresql_baseline.sql");
    const journal = read("mobile/drizzle/meta/_journal.json");

    expect(schema).toContain('from "drizzle-orm/pg-core"');
    expect(schema).not.toContain("drizzle-orm/mysql-core");
    expect(adapter).toContain('from "drizzle-orm/node-postgres"');
    expect(adapter).toContain("mobile persistence requires a PostgreSQL DATABASE_URL");
    expect(adapter).not.toContain("onDuplicateKeyUpdate");
    expect(config).toContain('dialect: "postgresql"');
    expect(baseline).toContain('CREATE TABLE "users"');
    expect(baseline).toContain("jsonb");
    expect(baseline).not.toMatch(/AUTO_INCREMENT|ON UPDATE CURRENT_TIMESTAMP|`/);
    expect(journal).toContain('"dialect": "postgresql"');
  });

  it("keeps portable runtime and CI aligned with PostgreSQL-only mobile persistence", () => {
    const compose = read("mobile/docker-compose.portable.yml");
    const packageJson = read("mobile/package.json");
    const ci = read(".github/workflows/ci.yml");

    expect(compose).toContain("postgresql:");
    expect(compose).toContain("postgres:16.4-alpine");
    expect(compose).toContain("MOBILE_POSTGRES_PASSWORD is required");
    expect(compose).not.toMatch(/^ {2}mysql:/m);
    expect(packageJson).not.toContain('"mysql2"');
    expect(ci).toContain("MOBILE_POSTGRES_TEST_DATABASE_URL");
    expect(ci).toContain("pnpm exec drizzle-kit migrate");
  });
});
