import { describe, expect, it } from "vitest";
import { evaluateProductionReadinessChecks } from "./productionReadiness";

const baseInputs = {
  middleware: {
    services: [
      { name: "PostgreSQL", status: "connected" },
      { name: "Redis", status: "connected" },
    ],
    overall: "healthy",
    connected: 2,
    total: 2,
  },
  builds: [{ success: true }],
  errors: { errorsLastMinute: 0, totalErrors: 0 },
};

const keycloakCheck = (inputs: Parameters<typeof evaluateProductionReadinessChecks>[0]) =>
  evaluateProductionReadinessChecks(inputs).find((check) => check.name === "Keycloak Verification Ready");

describe("evaluateProductionReadinessChecks", () => {
  it("fails closed when Keycloak is disabled instead of accepting a demo fallback", () => {
    expect(keycloakCheck({ ...baseInputs, keycloak: { enabled: false, jwksCached: true, jwksCacheAge: 1 } })?.pass).toBe(false);
  });

  it("fails closed when no verified JWKS material is present", () => {
    expect(keycloakCheck({ ...baseInputs, keycloak: { enabled: true, jwksCached: false, jwksCacheAge: null } })?.pass).toBe(false);
  });

  it("fails closed when the cached JWKS material is stale", () => {
    expect(keycloakCheck({ ...baseInputs, keycloak: { enabled: true, jwksCached: true, jwksCacheAge: 3601 } })?.pass).toBe(false);
  });

  it("passes only for an enabled Keycloak verifier with fresh JWKS material", () => {
    expect(keycloakCheck({ ...baseInputs, keycloak: { enabled: true, jwksCached: true, jwksCacheAge: 3600 } })?.pass).toBe(true);
  });

  it("does not treat an empty worker-build result as successful evidence", () => {
    const workerCheck = evaluateProductionReadinessChecks({
      ...baseInputs,
      builds: [],
      keycloak: { enabled: true, jwksCached: true, jwksCacheAge: 1 },
    }).find((check) => check.name === "Worker Binaries Built");
    expect(workerCheck?.pass).toBe(false);
  });
});
