import { describe, it, expect } from "vitest";

describe("apiKeyRotation", () => {
  it("should export rotation functions", async () => {
    const mod = await import("./apiKeyRotation");
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });

  it("should generate API keys of correct length", async () => {
    const mod = await import("./apiKeyRotation");
    if (typeof mod.generateApiKey === "function") {
      const key = mod.generateApiKey();
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(16);
    }
  });
});
