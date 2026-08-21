import { describe, it, expect } from "vitest";

describe("middlewareHelpers", () => {
  it("should export middleware helper functions", async () => {
    const mod = await import("./middlewareHelpers");
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });
});
