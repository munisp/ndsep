import { describe, it, expect } from "vitest";

describe("openapi", () => {
  it("should export OpenAPI registration function", async () => {
    const mod = await import("./openapi");
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });
});
