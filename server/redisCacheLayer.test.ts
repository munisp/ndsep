import { describe, it, expect } from "vitest";

describe("redisCacheLayer", () => {
  it("should export Redis cache layer functions", async () => {
    const mod = await import("./redisCacheLayer");
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });
});
