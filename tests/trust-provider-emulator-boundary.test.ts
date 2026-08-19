import { describe, expect, it, vi } from "vitest";
import { getProviderHealth } from "../server/trustProviders";
import * as settings from "../server/integrationSettingsRepository";

describe("trust provider emulator boundaries", () => {
  it("does not report configured development bridge endpoints as authoritative ready providers", () => {
    const configuredValue = vi.spyOn(settings, "getConfiguredIntegrationValue").mockImplementation((key) => {
      if (key === "NIMC_NVS_BRIDGE_URL") return "http://localhost:3000/api/dev-emulators/bridges/nimc";
      if (key === "NIMC_NVS_BRIDGE_TOKEN") return "development-token";
      return null;
    });
    try {
      const nimc = getProviderHealth().find((provider) => provider.provider === "nimc_nvs_bridge");
      expect(nimc?.state).toBe("emulator");
      expect(nimc?.reason).toContain("cannot verify a NIN");
    } finally { configuredValue.mockRestore(); }
  });
});
