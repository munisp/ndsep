import { describe, it, expect } from "vitest";

describe("dataRetention", () => {
  it("should export data retention functions", async () => {
    const mod = await import("./dataRetention");
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });
});
