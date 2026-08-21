import { describe, it, expect } from "vitest";

describe("keycloak", () => {
  it("should export Keycloak functions", async () => {
    const mod = await import("./keycloak");
    expect(mod).toBeDefined();
    expect(typeof mod.verifyKeycloakToken === "function").toBe(true);
    expect(typeof mod.isKeycloakHealthy === "function").toBe(true);
    expect(typeof mod.mapKeycloakRoleToNdsep === "function").toBe(true);
  });
});
