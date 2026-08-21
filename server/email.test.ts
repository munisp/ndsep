import { describe, it, expect } from "vitest";

describe("email", () => {
  it("should export email functions", async () => {
    const mod = await import("./email");
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });
});
