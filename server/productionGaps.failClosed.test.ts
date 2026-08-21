import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

async function loadGaps() {
  vi.resetModules();
  return import("./productionGaps");
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("production gap utilities fail closed", () => {
  it("does not emulate TigerBeetle batch settlement in PostgreSQL", async () => {
    const { executeBatchTransfers } = await loadGaps();
    await expect(executeBatchTransfers([
      { debitAccountId: "1", creditAccountId: "2", amount: 100n, ledger: 1, code: 1 },
    ])).rejects.toThrow("TIGERBEETLE_BATCH_TRANSFER_UNAVAILABLE");
  });

  it("rejects lakehouse reads when the authoritative endpoint is not configured", async () => {
    delete process.env.LAKEHOUSE_REST_URL;
    const { queryLakehouse } = await loadGaps();
    await expect(queryLakehouse("audit_events")).rejects.toThrow("LAKEHOUSE_REST_URL is required");
  });

  it("rejects lakehouse reads when the authoritative endpoint rejects the query", async () => {
    process.env.LAKEHOUSE_REST_URL = "https://lakehouse.invalid";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    const { queryLakehouse } = await loadGaps();
    await expect(queryLakehouse("audit_events")).rejects.toThrow("Lakehouse query failed with HTTP 503");
  });

  it("does not normalize unavailable Keycloak administration into an empty session list", async () => {
    delete process.env.KEYCLOAK_URL;
    delete process.env.KEYCLOAK_REALM;
    delete process.env.KEYCLOAK_ADMIN_TOKEN;
    const { getKeycloakActiveSessions } = await loadGaps();
    await expect(getKeycloakActiveSessions("user-1")).rejects.toThrow("not configured");
  });
});
