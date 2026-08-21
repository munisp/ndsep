import { describe, it, expect } from "vitest";

describe("sessionBlacklist", () => {
  it("should export session blacklist functions", async () => {
    const mod = await import("./sessionBlacklist");
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });
});
