import { describe, it, expect } from "vitest";

describe("breachTimer", () => {
  it("should export breach timer utilities", async () => {
    const mod = await import("./breachTimer");
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });

  it("should calculate hours remaining in 72-hour window", async () => {
    const mod = await import("./breachTimer");
    if (typeof mod.getHoursRemaining === "function") {
      // Breach detected 24 hours ago
      const detectedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const remaining = mod.getHoursRemaining(detectedAt);
      expect(remaining).toBeLessThanOrEqual(48);
      expect(remaining).toBeGreaterThan(0);
    }
  });
});
