import { describe, it, expect } from "vitest";

describe("kafka", () => {
  it("should export Kafka functions", async () => {
    const mod = await import("./kafka");
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });
});
