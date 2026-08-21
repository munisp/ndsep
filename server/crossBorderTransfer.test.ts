import { describe, it, expect } from "vitest";

describe("crossBorderTransfer", () => {
  it("should export cross-border transfer functions", async () => {
    const mod = await import("./crossBorderTransfer");
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });
});
