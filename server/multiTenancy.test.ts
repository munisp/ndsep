import { describe, it, expect } from "vitest";

describe("multiTenancy", () => {
  it("should export multi-tenancy functions", async () => {
    const mod = await import("./multiTenancy");
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });
});
