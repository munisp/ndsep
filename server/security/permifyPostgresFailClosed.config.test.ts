import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("Permify PostgreSQL and fail-closed source contract", () => {
  it("uses PostgreSQL rather than the in-memory authorization datastore in active Compose profiles", () => {
    for (const compose of ["docker-compose.production.yml", "docker-compose.middleware.yml", "orchestration/docker-compose.yml"]) {
      const source = read(compose);
      const start = source.indexOf("  permify:");
      expect(start).toBeGreaterThanOrEqual(0);
      const remainder = source.slice(start);
      const nextService = remainder.search(/\n  [A-Za-z0-9_-]+:/);
      const permify = nextService === -1 ? remainder : remainder.slice(0, nextService);
      expect(permify).toContain("PERMIFY_DATABASE_ENGINE: postgres");
      expect(permify).toContain("PERMIFY_DATABASE_URI");
      expect(permify).not.toContain("PERMIFY_DATABASE_ENGINE: memory");
    }
  });

  it("does not substitute a localhost endpoint or local role map for authorization", () => {
    const client = read("orchestration/go/pkg/permify/client.go");
    const iam = read("orchestration/go/cmd/iam_service/main.go");
    const manager = read("server/workerManager.ts");
    expect(client).toContain("PERMIFY_URL is required for authorization decisions");
    expect(client).not.toContain('url = "http://localhost:3476"');
    expect(iam).toContain("PERMIFY_URL and PERMIFY_TENANT are required when Permify is enabled");
    expect(iam).toContain("permify authorization service is unavailable");
    expect(manager).toContain("PERMIFY_TENANT: process.env.PERMIFY_TENANT ?? \"\"");
    expect(manager).not.toContain("local role-map fallback");
  });

  it("marks the IAM health endpoint unavailable unless both Keycloak and Permify are available", () => {
    const iam = read("orchestration/go/cmd/iam_service/main.go");
    expect(iam).toContain("if !kOK || !pOK");
    expect(iam).toContain('status = "unavailable"');
    expect(iam).toContain("Keycloak and Permify must remain enabled in production");
  });
});
