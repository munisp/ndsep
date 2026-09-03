import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("Keycloak PostgreSQL and fail-closed source contract", () => {
  it("does not start Keycloak with development-memory storage in active Compose profiles", () => {
    for (const compose of ["docker-compose.production.yml", "docker-compose.middleware.yml", "orchestration/docker-compose.yml"]) {
      const source = read(compose);
      const start = source.indexOf("  keycloak:");
      expect(start).toBeGreaterThanOrEqual(0);
      const remainder = source.slice(start);
      const nextService = remainder.search(/\n {2}[A-Za-z0-9_-]+:/);
      const keycloak = nextService === -1 ? remainder : remainder.slice(0, nextService);
      expect(keycloak).toContain("KC_DB: postgres");
      expect(keycloak).toContain("KC_DB_URL");
      expect(keycloak).not.toContain("KC_DB: dev-mem");
      expect(keycloak).not.toContain("start-dev");
    }
  });

  it("requires explicit non-placeholder administrator and database inputs in the middleware profile", () => {
    const middleware = read("docker-compose.middleware.yml");
    expect(middleware).toContain("KEYCLOAK_ADMIN_USER is required");
    expect(middleware).toContain("KEYCLOAK_ADMIN_PASSWORD is required");
    expect(middleware).toContain("KEYCLOAK_DB_URL is required");
    expect(middleware).toContain("KEYCLOAK_HOSTNAME is required");
    expect(middleware).not.toContain("ndsep_admin_2026");
  });

  it("keeps Node production authentication tied to real Keycloak configuration", () => {
    const validation = read("server/envValidation.ts");
    expect(validation).toContain("production requires real Keycloak IAM");
    expect(validation).toContain("production IAM requires a non-local https:// endpoint");
    expect(validation).toContain('const keycloakEnabled = process.env.KEYCLOAK_ENABLED');
  });
});
