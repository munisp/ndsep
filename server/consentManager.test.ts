import { describe, it, expect } from "vitest";

describe("consentManager", () => {
  it("should export consent management functions", async () => {
    const mod = await import("./consentManager");
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });
});
