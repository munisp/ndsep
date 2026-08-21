import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

async function loadProductionAdapters() {
  vi.resetModules();
  return import("../productionGaps");
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("production adapters against explicit deterministic infrastructure", () => {
  it("queries the configured Keycloak realm with the administrator bearer token and preserves authoritative sessions", async () => {
    process.env.KEYCLOAK_URL = "https://keycloak.simulated.test";
    process.env.KEYCLOAK_REALM = "ndsep";
    process.env.KEYCLOAK_ADMIN_TOKEN = "admin-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: "session-01", userId: "user-01" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { getKeycloakActiveSessions } = await loadProductionAdapters();
    await expect(getKeycloakActiveSessions("user-01")).resolves.toEqual([{ id: "session-01", userId: "user-01" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://keycloak.simulated.test/admin/realms/ndsep/users/user-01/sessions",
      expect.objectContaining({ headers: { Authorization: "Bearer admin-token" } }),
    );
  });

  it("queries the configured Lakehouse table through the REST scan contract and returns only the source records", async () => {
    process.env.LAKEHOUSE_REST_URL = "https://lakehouse.simulated.test";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ records: [{ organization_id: "org-01", score: 91 }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { queryLakehouse } = await loadProductionAdapters();
    await expect(queryLakehouse("compliance_scores", { organization_id: "org-01" }, 25)).resolves.toEqual([
      { organization_id: "org-01", score: 91 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/namespaces/ndsep/tables/compliance_scores/scan?"),
      expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
    );
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain("table=compliance_scores");
    expect(requestUrl).toContain("organization_id=org-01");
    expect(requestUrl).toContain("limit=25");
  });

  it("rejects simulated invalid authoritative responses rather than replacing them with local data", async () => {
    process.env.KEYCLOAK_URL = "https://keycloak.simulated.test";
    process.env.KEYCLOAK_REALM = "ndsep";
    process.env.KEYCLOAK_ADMIN_TOKEN = "admin-token";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessions: [] }), { status: 200 })));

    const { getKeycloakActiveSessions } = await loadProductionAdapters();
    await expect(getKeycloakActiveSessions("user-01")).rejects.toThrow("invalid payload");
  });
});
