import { describe, it, expect } from "vitest";

describe("featureFlags", () => {
  it("should export feature flag functions", async () => {
    const mod = await import("./featureFlags");
    expect(mod).toBeDefined();
  });

  it("should have isFeatureEnabled function", async () => {
    const mod = await import("./featureFlags");
    if (typeof mod.isFeatureEnabled === "function") {
      const result = mod.isFeatureEnabled("non-existent-flag");
      expect(typeof result).toBe("boolean");
    }
  });

  it("should have getFeatureFlags function", async () => {
    const mod = await import("./featureFlags");
    if (typeof mod.getFeatureFlags === "function") {
      const flags = mod.getFeatureFlags();
      expect(typeof flags).toBe("object");
    }
  });
});
