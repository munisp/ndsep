import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("APISIX durable route registry source contract", () => {
  it("registers DDL-only migration 0041 and reconciles the Drizzle schema", () => {
    const migration = read("drizzle/0041_apisix_durable_route_registry.sql");
    const journal = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: Array<{ idx: number; tag: string }> };
    const schema = read("drizzle/schema.ts");
    expect(migration).toContain("CREATE TABLE gateway_routes");
    expect(migration).toContain("CREATE TABLE gateway_route_sync_attempts");
    expect(migration).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|COPY)\b/im);
    expect(journal.entries).toContainEqual(expect.objectContaining({ idx: 41, tag: "0041_apisix_durable_route_registry" }));
    expect(schema).toContain('pgTable("gatewayRoutes"'.replace("gatewayRoutes", "gateway_routes"));
    expect(schema).toContain('pgTable("gateway_route_sync_attempts"');
  });

  it("loads active routes from PostgreSQL and persists every APISIX synchronization outcome", () => {
    const worker = read("workers/go/cmd/apisix_manager/main.go");
    expect(worker).toContain("FROM gateway_routes");
    expect(worker).toContain("gateway_route_sync_attempts");
    expect(worker).toContain("no active gateway_routes are configured");
    expect(worker).toContain('recordSyncAttempt(ctx, route, "failed"');
    expect(worker).toContain('recordSyncAttempt(ctx, route, "succeeded"');
    expect(worker).toContain("APISIX accepted route but synchronization evidence was not persisted");
    expect(worker).not.toContain("NdsepRoutes");
    expect(worker).not.toContain('"degraded": true');
  });

  it("requires internal authorization and explicit APISIX/PostgreSQL configuration", () => {
    const worker = read("workers/go/cmd/apisix_manager/main.go");
    const productionCompose = read("docker-compose.production.yml");
    const middlewareCompose = read("docker-compose.middleware.yml");
    expect(worker).toContain("subtle.ConstantTimeCompare");
    expect(worker).toContain('requiredEnv("APISIX_MANAGER_INTERNAL_AUTH_TOKEN")');
    expect(worker).toContain("WORKER_DATABASE_URL or DATABASE_URL is required");
    expect(productionCompose).toContain("APISIX_MANAGER_INTERNAL_AUTH_TOKEN");
    expect(middlewareCompose).toContain("APISIX_MANAGER_INTERNAL_AUTH_TOKEN");
  });

  it("does not register the legacy compiled-route gateway as an active worker", () => {
    const workerManager = read("server/workerManager.ts");
    expect(workerManager).toContain("superseded by `apisix-manager`");
    expect(workerManager).not.toContain('id: "api-gateway"');
    expect(workerManager).toContain('id: "apisix-manager"');
    expect(workerManager).toContain("APISIX_MANAGER_PORT");
  });
});
