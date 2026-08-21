import { describe, it, expect } from "vitest";

describe("authMiddleware", () => {
  it("should export auth middleware functions", async () => {
    const mod = await import("./authMiddleware");
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });
});
