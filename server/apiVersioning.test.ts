import { describe, it, expect } from "vitest";

describe("apiVersioning", () => {
  it("should export API versioning middleware", async () => {
    const mod = await import("./apiVersioning");
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });
});
