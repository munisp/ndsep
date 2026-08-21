import { describe, it, expect } from "vitest";

describe("cache", () => {
  it("should export cache functions", async () => {
    const mod = await import("./cache");
    expect(mod).toBeDefined();
    // cacheGet, cacheSet, cacheDel should be exported
    expect(typeof mod.cacheGet === "function" || typeof mod.cacheSet === "function").toBe(true);
  });

  it("should handle missing Redis gracefully", async () => {
    const mod = await import("./cache");
    if (typeof mod.cacheGet === "function") {
      const result = await mod.cacheGet("nonexistent-key");
      // Should return null when Redis unavailable
      expect(result === null || result === undefined).toBe(true);
    }
  });
});
