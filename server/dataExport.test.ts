import { describe, it, expect } from "vitest";

describe("dataExport", () => {
  it("should export data export functions", async () => {
    const mod = await import("./dataExport");
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });
});
