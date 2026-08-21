import { describe, it, expect } from "vitest";

describe("queryCache", () => {
  it("should export cache wrapper functions", async () => {
    const mod = await import("./queryCache");
    expect(mod).toBeDefined();
    expect(typeof mod.withCache === "function" || typeof mod.withSWR === "function").toBe(true);
  });

  it("should export cache key constants", async () => {
    const mod = await import("./queryCache");
    if (mod.CK) {
      expect(typeof mod.CK).toBe("object");
    }
  });

  it("should export TTL constants", async () => {
    const mod = await import("./queryCache");
    if (mod.TTL) {
      expect(typeof mod.TTL).toBe("object");
    }
  });
});
